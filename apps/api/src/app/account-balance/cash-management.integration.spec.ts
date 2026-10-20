import { ActivitiesService } from '@ghostfolio/api/app/activities/activities.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { CashManagementExport } from '@ghostfolio/common/interfaces';

import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';

import { AccountBalanceService } from './account-balance.service';
import { CashManagementService } from './cash-management.service';

const databaseUrl = process.env.CASH_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

/** Opt-in tests against a migrated disposable database; never clear shared tables. */
describeDatabase('Cash management with PostgreSQL', () => {
  let prisma: PrismaService;
  let service: CashManagementService;
  let accountId: string;
  let userId: string;
  const users: string[] = [];
  const exchangeRate = {
    toCurrencyAtDate: jest.fn(),
    toCurrency: (value: number) => value
  };
  const emitter = new EventEmitter2();
  const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
  const scope = () => ({ accountId, userId });

  beforeAll(async () => {
    const url = new URL(databaseUrl);
    if (!url.pathname.startsWith('/cash_test')) {
      throw new Error(
        'CASH_TEST_DATABASE_URL must name a disposable cash_test database'
      );
    }
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl, LOG_LEVELS: '[]' })
    );
    await prisma.$connect();
    service = new CashManagementService(emitter, prisma, exchangeRate as never);
  });

  beforeEach(async () => {
    userId = randomUUID();
    users.push(userId);
    await prisma.user.create({ data: { id: userId } });
    accountId = (
      await prisma.account.create({
        data: { currency: 'EUR', name: 'Cash integration test', userId }
      })
    ).id;
    exchangeRate.toCurrencyAtDate
      .mockReset()
      .mockImplementation((value) => value);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
  });

  async function open(balance = '100') {
    return service.open({ ...scope(), date: '2026-10-01', balance });
  }

  async function orderEffect(amount = 10, currency = 'EUR') {
    return service.runInAccounts(
      { accountIds: [accountId], userId },
      async (transaction) => {
        const order = await transaction.order.create({
          data: {
            account: { connect: { id_userId: { id: accountId, userId } } },
            user: { connect: { id: userId } },
            date: day('2026-10-02'),
            type: 'BUY',
            quantity: 1,
            unitPrice: amount,
            fee: 0,
            currency,
            SymbolProfile: {
              create: {
                currency,
                symbol: randomUUID(),
                dataSource: 'MANUAL',
                userId
              }
            }
          },
          include: { SymbolProfile: true }
        });
        await service.synchronizeOrder(transaction, order, { enabled: true });
        return order;
      }
    );
  }

  function activityService() {
    return new ActivitiesService(
      null,
      null,
      null,
      { getBenchmarkAssetProfiles: jest.fn().mockResolvedValue([]) } as never,
      { addJobToQueue: jest.fn(), gatherSymbols: jest.fn() } as never,
      null,
      emitter,
      exchangeRate as never,
      { deleteMany: jest.fn() } as never,
      prisma,
      {
        getSymbolProfilesByIds: async (ids: string[]) =>
          (
            await prisma.symbolProfile.findMany({ where: { id: { in: ids } } })
          ).map((profile) => ({
            ...profile,
            activitiesCount: 100,
            watchedByCount: 0
          }))
      } as never,
      { validateTagIds: jest.fn() } as never,
      service
    );
  }

  function activityInput(unitPrice = 10, date = '2026-10-02') {
    const symbol = randomUUID();
    return {
      userId,
      user: { connect: { id: userId } },
      accountId,
      date: day(date),
      type: 'BUY' as const,
      currency: 'EUR',
      fee: 0,
      quantity: 1,
      unitPrice,
      symbol,
      SymbolProfile: {
        connectOrCreate: {
          where: {
            dataSource_symbol: { dataSource: 'MANUAL' as const, symbol }
          },
          create: { dataSource: 'MANUAL' as const, symbol, currency: 'EUR' }
        }
      }
    };
  }

  it('uses the account default, honors an explicit override, and leaves old history unmanaged', async () => {
    await open('1000');
    await service.updatePreferences({
      ...scope(),
      expectedRevision: 0,
      defaultUpdateCash: true
    });
    const activities = activityService();
    await activities.createActivity(activityInput(10));
    await activities.createActivity({
      ...activityInput(20),
      updateAccountBalance: false
    });
    await activities.createActivity(activityInput(30, '2026-09-01'));
    expect(await prisma.order.count({ where: { userId } })).toBe(3);
    expect((await service.get(scope())).events).toHaveLength(1);
    expect((await service.get(scope())).balances.at(-1).value).toBe('990');
  });

  it('edits, moves and deletes a tracked activity through the real activity service', async () => {
    await open();
    const destination = await prisma.account.create({
      data: { userId, name: 'Destination', currency: 'EUR' }
    });
    await service.open({
      accountId: destination.id,
      userId,
      date: '2026-10-01',
      balance: '1000'
    });
    const activities = activityService();
    const order = await activities.createActivity({
      ...activityInput(),
      updateAccountBalance: true
    });
    const moved = await activities.updateActivity({
      userId,
      originalDate: order.date,
      where: { id: order.id },
      data: {
        date: order.date,
        type: order.type,
        unitPrice: 20,
        quantity: 1,
        fee: 0,
        currency: 'EUR',
        account: { connect: { id_userId: { id: destination.id, userId } } },
        SymbolProfile: {
          connect: {
            dataSource_symbol: {
              dataSource: 'MANUAL',
              symbol: order.SymbolProfile.symbol
            }
          },
          update: {}
        }
      }
    });
    expect((await service.get(scope())).balances.at(-1).value).toBe('100');
    expect(
      (await service.get({ accountId: destination.id, userId })).balances.at(-1)
        .value
    ).toBe('980');
    await activities.deleteActivity({ id: moved.id, userId });
    expect(
      (await service.get({ accountId: destination.id, userId })).balances.at(-1)
        .value
    ).toBe('1000');
  });

  it('revalidates a confirmed overdraft after another writer changes the history', async () => {
    await open();
    const activities = activityService();
    await expect(
      activities.createActivity({
        ...activityInput(250),
        updateAccountBalance: true
      })
    ).rejects.toMatchObject({
      response: { code: 'CASH_CONFIRMATION_REQUIRED', revision: 0 }
    });
    await service.createEvent({
      ...scope(),
      expectedRevision: 0,
      event: { type: 'MOVEMENT', amount: '100', date: '2026-10-02' }
    });
    await expect(
      activities.createActivity({
        ...activityInput(250),
        updateAccountBalance: true,
        confirmNegativeBalance: true,
        cashRevisions: { [accountId]: 0 }
      })
    ).rejects.toMatchObject({
      response: { code: 'CASH_CONFIRMATION_REQUIRED', revision: 1 }
    });
    expect(await prisma.order.count({ where: { userId } })).toBe(0);
    await activities.createActivity({
      ...activityInput(250),
      updateAccountBalance: true,
      confirmNegativeBalance: true,
      cashRevisions: { [accountId]: 1 }
    });
    expect((await service.get(scope())).balances.at(-1).value).toBe('-50');
  });

  it('serializes competing openings and competing revisions without losing an event', async () => {
    const openings = await Promise.allSettled([open(), open()]);
    expect(
      openings.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1);
    const command = {
      ...scope(),
      expectedRevision: 0,
      event: { type: 'MOVEMENT' as const, amount: '40', date: '2026-10-02' }
    };
    const writes = await Promise.allSettled([
      service.createEvent(command),
      service.createEvent(command)
    ]);
    expect(writes.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1
    );
    expect(writes.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.any(ConflictException)
    });
    const next = await service.createEvent({ ...command, expectedRevision: 1 });
    expect(next.events).toHaveLength(2);
    expect(next.balances.at(-1).value).toBe('180');
  });

  it('adopts the opening row and preserves earlier legacy history', async () => {
    await prisma.accountBalance.create({
      data: { ...scope(), date: day('2026-09-01'), value: 80 }
    });
    const original = await prisma.accountBalance.create({
      data: { ...scope(), date: day('2026-10-01'), value: 90 }
    });
    await open();
    expect(
      await prisma.accountBalance.findUnique({ where: { id: original.id } })
    ).toMatchObject({ value: 100, isCashManagementProjection: true });
    expect(await prisma.accountBalance.count({ where: scope() })).toBe(2);
  });

  it('leaves no changes after rejecting an overdraft and commits only after confirmation', async () => {
    await open('50');
    const command = {
      ...scope(),
      expectedRevision: 0,
      event: { type: 'MOVEMENT' as const, amount: '-100', date: '2026-10-02' }
    };
    await expect(service.createEvent(command)).rejects.toMatchObject({
      response: { code: 'CASH_CONFIRMATION_REQUIRED', revision: 0 }
    });
    expect(await prisma.cashEvent.count({ where: scope() })).toBe(0);
    expect((await service.get(scope())).revision).toBe(0);
    const result = await service.createEvent({
      ...command,
      confirmNegativeBalance: true
    });
    expect(result.minimumBalance.value).toBe('-50');
  });

  it('propagates retroactive changes up to an absolute reconciliation', async () => {
    await open();
    await service.createEvent({
      ...scope(),
      expectedRevision: 0,
      event: { date: '2026-10-04', type: 'CHECKPOINT', balance: '500' }
    });
    const deposit = await service.createEvent({
      ...scope(),
      expectedRevision: 1,
      event: { date: '2026-10-02', type: 'MOVEMENT', amount: '40' }
    });
    expect(deposit.balances.map(({ value }) => value)).toEqual([
      '100',
      '140',
      '500'
    ]);
    const event = deposit.events.find(({ type }) => type === 'MOVEMENT');
    const removed = await service.deleteEvent({
      ...scope(),
      expectedRevision: 2,
      eventId: event.id
    });
    expect(removed.balances.map(({ value }) => value)).toEqual(['100', '500']);
    expect(
      await prisma.accountBalance.count({
        where: { ...scope(), date: day('2026-10-02') }
      })
    ).toBe(0);
  });

  it('prevents legacy writers from overwriting managed projections', async () => {
    await open();
    const balances = new AccountBalanceService(
      emitter,
      exchangeRate as never,
      prisma,
      service
    );
    await expect(
      balances.createOrUpdateAccountBalance({
        ...scope(),
        date: '2026-10-01',
        balance: 999
      })
    ).rejects.toBeInstanceOf(ConflictException);
    const row = await prisma.accountBalance.findFirst({ where: scope() });
    await expect(
      balances.deleteAccountBalance({ id: row.id, userId })
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await service.get(scope())).balances[0].value).toBe('100');
  });

  it('persists the exact converted amount and reverses it without obtaining a new FX rate', async () => {
    await open('1000');
    exchangeRate.toCurrencyAtDate.mockResolvedValue(-110.12);
    const order = await orderEffect(100, 'USD');
    expect((await service.get(scope())).balances.at(-1).value).toBe('889.88');
    exchangeRate.toCurrencyAtDate.mockResolvedValue(-999);
    await service.runInAccounts(
      { accountIds: [accountId], userId },
      async (transaction) => {
        const updated = await transaction.order.update({
          where: { id: order.id },
          data: { comment: 'New note' },
          include: { SymbolProfile: true }
        });
        await service.synchronizeOrder(transaction, updated, {
          original: order
        });
      }
    );
    expect(exchangeRate.toCurrencyAtDate).toHaveBeenCalledTimes(1);
    await service.runInAccounts(
      { accountIds: [accountId], userId },
      async (transaction) => {
        await service.removeOrderEffects(transaction, [order]);
        await transaction.order.delete({ where: { id: order.id } });
      }
    );
    expect((await service.get(scope())).balances.at(-1).value).toBe('1000');
  });

  it('rolls back both the order and the event when the projection fails', async () => {
    await open();
    const countBefore = await prisma.order.count({ where: { userId } });
    const projection = jest
      .spyOn(service as never, 'writeProjection' as never)
      .mockRejectedValueOnce(new Error('Projection failure') as never);
    await expect(orderEffect()).rejects.toThrow('Projection failure');
    projection.mockRestore();
    expect(await prisma.order.count({ where: { userId } })).toBe(countBefore);
    expect(await prisma.cashEvent.count({ where: scope() })).toBe(0);
    expect((await service.get(scope())).revision).toBe(0);
  });

  it('keeps a rejected activity creation out of the database through the real activity service', async () => {
    await open('5');
    const activities = new ActivitiesService(
      null,
      null,
      null,
      null,
      { addJobToQueue: jest.fn() } as never,
      null,
      emitter,
      exchangeRate as never,
      null,
      prisma,
      null,
      { validateTagIds: jest.fn() } as never,
      service
    );
    await expect(
      activities.createActivity({
        userId,
        user: { connect: { id: userId } },
        accountId,
        date: day('2026-10-02'),
        type: 'BUY',
        currency: 'EUR',
        fee: 0,
        quantity: 1,
        unitPrice: 10,
        symbol: 'Test',
        updateAccountBalance: true,
        SymbolProfile: {
          connectOrCreate: {
            where: {
              dataSource_symbol: { dataSource: 'MANUAL', symbol: randomUUID() }
            },
            create: {
              dataSource: 'MANUAL',
              symbol: randomUUID(),
              currency: 'EUR'
            }
          }
        }
      })
    ).rejects.toMatchObject({
      response: { code: 'CASH_CONFIRMATION_REQUIRED' }
    });
    expect(await prisma.order.count({ where: { userId } })).toBe(0);
  });

  it('updates preferences without touching the balances', async () => {
    await open();
    const before = await prisma.accountBalance.findMany({ where: scope() });
    await service.updatePreferences({
      ...scope(),
      expectedRevision: 0,
      defaultUpdateCash: true
    });
    expect(await prisma.accountBalance.findMany({ where: scope() })).toEqual(
      before
    );
    expect((await service.get(scope())).defaultUpdateCash).toBe(true);
  });

  it('transfers between a managed and a legacy account in one transaction', async () => {
    await open();
    const to = await prisma.account.create({
      data: { userId, currency: 'EUR', name: 'Destination' }
    });
    await service.transfer({
      accountIdFrom: accountId,
      accountIdTo: to.id,
      balance: 25,
      userId
    });
    expect((await service.get(scope())).balances.at(-1).value).toBe('75');
    expect(
      (
        await prisma.accountBalance.findFirst({
          where: { accountId: to.id, userId }
        })
      ).value
    ).toBe(25);
  });

  it('rolls back the debit if the credit cannot rebuild a destination ledger', async () => {
    await open();
    const to = await prisma.account.create({
      data: { userId, currency: 'EUR', name: 'Destination' }
    });
    await service.open({
      accountId: to.id,
      userId,
      date: '2026-10-01',
      balance: '0'
    });
    await prisma.accountBalance.create({
      data: { accountId: to.id, userId, date: day('2026-10-10'), value: 123 }
    });
    await expect(
      service.transfer({
        accountIdFrom: accountId,
        accountIdTo: to.id,
        balance: 25,
        userId
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await service.get(scope())).balances.at(-1).value).toBe('100');
    expect(await prisma.cashEvent.count({ where: scope() })).toBe(0);
  });

  it('restores exact cash history with remapped activity ids and ignores a repeated restore', async () => {
    await open();
    const originalOrder = await orderEffect(10);
    const original = await service.get(scope());
    const target = await prisma.account.create({
      data: { userId, currency: 'EUR', name: 'Restored account' }
    });
    const restoredOrder = await prisma.order.create({
      data: {
        accountId: target.id,
        accountUserId: userId,
        userId,
        date: originalOrder.date,
        type: originalOrder.type,
        quantity: originalOrder.quantity,
        unitPrice: originalOrder.unitPrice,
        fee: 0,
        currency: 'EUR',
        symbolProfileId: originalOrder.symbolProfileId
      }
    });
    const snapshot: CashManagementExport = {
      version: 1,
      currency: original.currency,
      defaultUpdateCash: original.defaultUpdateCash,
      openingBalance: original.openingBalance,
      events: original.events
    };
    const restoreScope = { accountId: target.id, userId };
    const mapping = { [originalOrder.id]: restoredOrder.id };
    await service.restore(restoreScope, snapshot, mapping);
    await service.restore(restoreScope, snapshot, mapping);
    const result = await service.get(restoreScope);
    expect(result.balances).toEqual(original.balances);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].orderId).toBe(restoredOrder.id);
  });
});
