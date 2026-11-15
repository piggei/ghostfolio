import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { ImpersonationGuard } from '@ghostfolio/api/guards/impersonation.guard';
import { ScopeGuard } from '@ghostfolio/api/guards/scope.guard';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import type {
  CashEventInput,
  CashMovementClassification
} from '@ghostfolio/common/interfaces';
import { scopes } from '@ghostfolio/common/scopes';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { CashManagementController } from './cash-management.controller';
import { CashManagementService } from './cash-management.service';

const databaseUrl = process.env.CASH_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('Persisted manual cash classification (PostgreSQL)', () => {
  let prisma: PrismaService;
  let service: CashManagementService;
  let userId: string;
  let accountId: string;
  let emitter: EventEmitter2;
  const users: string[] = [];
  const scope = () => ({ userId, accountId });
  const movement = (extra: Partial<CashEventInput> = {}): CashEventInput =>
    ({
      type: 'MOVEMENT',
      date: '2026-10-02',
      amount: '500',
      fee: '2',
      comment: 'memo',
      ...extra
    }) as CashEventInput;
  const create = (extra: Partial<CashEventInput> = {}) =>
    service.createEvent({
      ...scope(),
      expectedRevision: 0,
      event: movement(extra)
    });

  beforeAll(async () => {
    if (!new URL(databaseUrl).pathname.startsWith('/cash_test_'))
      throw new Error('Disposable cash_test_ database required');
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl, LOG_LEVELS: '[]' })
    );
    await prisma.$connect();
  });
  beforeEach(async () => {
    userId = randomUUID();
    users.push(userId);
    await prisma.user.create({ data: { id: userId } });
    accountId = (
      await prisma.account.create({ data: { userId, currency: 'EUR' } })
    ).id;
    emitter = new EventEmitter2();
    service = new CashManagementService(emitter, prisma);
    await service.open({ ...scope(), date: '2026-10-01', balance: '1000' });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (prisma) {
      await prisma.cashEvent.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
  });

  it.each(['EXTERNAL_CAPITAL', 'INCOME', 'EXPENSE'] as const)(
    'persists and reads category %s without changing balance arithmetic',
    async (economicClassification) => {
      const result = await create({ economicClassification });
      expect(result.events[0].economicClassification).toBe(
        economicClassification
      );
      expect(result.balances.at(-1).value).toBe('1498');
      expect(
        (await service.get(scope())).events[0].economicClassification
      ).toBe(economicClassification);
      expect(
        (
          await prisma.cashEvent.findUnique({
            where: { id: result.events[0].id }
          })
        ).economicClassification
      ).toBe(economicClassification);
    }
  );

  const unclassified: (null | undefined)[] = [null, undefined];
  it.each(unclassified)(
    'creates unclassified data for category %s and old clients',
    async (economicClassification) => {
      const result =
        economicClassification === undefined
          ? await create()
          : await create({ economicClassification: null });
      expect(result.events[0].economicClassification).toBeNull();
    }
  );

  it('preserves omission, replaces explicitly, and clears only with null', async () => {
    let result = await create({ economicClassification: 'EXTERNAL_CAPITAL' });
    const eventId = result.events[0].id;
    result = await service.updateEvent({
      ...scope(),
      eventId,
      expectedRevision: result.revision,
      event: movement()
    });
    expect(result.events[0].economicClassification).toBe('EXTERNAL_CAPITAL');
    result = await service.updateEvent({
      ...scope(),
      eventId,
      expectedRevision: result.revision,
      event: movement({ economicClassification: 'INCOME' })
    });
    expect(result.events[0].economicClassification).toBe('INCOME');
    result = await service.updateEvent({
      ...scope(),
      eventId,
      expectedRevision: result.revision,
      event: movement({ economicClassification: null })
    });
    expect(result.events[0].economicClassification).toBeNull();
    expect(result.balances.at(-1).value).toBe('1498');
  });

  it('does not classify a historical null merely because its comment or sign changes', async () => {
    const result = await create();
    const next = await service.updateEvent({
      ...scope(),
      eventId: result.events[0].id,
      expectedRevision: result.revision,
      event: movement({ amount: '-100', comment: 'income refund' })
    });
    expect(next.events[0].economicClassification).toBeNull();
  });

  it('preserves every financial field on a classification-only edit using the existing full PUT representation', async () => {
    const result = await create();
    const id = result.events[0].id;
    const before = await prisma.cashEvent.findUnique({ where: { id } });
    const emit = jest.spyOn(emitter, 'emit');
    const next = await service.updateEvent({
      ...scope(),
      eventId: id,
      expectedRevision: result.revision,
      event: movement({ economicClassification: 'EXPENSE' })
    });
    const after = await prisma.cashEvent.findUnique({ where: { id } });
    const {
      economicClassification: oldCategory,
      updatedAt: oldTime,
      ...oldFields
    } = before;
    const {
      economicClassification: newCategory,
      updatedAt: newTime,
      ...newFields
    } = after;
    expect(oldCategory).toBeNull();
    expect(newCategory).toBe('EXPENSE');
    expect(newTime.getTime()).toBeGreaterThanOrEqual(oldTime.getTime());
    expect(newFields).toEqual(oldFields);
    expect(next.balances).toEqual(result.balances);
    expect(next.revision).toBe(result.revision + 1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('rejects implicit loss and non-null categories on reconciliation, then accepts explicit clearing', async () => {
    const result = await create({ economicClassification: 'INCOME' });
    const request = {
      ...scope(),
      eventId: result.events[0].id,
      expectedRevision: result.revision
    };
    const checkpoint: CashEventInput = {
      type: 'CHECKPOINT',
      date: '2026-10-02',
      balance: '1498',
      fee: '0'
    };
    await expect(
      service.updateEvent({ ...request, event: checkpoint })
    ).rejects.toThrow();
    await expect(
      service.updateEvent({
        ...request,
        event: { ...checkpoint, economicClassification: 'EXPENSE' }
      })
    ).rejects.toThrow();
    expect((await service.get(scope())).revision).toBe(result.revision);
    const next = await service.updateEvent({
      ...request,
      event: { ...checkpoint, economicClassification: null }
    });
    expect(next.events[0]).toMatchObject({
      type: 'CHECKPOINT',
      economicClassification: null
    });
    expect(next.balances).toEqual(result.balances);
  });

  it('allows an explicitly classified movement replacing an unclassified checkpoint', async () => {
    const result = await service.createEvent({
      ...scope(),
      expectedRevision: 0,
      event: { type: 'CHECKPOINT', date: '2026-10-02', balance: '1498' }
    });
    const next = await service.updateEvent({
      ...scope(),
      eventId: result.events[0].id,
      expectedRevision: result.revision,
      event: movement({ economicClassification: 'INCOME' })
    });
    expect(next.events[0].economicClassification).toBe('INCOME');
  });

  it('validates categories in the service even without the DTO', async () => {
    await expect(
      create({ economicClassification: 'OTHER' as CashMovementClassification })
    ).rejects.toThrow();
    await expect(
      service.createEvent({
        ...scope(),
        expectedRevision: 0,
        event: {
          type: 'CHECKPOINT',
          date: '2026-10-02',
          balance: '100',
          economicClassification: 'INCOME'
        }
      })
    ).rejects.toThrow();
    expect(await prisma.cashEvent.count({ where: scope() })).toBe(0);
  });

  it.each([
    'transferId',
    'transferCounterpartyAccountId',
    'transferCounterpartyMode',
    'transferCounterpartyAmount',
    'transferCounterpartyCurrency'
  ])('rejects classification of persisted relationship %s', async (field) => {
    const values: Record<string, string> = {
      transferId: 't',
      transferCounterpartyAccountId: accountId,
      transferCounterpartyMode: 'LEGACY',
      transferCounterpartyAmount: '100',
      transferCounterpartyCurrency: 'EUR'
    };
    const result = await create();
    const id = result.events[0].id;
    await prisma.cashEvent.update({
      where: { id },
      data: { [field]: values[field] }
    });
    await expect(
      service.updateEvent({
        ...scope(),
        eventId: id,
        expectedRevision: result.revision,
        event: movement({ economicClassification: 'INCOME' })
      })
    ).rejects.toThrow();
    expect(
      (await prisma.cashEvent.findUnique({ where: { id } }))
        .economicClassification
    ).toBeNull();
  });

  it('does not classify linked orders or change their tax-aware synchronization', async () => {
    const order = await prisma.order.create({
      data: {
        user: { connect: { id: userId } },
        account: { connect: { id_userId: { id: accountId, userId } } },
        type: 'DIVIDEND',
        date: new Date('2026-10-02T00:00:00Z'),
        quantity: 1,
        unitPrice: 100,
        fee: 1,
        tax: 26,
        currency: 'EUR',
        SymbolProfile: {
          create: {
            dataSource: 'MANUAL',
            symbol: randomUUID(),
            currency: 'EUR'
          }
        }
      },
      include: { SymbolProfile: true }
    });
    await service.runInAccounts({ accountIds: [accountId], userId }, (tx) =>
      service.synchronizeOrder(tx, order, { enabled: true })
    );
    const result = await service.get(scope());
    expect(result.events[0]).toMatchObject({
      amount: '73',
      economicClassification: null,
      orderId: order.id
    });
    await expect(
      service.updateEvent({
        ...scope(),
        eventId: result.events[0].id,
        expectedRevision: result.revision,
        event: movement({ economicClassification: 'INCOME' })
      })
    ).rejects.toThrow();
  });

  it('retains null on new transfers', async () => {
    const otherId = (
      await prisma.account.create({ data: { userId, currency: 'EUR' } })
    ).id;
    await service.open({
      userId,
      accountId: otherId,
      date: '2026-10-01',
      balance: '1000'
    });
    const transferable = new CashManagementService(emitter, prisma, {
      toCurrencyAtDate: (amount: number) => Promise.resolve(amount)
    } as never);
    await transferable.transfer({
      userId,
      accountIdFrom: accountId,
      accountIdTo: otherId,
      balance: 10
    });
    const events = await prisma.cashEvent.findMany({ where: { userId } });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.economicClassification === null)).toBe(
      true
    );
  });

  it('serializes competing classification revisions, committing exactly one', async () => {
    const result = await create();
    const request = {
      ...scope(),
      eventId: result.events[0].id,
      expectedRevision: result.revision
    };
    const outcomes = await Promise.allSettled([
      service.updateEvent({
        ...request,
        event: movement({ economicClassification: 'INCOME' })
      }),
      service.updateEvent({
        ...request,
        event: movement({ economicClassification: 'EXPENSE' })
      })
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled')
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected')
    ).toHaveLength(1);
    const next = await service.get(scope());
    expect(next.revision).toBe(result.revision + 1);
    expect(next.balances).toEqual(result.balances);
  });

  it('rolls back category and revision when a later projection fails', async () => {
    const result = await create();
    const emit = jest.spyOn(emitter, 'emit');
    jest
      .spyOn(
        service as unknown as { writeProjection(): Promise<void> },
        'writeProjection'
      )
      .mockRejectedValueOnce(new Error('projection failed'));
    await expect(
      service.updateEvent({
        ...scope(),
        eventId: result.events[0].id,
        expectedRevision: result.revision,
        event: movement({ economicClassification: 'INCOME' })
      })
    ).rejects.toThrow('projection failed');
    expect((await service.get(scope())).revision).toBe(result.revision);
    expect(
      (
        await prisma.cashEvent.findUnique({
          where: { id: result.events[0].id }
        })
      ).economicClassification
    ).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it('accepts the new and old request contracts through the real HTTP controller and validation pipe', async () => {
    // Authentication is supplied by this isolated harness; guards are unchanged.
    let builder = Test.createTestingModule({
      controllers: [CashManagementController],
      providers: [
        { provide: CashManagementService, useValue: service },
        { provide: ExchangeRateDataService, useValue: { toCurrency: () => 1 } }
      ]
    });
    for (const guard of [
      AuthGuard('jwt'),
      HasPermissionGuard,
      ImpersonationGuard,
      ScopeGuard
    ]) {
      builder = builder
        .overrideGuard(guard)
        .useValue({ canActivate: () => true });
    }
    const app = (await builder.compile()).createNestApplication();
    app.use((request: Request, _response: Response, next: NextFunction) => {
      Object.assign(request, {
        impersonation: {
          userId,
          userSettings: { baseCurrency: 'EUR' },
          scopes: [scopes.portfolioReadValues]
        },
        user: { settings: { settings: { viewMode: 'DEFAULT' } } }
      });
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    await app.listen(0, '127.0.0.1');
    try {
      const base = `${await app.getUrl()}/account/${accountId}/cash`;
      const send = (method: string, path: string, payload: object) =>
        fetch(base + path, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
      const created = await send('POST', '/events', {
        expectedRevision: 0,
        event: movement({ economicClassification: 'INCOME' })
      });
      expect(created.status).toBe(201);
      const result = (await created.json()) as {
        revision: number;
        events: { id: string; economicClassification: string | null }[];
      };
      expect(result.events[0].economicClassification).toBe('INCOME');
      const edited = await send('PUT', `/events/${result.events[0].id}`, {
        expectedRevision: result.revision,
        event: movement()
      });
      expect(edited.status).toBe(200);
      const next = (await edited.json()) as typeof result;
      expect(next.events[0].economicClassification).toBe('INCOME');
      const cleared = await send('PUT', `/events/${result.events[0].id}`, {
        expectedRevision: next.revision,
        event: movement({ economicClassification: null })
      });
      expect(cleared.status).toBe(200);
      expect(
        ((await cleared.json()) as typeof result).events[0]
          .economicClassification
      ).toBeNull();
      const invalid = await send('POST', '/events', {
        expectedRevision: 3,
        event: {
          type: 'CHECKPOINT',
          date: '2026-10-02',
          balance: '100',
          economicClassification: 'INCOME'
        }
      });
      expect(invalid.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('preserves classification through persisted snapshots and CSV v2 after B2', async () => {
    await create({ economicClassification: 'INCOME' });
    expect(
      (await service.getPersisted(scope())).events[0].economicClassification
    ).toBe('INCOME');
    expect((await service.exportCsv(scope())).csv).toContain(
      'EconomicClassification'
    );
  });
});
