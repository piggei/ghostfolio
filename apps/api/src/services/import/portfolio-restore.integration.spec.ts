import { CashManagementService } from '@ghostfolio/api/app/account-balance/cash-management.service';
import { ExportService } from '@ghostfolio/api/app/endpoints/export/export.service';
import { AccountBalanceService } from '@ghostfolio/api/services/account-balance/account-balance.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { PROPERTY_BENCHMARKS } from '@ghostfolio/common/config';
import type { ExportResponse } from '@ghostfolio/common/interfaces';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';

import { PortfolioRestoreDto } from './portfolio-restore.dto';
import { PortfolioRestoreService } from './portfolio-restore.service';

const url = process.env.CASH_TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;
describeDb('Portfolio JSON restore with PostgreSQL', () => {
  let prisma: PrismaService;
  let cash: CashManagementService;
  let service: PortfolioRestoreService;
  let userId: string;
  const users: string[] = [];
  const emitter = new EventEmitter2();
  const gathering = { gatherSymbols: jest.fn().mockResolvedValue(undefined) };
  beforeAll(async () => {
    const destination = new URL(url);
    if (!destination.pathname.startsWith('/cash_test'))
      throw Error('Disposable test database required');
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: url, LOG_LEVELS: '[]' })
    );
    await prisma.$connect();
    cash = new CashManagementService(emitter, prisma);
    service = new PortfolioRestoreService(
      prisma,
      cash,
      emitter,
      gathering as never
    );
  });
  beforeEach(async () => {
    userId = randomUUID();
    users.push(userId);
    await prisma.user.create({ data: { id: userId } });
  });
  afterAll(async () => {
    if (prisma) {
      const profiles = await prisma.symbolProfile.findMany({
        where: { userId: { in: users } },
        select: { symbol: true }
      });
      await prisma.marketData.deleteMany({
        where: {
          dataSource: 'MANUAL',
          symbol: { in: profiles.map((p) => p.symbol) }
        }
      });
      await prisma.cashEvent.deleteMany({
        where: { userId: { in: users } }
      });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
  });
  function fixture(): PortfolioRestoreDto {
    const accountId = randomUUID(),
      activityId = randomUUID(),
      symbol = randomUUID();
    return {
      choices: [{ sourceId: accountId, targetId: 'NEW' }],
      restoreSettings: true,
      backup: {
        user: {
          settings: { currency: 'EUR', performanceCalculationType: 'TWR' }
        },
        accounts: [
          {
            id: accountId,
            name: 'Restore test account',
            currency: 'EUR',
            platformId: null,
            cashManagement: {
              version: 1,
              currency: 'EUR',
              defaultUpdateCash: true,
              includeCashInPortfolio: true,
              openingBalance: { date: '2026-01-01', sequence: 0, balance: '0' },
              events: [
                {
                  id: randomUUID(),
                  type: 'MOVEMENT',
                  amount: '5000',
                  fee: '0',
                  date: '2026-01-01',
                  sequence: 1,
                  importReference: 'bank-deposit'
                },
                {
                  id: randomUUID(),
                  type: 'MOVEMENT',
                  amount: '-301',
                  fee: '0',
                  date: '2026-02-02',
                  sequence: 2,
                  orderId: activityId
                }
              ]
            }
          }
        ],
        activities: [
          {
            id: activityId,
            accountId,
            currency: 'EUR',
            dataSource: 'MANUAL' as never,
            date: '2026-02-02T12:00:00.000Z',
            fee: 1,
            quantity: 3,
            unitPrice: 100,
            symbol,
            type: 'BUY' as never
          }
        ],
        assetProfiles: [
          {
            currency: 'EUR',
            dataSource: 'MANUAL' as never,
            symbol,
            name: 'Restored custom asset',
            marketData: [
              { date: '2026-02-02' as never, marketPrice: 100 } as never
            ]
          }
        ]
      }
    };
  }
  async function commit(input: PortfolioRestoreDto) {
    const plan = await service.run(input, userId, true);
    expect(plan.errors).toEqual([]);
    return service.run({ ...input, digest: plan.digest }, userId, false);
  }
  async function exportPortfolio(ownerId: string): Promise<ExportResponse> {
    const exporter = new ExportService(
      {
        accounts: ({ where }) =>
          prisma.account.findMany({
            where,
            include: { balances: true, tags: true, platform: true }
          })
      } as never,
      {
        getActivities: async ({ userId: id }) => ({
          activities: (
            await prisma.order.findMany({
              where: { userId: id },
              include: { SymbolProfile: true, tags: true }
            })
          ).map((order) => ({ ...order, assetProfile: order.SymbolProfile }))
        })
      } as never,
      {
        marketDataItems: ({ where }) => prisma.marketData.findMany({ where })
      } as never,
      { getTagsForUser: async () => [] } as never,
      cash
    );
    return JSON.parse(
      JSON.stringify(
        await exporter.export({
          userId: ownerId,
          userSettings: { baseCurrency: 'EUR' } as never
        })
      )
    ) as ExportResponse;
  }

  it('round-trips a full JSON v2 backup with categories, linked orders and reciprocal transfer remapping', async () => {
    const source = fixture();
    const first = source.backup.accounts[0];
    first.cashManagement.version = 2;
    first.cashManagement.events[0].economicClassification = 'EXTERNAL_CAPITAL';
    first.cashManagement.events.push(
      {
        id: randomUUID(),
        type: 'MOVEMENT',
        date: '2026-03-01',
        sequence: 3,
        amount: '100',
        fee: '2',
        economicClassification: 'INCOME',
        importReference: 'manual-income'
      },
      {
        id: randomUUID(),
        type: 'MOVEMENT',
        date: '2026-03-02',
        sequence: 4,
        amount: '-20',
        fee: '1',
        economicClassification: 'EXPENSE',
        importReference: 'manual-expense'
      },
      {
        id: randomUUID(),
        type: 'MOVEMENT',
        date: '2026-03-03',
        sequence: 5,
        amount: '5',
        fee: '0',
        economicClassification: null,
        importReference: 'unknown'
      }
    );
    const otherId = randomUUID();
    const transferId = randomUUID();
    first.cashManagement.events.push({
      id: randomUUID(),
      type: 'MOVEMENT',
      date: '2026-10-25',
      sequence: 6,
      amount: '-20',
      transferId,
      transferCounterparty: {
        accountId: otherId,
        mode: 'CASH',
        amount: '20',
        currency: 'EUR'
      }
    });
    source.backup.accounts.push({
      id: otherId,
      name: 'Second source',
      currency: 'EUR',
      platformId: null,
      cashManagement: {
        version: 2,
        currency: 'EUR',
        defaultUpdateCash: true,
        openingBalance: { date: '2026-01-01', balance: '0', sequence: 0 },
        events: [
          {
            id: randomUUID(),
            type: 'MOVEMENT',
            date: '2026-10-25',
            sequence: 1,
            amount: '20',
            transferId,
            transferCounterparty: {
              accountId: first.id,
              mode: 'CASH',
              amount: '-20',
              currency: 'EUR'
            }
          }
        ]
      }
    });
    source.choices.push({ sourceId: otherId, targetId: 'NEW' });
    await commit(source);
    const backup = await exportPortfolio(userId);
    expect(
      backup.accounts.every((account) => account.cashManagement.version === 2)
    ).toBe(true);
    const sourceEvents = backup.accounts.find(
      (account) => account.name === first.name
    ).cashManagement.events;
    expect(
      sourceEvents.slice(0, 5).map((event) => event.economicClassification)
    ).toEqual(['EXTERNAL_CAPITAL', null, 'INCOME', 'EXPENSE', null]);
    const destinationUser = randomUUID();
    users.push(destinationUser);
    await prisma.user.create({ data: { id: destinationUser } });
    const request = (await new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    }).transform(
      {
        backup,
        choices: backup.accounts.map((account) => ({
          sourceId: account.id,
          targetId: 'NEW'
        }))
      },
      { type: 'body', metatype: PortfolioRestoreDto }
    )) as PortfolioRestoreDto;
    const preview = await service.run(request, destinationUser, true);
    expect(preview.errors).toEqual([]);
    await service.run(
      { ...request, digest: preview.digest },
      destinationUser,
      false
    );
    const restored = await exportPortfolio(destinationUser);
    for (const account of backup.accounts) {
      const next = restored.accounts.find(
        (candidate) => candidate.name === account.name
      );
      expect(next.id).not.toBe(account.id);
      const summarize = (events: typeof sourceEvents) =>
        events.map((event) => ({
          type: event.type,
          date: event.date,
          sequence: event.sequence,
          value: event.type === 'MOVEMENT' ? event.amount : event.balance,
          fee: event.fee ?? '0',
          economicClassification: event.economicClassification,
          importReference: event.importReference
        }));
      expect(summarize(next.cashManagement.events)).toEqual(
        summarize(account.cashManagement.events)
      );
      const before = await cash.getPersisted({ userId, accountId: account.id });
      const after = await cash.getPersisted({
        userId: destinationUser,
        accountId: next.id
      });
      expect(after.balances).toEqual(before.balances);
    }
    const linked = restored.accounts
      .flatMap((account) => account.cashManagement.events)
      .find((event) => event.orderId);
    expect(
      restored.activities.some((activity) => activity.id === linked.orderId)
    ).toBe(true);
    expect(
      backup.activities.some((activity) => activity.id === linked.orderId)
    ).toBe(false);
    const transfers = restored.accounts
      .flatMap((account) => account.cashManagement.events)
      .filter((event) => event.transferId);
    expect(transfers).toHaveLength(2);
    expect(transfers[0].transferId).toBe(transfers[1].transferId);
    expect(transfers[0].transferId).not.toBe(
      backup.accounts
        .flatMap((account) => account.cashManagement.events)
        .find((event) => event.transferId).transferId
    );
    expect(
      transfers.every((event) =>
        restored.accounts.some(
          (account) => account.id === event.transferCounterparty.accountId
        )
      )
    ).toBe(true);
    expect(
      transfers.every((event) => event.economicClassification === null)
    ).toBe(true);
  });

  it('restores v1 historical movements as null without inferring capital from signs', async () => {
    await commit(fixture());
    const events = await prisma.cashEvent.findMany({ where: { userId } });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.economicClassification === null)).toBe(
      true
    );
  });

  it.each([0, 3, '2'])(
    'explicitly rejects unsupported cash backup version %s',
    async (version) => {
      const input = fixture();
      input.backup.accounts[0].cashManagement.version = version as never;
      await expect(service.run(input, userId, true)).rejects.toThrow(
        'Unsupported cash ledger backup version'
      );
      expect(await prisma.account.count({ where: { userId } })).toBe(0);
    }
  );

  it('rejects a v2 classification mislabeled as v1 rather than silently dropping it', async () => {
    const input = fixture();
    input.backup.accounts[0].cashManagement.events[0].economicClassification =
      'INCOME';
    await expect(service.run(input, userId, true)).rejects.toThrow('version 2');
  });

  it.each([
    'order',
    'transfer',
    'checkpoint',
    'residual',
    'opening',
    'invalid-category'
  ])(
    'rejects v2 classification on %s before remapping or writing',
    async (kind) => {
      const input = fixture();
      const ledger = input.backup.accounts[0].cashManagement;
      ledger.version = 2;
      const event = ledger.events[kind === 'order' ? 1 : 0];
      event.economicClassification = 'INCOME';
      if (kind === 'transfer') event.transferId = randomUUID();
      if (kind === 'checkpoint')
        ledger.events[0] = {
          id: event.id,
          type: 'CHECKPOINT',
          balance: '5000',
          date: event.date,
          sequence: event.sequence,
          economicClassification: 'INCOME'
        };
      if (kind === 'residual')
        event.transferCounterparty = {
          accountId: randomUUID(),
          mode: 'LEGACY',
          amount: '-5000',
          currency: 'EUR'
        };
      if (kind === 'opening') {
        event.economicClassification = null;
        Object.assign(ledger.openingBalance, {
          economicClassification: 'INCOME'
        });
      }
      if (kind === 'invalid-category')
        event.economicClassification = 'UNKNOWN' as never;
      await expect(service.run(input, userId, true)).rejects.toThrow();
      expect(await prisma.account.count({ where: { userId } })).toBe(0);
      expect(await prisma.cashEvent.count({ where: { userId } })).toBe(0);
    }
  );

  it('rolls back a v2 restore after a classified ledger has actually been written', async () => {
    const input = fixture();
    input.backup.accounts[0].cashManagement.version = 2;
    input.backup.accounts[0].cashManagement.events[0].economicClassification =
      'EXTERNAL_CAPITAL';
    const plan = await service.run(input, userId, true);
    expect(plan.errors).toEqual([]);
    const original = cash.restoreInTransaction.bind(cash);
    const spy = jest
      .spyOn(cash, 'restoreInTransaction')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('after classified ledger write');
      });
    try {
      await expect(
        service.run({ ...input, digest: plan.digest }, userId, false)
      ).rejects.toThrow('after classified ledger write');
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.account.count({ where: { userId } })).toBe(0);
    expect(await prisma.order.count({ where: { userId } })).toBe(0);
    expect(await prisma.cashEvent.count({ where: { userId } })).toBe(0);
  });
  it('does not reuse an existing activity with a different tax, while missing tax still matches zero', async () => {
    const first = fixture();
    delete first.backup.accounts[0].cashManagement;
    await commit(first);
    const account = await prisma.account.findFirst({ where: { userId } });
    const next = fixture();
    delete next.backup.accounts[0].cashManagement;
    next.choices[0].targetId = account.id;
    // Keep the source instrument identity consistent with the first backup.
    next.backup.assetProfiles = first.backup.assetProfiles;
    next.backup.activities[0] = {
      ...first.backup.activities[0],
      accountId: next.backup.accounts[0].id,
      id: randomUUID()
    };
    const zero = await service.run(next, userId, true);
    expect(zero.errors).toEqual([]);
    expect(zero.duplicates).toBe(1);
    next.backup.activities[0].tax = 2;
    const taxed = await service.run(next, userId, true);
    expect(taxed.errors).toEqual([]);
    expect(taxed.duplicates).toBe(0);
    await service.run({ ...next, digest: taxed.digest }, userId, false);
    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { tax: 'asc' }
    });
    expect(orders.map((o) => o.tax)).toEqual([0, 2]);
  });
  it.each(['-303', '-301'])(
    'preserves a taxed ledger amount %s exactly, including historical pre-fix values',
    async (amount) => {
      const input = fixture();
      input.backup.activities[0].tax = 2;
      const event = input.backup.accounts[0].cashManagement.events[1];
      if (event.type !== 'MOVEMENT')
        throw new Error('Expected a linked movement');
      event.amount = amount;
      await commit(input);
      const account = await prisma.account.findFirst({ where: { userId } });
      const state = await cash.get({ accountId: account.id, userId });
      const linked = state.events.find((e) => e.orderId);
      expect(linked).toMatchObject({ type: 'MOVEMENT', amount });
      const order = await prisma.order.findUnique({
        where: { id: linked.orderId }
      });
      expect(order.tax).toBe(2);
      expect(state.balances.at(-1).value).toBe(
        amount === '-303' ? '4697' : '4699'
      );
      // Restore the already materialized journal to another user: no tax is deducted twice.
      const second = randomUUID();
      users.push(second);
      await prisma.user.create({ data: { id: second } });
      const exported: PortfolioRestoreDto = {
        choices: [{ sourceId: account.id, targetId: 'NEW' }],
        backup: {
          ...input.backup,
          accounts: [
            {
              ...input.backup.accounts[0],
              id: account.id,
              cashManagement: {
                ...input.backup.accounts[0].cashManagement,
                events: state.events
              }
            }
          ],
          activities: [
            {
              ...input.backup.activities[0],
              id: order.id,
              accountId: account.id
            }
          ]
        }
      };
      const plan = await service.run(exported, second, true);
      expect(plan.errors).toEqual([]);
      await service.run({ ...exported, digest: plan.digest }, second, false);
      const destination = await prisma.account.findFirst({
        where: { userId: second }
      });
      const again = await cash.get({
        accountId: destination.id,
        userId: second
      });
      expect(again.events.find((e) => e.orderId)).toMatchObject({ amount });
      expect(again.balances.at(-1).value).toBe(state.balances.at(-1).value);
    }
  );
  it('previews without writes, restores linked activity and cash with fresh IDs, and can export and restore a second time', async () => {
    const input = fixture();
    const sourceId = input.backup.accounts[0].id;
    const plan = await service.run(input, userId, true);
    expect(plan.cashEvents).toBe(2);
    expect(plan.accounts[0].cashBalance).toBe('4699');
    expect(await prisma.account.count({ where: { userId } })).toBe(0);
    await service.run({ ...input, digest: plan.digest }, userId, false);
    const account = await prisma.account.findFirst({ where: { userId } });
    expect(account.id).not.toBe(sourceId);
    const state = await cash.get({ accountId: account.id, userId });
    expect(state.balances.at(-1).value).toBe('4699');
    const linked = state.events.find((e) => e.orderId);
    const order = await prisma.order.findUnique({
      where: { id: linked.orderId },
      include: { SymbolProfile: true }
    });
    expect(order.id).not.toBe(input.backup.activities[0].id);
    expect(order.accountId).toBe(account.id);
    expect(order.SymbolProfile.userId).toBe(userId);
    expect(
      await prisma.marketData.count({
        where: { symbol: order.SymbolProfile.symbol }
      })
    ).toBe(1);
    const prefs = await prisma.settings.findUnique({ where: { userId } });
    expect(prefs.settings).toMatchObject({
      baseCurrency: 'EUR',
      performanceCalculationType: 'TWR'
    });
    // Simulate a second server/user: the exported source identifiers may still exist here.
    const second = randomUUID();
    users.push(second);
    await prisma.user.create({ data: { id: second } });
    const exported: PortfolioRestoreDto = {
      choices: [{ sourceId: account.id, targetId: 'NEW' }],
      backup: {
        ...input.backup,
        accounts: [
          {
            ...input.backup.accounts[0],
            id: account.id,
            cashManagement: {
              ...input.backup.accounts[0].cashManagement,
              events: state.events
            }
          }
        ],
        activities: [
          { ...input.backup.activities[0], id: order.id, accountId: account.id }
        ]
      }
    };
    const next = await service.run(exported, second, true);
    expect(next.errors).toEqual([]);
    await service.run({ ...exported, digest: next.digest }, second, false);
    const secondAccount = await prisma.account.findFirst({
      where: { userId: second }
    });
    expect(
      (
        await cash.get({ accountId: secondAccount.id, userId: second })
      ).balances.at(-1).value
    ).toBe('4699');
  });
  it.each([
    {
      direction: 'Cash to Legacy',
      reverse: false,
      legacyCurrency: 'EUR',
      convertedAmount: 25
    },
    {
      direction: 'Legacy to Cash',
      reverse: true,
      legacyCurrency: 'EUR',
      convertedAmount: 25
    },
    {
      direction: 'Cash EUR to Legacy USD',
      reverse: false,
      legacyCurrency: 'USD',
      convertedAmount: 22.5
    }
  ])(
    'round-trips $direction without replaying the legacy balance',
    async ({ reverse, legacyCurrency, convertedAmount }) => {
      const managed = await prisma.account.create({
        data: { userId, currency: 'EUR', name: 'Managed source' }
      });
      const legacy = await prisma.account.create({
        data: { userId, currency: legacyCurrency, name: 'Legacy destination' }
      });

      await cash.open({
        accountId: managed.id,
        userId,
        date: '2026-01-01',
        balance: reverse ? '0' : '100'
      });

      if (reverse) {
        await prisma.accountBalance.create({
          data: {
            accountId: legacy.id,
            userId,
            date: new Date('2026-01-01T00:00:00.000Z'),
            value: 100
          }
        });
      }

      const transferService = new CashManagementService(emitter, prisma, {
        toCurrencyAtDate: jest.fn((amount: number, from: string, to: string) =>
          from === 'EUR' && to === 'USD' ? convertedAmount : amount
        )
      } as never);

      await transferService.transfer({
        accountIdFrom: reverse ? legacy.id : managed.id,
        accountIdTo: reverse ? managed.id : legacy.id,
        balance: 25,
        userId
      });

      const original = await prisma.cashEvent.findMany({
        where: { userId, transferId: { not: null } }
      });
      expect(original).toHaveLength(1);
      expect(original[0].transferCounterpartyMode).toBe('LEGACY');
      expect(original[0].transferCounterpartyAccountId).toBe(legacy.id);
      expect(original[0].transferCounterpartyAmount.toString()).toBe(
        reverse ? '-25' : String(convertedAmount)
      );

      const exporter = new ExportService(
        {
          accounts: ({ where }) =>
            prisma.account.findMany({
              where,
              include: { balances: true, tags: true, platform: true }
            })
        } as never,
        { getActivities: async () => ({ activities: [] }) } as never,
        null,
        { getTagsForUser: async () => [] } as never,
        cash
      );

      const backup = await exporter.export({
        userId,
        userSettings: { baseCurrency: 'EUR' } as never
      });

      const sourceCash = backup.accounts.find((a) => a.id === managed.id);
      const sourceLegacy = backup.accounts.find((a) => a.id === legacy.id);

      expect(sourceCash.cashManagement.events).toHaveLength(1);
      expect(sourceCash.cashManagement.events[0].transferCounterparty).toEqual({
        accountId: legacy.id,
        mode: 'LEGACY',
        amount: reverse ? '-25' : String(convertedAmount),
        currency: legacyCurrency
      });
      expect(sourceLegacy).not.toHaveProperty('cashManagement');
      expect(sourceLegacy.balances.length).toBeGreaterThan(0);
      expect(sourceLegacy.balances.at(-1).value).toBe(
        reverse ? 75 : convertedAmount
      );

      const restoredUserId = randomUUID();
      users.push(restoredUserId);
      await prisma.user.create({ data: { id: restoredUserId } });

      const input = (await new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      }).transform(
        {
          backup,
          choices: backup.accounts.map((a) => ({
            sourceId: a.id,
            targetId: 'NEW'
          }))
        },
        { metatype: PortfolioRestoreDto, type: 'body' }
      )) as PortfolioRestoreDto;

      const preview = await service.run(input, restoredUserId, true);
      expect(preview.errors).toEqual([]);
      await service.run(
        { ...input, digest: preview.digest },
        restoredUserId,
        false
      );

      const restoredCash = await prisma.account.findFirstOrThrow({
        where: { userId: restoredUserId, name: 'Managed source' }
      });
      const restoredLegacy = await prisma.account.findFirstOrThrow({
        where: { userId: restoredUserId, name: 'Legacy destination' },
        include: { balances: true, cashState: true }
      });
      const events = await prisma.cashEvent.findMany({
        where: { userId: restoredUserId, transferId: { not: null } }
      });

      expect(restoredCash.id).not.toBe(managed.id);
      expect(restoredLegacy.id).not.toBe(legacy.id);
      expect(events).toHaveLength(1);
      expect(events[0].transferCounterpartyAccountId).toBe(restoredLegacy.id);
      expect(events[0].transferCounterpartyMode).toBe('LEGACY');
      expect(events[0].transferCounterpartyAmount.toString()).toBe(
        reverse ? '-25' : String(convertedAmount)
      );
      expect(events[0].transferCounterpartyCurrency).toBe(legacyCurrency);
      expect(events[0].transferId).not.toBe(original[0].transferId);

      expect(
        (
          await cash.get({
            accountId: restoredCash.id,
            userId: restoredUserId
          })
        ).balances.at(-1).value
      ).toBe(reverse ? '25' : '75');

      expect(restoredLegacy.cashState).toBeNull();
      expect(restoredLegacy.balances).toHaveLength(
        sourceLegacy.balances.length
      );
      expect(restoredLegacy.balances.at(-1).value).toBe(
        reverse ? 75 : convertedAmount
      );
    }
  );

  it('accepts old exports without activity IDs or cash ledger', async () => {
    const input = fixture();
    delete input.backup.accounts[0].cashManagement;
    delete input.backup.activities[0].id;
    input.backup.accounts[0].balances = [
      { date: new Date('2026-01-01'), value: 700 } as never
    ];
    await commit(input);
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
    expect(
      (await prisma.accountBalance.findFirst({ where: { userId } })).value
    ).toBe(700);
  });
  it('rejects missing links before any write', async () => {
    const input = fixture();
    delete input.backup.activities[0].id;
    const plan = await service.run(input, userId, true);
    expect(plan.errors.join()).toContain('linked activity is missing');
    await expect(
      service.run({ ...input, digest: plan.digest }, userId, false)
    ).rejects.toThrow();
    expect(await prisma.account.count({ where: { userId } })).toBe(0);
  });
  it('rolls back accounts, assets, activities and cash if the final ledger write fails', async () => {
    const input = fixture();
    const plan = await service.run(input, userId, true);
    const restore = jest
      .spyOn(cash, 'restoreInTransaction')
      .mockRejectedValueOnce(Error('simulated projection failure'));
    await expect(
      service.run({ ...input, digest: plan.digest }, userId, false)
    ).rejects.toThrow('simulated projection failure');
    restore.mockRestore();
    expect(await prisma.account.count({ where: { userId } })).toBe(0);
    expect(await prisma.order.count({ where: { userId } })).toBe(0);
    expect(await prisma.symbolProfile.count({ where: { userId } })).toBe(0);
    expect(await prisma.cashEvent.count({ where: { userId } })).toBe(0);
  });
  it('detects changes after preview and rejects a double submission', async () => {
    const input = fixture();
    const plan = await service.run(input, userId, true);
    await service.run({ ...input, digest: plan.digest }, userId, false);
    await expect(
      service.run({ ...input, digest: plan.digest }, userId, false)
    ).rejects.toThrow('changed');
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
  });
  it('rejects confirmation when an existing cash event changes after preview', async () => {
    await commit(fixture());

    const input = fixture();
    const plan = await service.run(input, userId, true);
    expect(plan.errors).toEqual([]);

    const existingEvent = await prisma.cashEvent.findFirstOrThrow({
      where: { userId }
    });

    await prisma.cashEvent.update({
      where: { id: existingEvent.id },
      data: { comment: 'Changed after preview' }
    });

    await expect(
      service.run({ ...input, digest: plan.digest }, userId, false)
    ).rejects.toThrow('changed');

    expect(await prisma.account.count({ where: { userId } })).toBe(1);
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
    expect(await prisma.cashEvent.count({ where: { userId } })).toBe(2);
  });

  it('requires every backup account to be recreated in REPLACE mode', async () => {
    const input = fixture();
    input.choices[0].targetId = 'SKIP';

    await expect(service.run(input, userId, true, 'REPLACE')).rejects.toThrow(
      'Replacement requires every source account to be recreated.'
    );

    expect(await prisma.account.count({ where: { userId } })).toBe(0);
  });

  it('replaces existing accounts, orders and cash events atomically', async () => {
    await commit(fixture());

    const oldAccount = await prisma.account.findFirstOrThrow({
      where: { userId }
    });
    const oldOrder = await prisma.order.findFirstOrThrow({
      where: { userId }
    });
    const oldEventIds = (
      await prisma.cashEvent.findMany({
        where: { userId },
        select: { id: true }
      })
    ).map(({ id }) => id);

    const input = fixture();
    const preview = await service.run(input, userId, true, 'REPLACE');

    expect(preview.errors).toEqual([]);
    expect(preview.newActivities).toBe(1);
    expect(preview.duplicates).toBe(0);

    await service.run(
      { ...input, digest: preview.digest },
      userId,
      false,
      'REPLACE'
    );

    const accounts = await prisma.account.findMany({ where: { userId } });
    const orders = await prisma.order.findMany({ where: { userId } });
    const events = await prisma.cashEvent.findMany({ where: { userId } });

    expect(accounts).toHaveLength(1);
    expect(orders).toHaveLength(1);
    expect(events).toHaveLength(2);

    expect(accounts[0].id).not.toBe(oldAccount.id);
    expect(orders[0].id).not.toBe(oldOrder.id);
    expect(orders[0].accountId).toBe(accounts[0].id);
    expect(events.every(({ id }) => !oldEventIds.includes(id))).toBe(true);
    expect(events.some(({ orderId }) => orderId === orders[0].id)).toBe(true);

    expect(
      await prisma.account.count({
        where: { id: oldAccount.id, userId }
      })
    ).toBe(0);
    expect(
      await prisma.order.count({
        where: { id: oldOrder.id, userId }
      })
    ).toBe(0);
  });

  it('preserves historical manual profiles and prices while replacing financial activities', async () => {
    await commit(fixture());

    const oldProfile = await prisma.symbolProfile.findFirstOrThrow({
      where: { userId, dataSource: 'MANUAL' }
    });

    const oldOrder = await prisma.order.findFirstOrThrow({
      where: { userId }
    });

    const oldPrices = await prisma.marketData.findMany({
      where: {
        dataSource: 'MANUAL',
        symbol: oldProfile.symbol
      },
      orderBy: { date: 'asc' }
    });

    expect(oldPrices).toHaveLength(1);

    const input = fixture();
    const preview = await service.run(input, userId, true, 'REPLACE');

    expect(preview.errors).toEqual([]);

    await service.run(
      { ...input, digest: preview.digest },
      userId,
      false,
      'REPLACE'
    );

    expect(
      await prisma.symbolProfile.findUnique({
        where: { id: oldProfile.id }
      })
    ).toEqual(oldProfile);

    expect(
      await prisma.marketData.findMany({
        where: {
          dataSource: 'MANUAL',
          symbol: oldProfile.symbol
        },
        orderBy: { date: 'asc' }
      })
    ).toEqual(oldPrices);

    expect(
      await prisma.order.count({
        where: { userId, id: oldOrder.id }
      })
    ).toBe(0);

    const newOrders = await prisma.order.findMany({
      where: { userId }
    });

    expect(newOrders).toHaveLength(1);
    expect(newOrders[0].symbolProfileId).not.toBe(oldProfile.id);

    expect(
      await prisma.symbolProfile.count({
        where: { userId, dataSource: 'MANUAL' }
      })
    ).toBe(2);
  });

  it('preserves watched private manual profiles and their prices during REPLACE', async () => {
    await commit(fixture());

    const oldProfile = await prisma.symbolProfile.findFirstOrThrow({
      where: { userId, dataSource: 'MANUAL' }
    });
    const oldOrder = await prisma.order.findFirstOrThrow({
      where: { userId }
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        watchlist: {
          connect: { id: oldProfile.id }
        }
      }
    });

    const oldPrices = await prisma.marketData.findMany({
      where: {
        dataSource: 'MANUAL',
        symbol: oldProfile.symbol
      },
      orderBy: { date: 'asc' }
    });

    expect(oldPrices).toHaveLength(1);

    const input = fixture();
    const preview = await service.run(input, userId, true, 'REPLACE');
    expect(preview.errors).toEqual([]);

    await service.run(
      { ...input, digest: preview.digest },
      userId,
      false,
      'REPLACE'
    );

    expect(
      await prisma.symbolProfile.findUnique({
        where: { id: oldProfile.id }
      })
    ).toEqual(oldProfile);

    expect(
      await prisma.marketData.findMany({
        where: {
          dataSource: 'MANUAL',
          symbol: oldProfile.symbol
        },
        orderBy: { date: 'asc' }
      })
    ).toEqual(oldPrices);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { watchlist: true }
    });

    expect(user.watchlist.map(({ id }) => id)).toContain(oldProfile.id);

    expect(
      await prisma.order.count({
        where: { id: oldOrder.id, userId }
      })
    ).toBe(0);

    expect(
      await prisma.order.count({
        where: { userId }
      })
    ).toBe(1);

    expect(
      await prisma.symbolProfile.count({
        where: { userId, dataSource: 'MANUAL' }
      })
    ).toBe(2);
  });

  it('preserves benchmark manual profiles and historical prices during REPLACE', async () => {
    await commit(fixture());

    const profile = await prisma.symbolProfile.findFirstOrThrow({
      where: { userId, dataSource: 'MANUAL' }
    });
    const oldOrder = await prisma.order.findFirstOrThrow({
      where: { userId }
    });
    const prices = await prisma.marketData.findMany({
      where: { dataSource: 'MANUAL', symbol: profile.symbol },
      orderBy: { date: 'asc' }
    });

    const originalProperty = await prisma.property.findUnique({
      where: { key: PROPERTY_BENCHMARKS }
    });

    try {
      const benchmarks = originalProperty
        ? JSON.parse(originalProperty.value)
        : [];

      expect(Array.isArray(benchmarks)).toBe(true);

      await prisma.property.upsert({
        where: { key: PROPERTY_BENCHMARKS },
        create: {
          key: PROPERTY_BENCHMARKS,
          value: JSON.stringify([
            ...benchmarks,
            { symbolProfileId: profile.id }
          ])
        },
        update: {
          value: JSON.stringify([
            ...benchmarks,
            { symbolProfileId: profile.id }
          ])
        }
      });

      const input = fixture();
      const preview = await service.run(input, userId, true, 'REPLACE');
      expect(preview.errors).toEqual([]);

      await service.run(
        { ...input, digest: preview.digest },
        userId,
        false,
        'REPLACE'
      );

      expect(
        await prisma.symbolProfile.findUnique({
          where: { id: profile.id }
        })
      ).toEqual(profile);

      expect(
        await prisma.marketData.findMany({
          where: { dataSource: 'MANUAL', symbol: profile.symbol },
          orderBy: { date: 'asc' }
        })
      ).toEqual(prices);

      expect(
        await prisma.order.count({
          where: { id: oldOrder.id, userId }
        })
      ).toBe(0);

      expect(
        await prisma.order.count({
          where: { userId }
        })
      ).toBe(1);

      const configured = await prisma.property.findUniqueOrThrow({
        where: { key: PROPERTY_BENCHMARKS }
      });
      expect(
        JSON.parse(configured.value).some(
          (item: { symbolProfileId: string }) =>
            item.symbolProfileId === profile.id
        )
      ).toBe(true);
    } finally {
      if (originalProperty) {
        await prisma.property.upsert({
          where: { key: PROPERTY_BENCHMARKS },
          create: originalProperty,
          update: { value: originalProperty.value }
        });
      } else {
        await prisma.property.deleteMany({
          where: { key: PROPERTY_BENCHMARKS }
        });
      }
    }
  });

  it('preserves malformed benchmark configuration without blocking REPLACE', async () => {
    await commit(fixture());

    const oldProfile = await prisma.symbolProfile.findFirstOrThrow({
      where: { userId, dataSource: 'MANUAL' }
    });

    const oldOrder = await prisma.order.findFirstOrThrow({
      where: { userId }
    });

    const originalProperty = await prisma.property.findUnique({
      where: { key: PROPERTY_BENCHMARKS }
    });

    try {
      for (const invalidValue of [
        JSON.stringify([{ invalid: true }]),
        '{invalid-json'
      ]) {
        await prisma.property.upsert({
          where: { key: PROPERTY_BENCHMARKS },
          create: {
            key: PROPERTY_BENCHMARKS,
            value: invalidValue
          },
          update: { value: invalidValue }
        });

        const input = fixture();
        const preview = await service.run(input, userId, true, 'REPLACE');

        expect(preview.errors).toEqual([]);

        await service.run(
          { ...input, digest: preview.digest },
          userId,
          false,
          'REPLACE'
        );

        expect(
          await prisma.property.findUniqueOrThrow({
            where: { key: PROPERTY_BENCHMARKS }
          })
        ).toMatchObject({ value: invalidValue });

        expect(
          await prisma.symbolProfile.findUnique({
            where: { id: oldProfile.id }
          })
        ).toEqual(oldProfile);

        expect(
          await prisma.order.count({
            where: { userId, id: oldOrder.id }
          })
        ).toBe(0);

        expect(await prisma.order.count({ where: { userId } })).toBe(1);
      }
    } finally {
      if (originalProperty) {
        await prisma.property.upsert({
          where: { key: PROPERTY_BENCHMARKS },
          create: originalProperty,
          update: { value: originalProperty.value }
        });
      } else {
        await prisma.property.deleteMany({
          where: { key: PROPERTY_BENCHMARKS }
        });
      }
    }
  });

  it('keeps REPLACE confirmation valid after a benchmark change', async () => {
    await commit(fixture());

    const oldProfile = await prisma.symbolProfile.findFirstOrThrow({
      where: { userId, dataSource: 'MANUAL' }
    });

    const oldOrder = await prisma.order.findFirstOrThrow({
      where: { userId }
    });

    const originalProperty = await prisma.property.findUnique({
      where: { key: PROPERTY_BENCHMARKS }
    });

    const input = fixture();
    const preview = await service.run(input, userId, true, 'REPLACE');

    expect(preview.errors).toEqual([]);

    try {
      const benchmarks = originalProperty
        ? JSON.parse(originalProperty.value)
        : [];

      expect(Array.isArray(benchmarks)).toBe(true);

      const updatedBenchmarks = [
        ...benchmarks,
        { symbolProfileId: oldProfile.id }
      ];

      const updatedValue = JSON.stringify(updatedBenchmarks);

      await prisma.property.upsert({
        where: { key: PROPERTY_BENCHMARKS },
        create: {
          key: PROPERTY_BENCHMARKS,
          value: updatedValue
        },
        update: { value: updatedValue }
      });

      await service.run(
        { ...input, digest: preview.digest },
        userId,
        false,
        'REPLACE'
      );

      expect(
        await prisma.property.findUniqueOrThrow({
          where: { key: PROPERTY_BENCHMARKS }
        })
      ).toMatchObject({ value: updatedValue });

      expect(
        await prisma.symbolProfile.findUnique({
          where: { id: oldProfile.id }
        })
      ).toEqual(oldProfile);

      expect(
        await prisma.order.count({
          where: { userId, id: oldOrder.id }
        })
      ).toBe(0);

      expect(await prisma.order.count({ where: { userId } })).toBe(1);

      const newPreview = await service.run(input, userId, true, 'REPLACE');

      expect(newPreview.errors).toEqual([]);
    } finally {
      if (originalProperty) {
        await prisma.property.upsert({
          where: { key: PROPERTY_BENCHMARKS },
          create: originalProperty,
          update: { value: originalProperty.value }
        });
      } else {
        await prisma.property.deleteMany({
          where: { key: PROPERTY_BENCHMARKS }
        });
      }
    }
  });

  it('previews REPLACE deletion counts without changing the IMPORT contract', async () => {
    await commit(fixture());

    const input = fixture();

    const importPreview = await service.run(input, userId, true, 'IMPORT');
    expect(importPreview).not.toHaveProperty('replacement');

    const replacePreview = await service.run(input, userId, true, 'REPLACE');

    expect(replacePreview.errors).toEqual([]);
    expect(replacePreview.replacement).toEqual({
      accountsToDelete: 1,
      activitiesToDelete: 1,
      cashEventsToDelete: 2
    });
    expect(replacePreview.accounts).toHaveLength(1);
    expect(replacePreview.newActivities).toBe(1);
    expect(replacePreview.duplicates).toBe(0);
    expect(replacePreview.cashEvents).toBe(2);
    expect(replacePreview.digest).not.toBe(importPreview.digest);

    expect(replacePreview.warnings.join(' ')).toContain('will be replaced');
    expect(replacePreview.warnings.join(' ')).not.toContain(
      'Existing data is retained'
    );

    expect(await prisma.account.count({ where: { userId } })).toBe(1);
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
    expect(await prisma.cashEvent.count({ where: { userId } })).toBe(2);
  });

  it('preserves personal settings in REPLACE even for an empty portfolio', async () => {
    const input = fixture();
    input.restoreSettings = true;
    input.backup.user = {
      settings: {
        currency: 'USD',
        performanceCalculationType: 'ROI'
      }
    };

    await prisma.settings.upsert({
      where: { userId },
      create: {
        userId,
        settings: {
          baseCurrency: 'CHF',
          performanceCalculationType: 'MWR'
        }
      },
      update: {
        settings: {
          baseCurrency: 'CHF',
          performanceCalculationType: 'MWR'
        }
      }
    });

    const before = await prisma.settings.findUnique({
      where: { userId }
    });

    const preview = await service.run(input, userId, true, 'REPLACE');

    expect(preview.errors).toEqual([]);
    expect(preview.replacement).toEqual({
      accountsToDelete: 0,
      activitiesToDelete: 0,
      cashEventsToDelete: 0
    });

    await service.run(
      { ...input, digest: preview.digest },
      userId,
      false,
      'REPLACE'
    );

    expect(await prisma.settings.findUnique({ where: { userId } })).toEqual(
      before
    );

    expect(await prisma.account.count({ where: { userId } })).toBe(1);
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
  });

  it('rolls back the complete previous portfolio when REPLACE reconstruction fails', async () => {
    await commit(fixture());

    const snapshot = async () => ({
      accounts: await prisma.account.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        include: { balances: true, cashState: true, tags: true }
      }),
      orders: await prisma.order.findMany({
        where: { userId },
        orderBy: { id: 'asc' }
      }),
      cashEvents: await prisma.cashEvent.findMany({
        where: { userId },
        orderBy: { id: 'asc' }
      }),
      settings: await prisma.settings.findUnique({
        where: { userId }
      })
    });

    const before = await snapshot();
    const input = fixture();
    const preview = await service.run(input, userId, true, 'REPLACE');

    expect(preview.errors).toEqual([]);

    const restore = jest
      .spyOn(cash, 'restoreInTransaction')
      .mockRejectedValueOnce(
        new Error('simulated replacement reconstruction failure')
      );

    try {
      await expect(
        service.run(
          { ...input, digest: preview.digest },
          userId,
          false,
          'REPLACE'
        )
      ).rejects.toThrow('simulated replacement reconstruction failure');
    } finally {
      restore.mockRestore();
    }

    expect(await snapshot()).toEqual(before);
  });

  it('does not modify another user portfolio during REPLACE', async () => {
    const otherUserId = randomUUID();
    users.push(otherUserId);
    await prisma.user.create({ data: { id: otherUserId } });

    const otherInput = fixture();
    const otherPreview = await service.run(otherInput, otherUserId, true);
    expect(otherPreview.errors).toEqual([]);
    await service.run(
      { ...otherInput, digest: otherPreview.digest },
      otherUserId,
      false
    );

    const snapshot = async () => ({
      accounts: await prisma.account.findMany({
        where: { userId: otherUserId },
        orderBy: { id: 'asc' },
        include: { balances: true, cashState: true, tags: true }
      }),
      orders: await prisma.order.findMany({
        where: { userId: otherUserId },
        orderBy: { id: 'asc' }
      }),
      cashEvents: await prisma.cashEvent.findMany({
        where: { userId: otherUserId },
        orderBy: { id: 'asc' }
      }),
      settings: await prisma.settings.findUnique({
        where: { userId: otherUserId }
      })
    });

    const before = await snapshot();

    await commit(fixture());

    const replacement = fixture();
    const preview = await service.run(replacement, userId, true, 'REPLACE');
    expect(preview.errors).toEqual([]);

    await service.run(
      { ...replacement, digest: preview.digest },
      userId,
      false,
      'REPLACE'
    );

    expect(await snapshot()).toEqual(before);
    expect(
      await prisma.account.count({
        where: { userId }
      })
    ).toBe(1);
  });

  it('replaces reciprocal transfers without retaining old cash references', async () => {
    const transferFixture = () => {
      const input = fixture();
      const first = input.backup.accounts[0];
      const secondId = randomUUID();
      const transferId = randomUUID();

      first.cashManagement.events.push({
        id: randomUUID(),
        date: '2026-03-01',
        sequence: 3,
        type: 'MOVEMENT',
        amount: '-20',
        transferId
      });

      input.backup.accounts.push({
        id: secondId,
        name: 'Transfer destination',
        currency: 'EUR',
        platformId: null,
        cashManagement: {
          ...first.cashManagement,
          events: [
            {
              id: randomUUID(),
              date: '2026-03-01',
              sequence: 1,
              type: 'MOVEMENT',
              amount: '20',
              transferId
            }
          ]
        }
      });

      input.choices.push({ sourceId: secondId, targetId: 'NEW' });

      return input;
    };

    await commit(transferFixture());

    const oldAccounts = await prisma.account.findMany({
      where: { userId },
      select: { id: true }
    });
    const oldEvents = await prisma.cashEvent.findMany({
      where: { userId },
      select: { id: true, transferId: true }
    });

    expect(oldAccounts).toHaveLength(2);
    expect(oldEvents.filter((event) => event.transferId)).toHaveLength(2);

    const replacement = transferFixture();
    const preview = await service.run(replacement, userId, true, 'REPLACE');

    expect(preview.errors).toEqual([]);

    await service.run(
      { ...replacement, digest: preview.digest },
      userId,
      false,
      'REPLACE'
    );

    const accounts = await prisma.account.findMany({
      where: { userId }
    });
    const events = await prisma.cashEvent.findMany({
      where: { userId }
    });

    expect(accounts).toHaveLength(2);
    expect(events).toHaveLength(4);

    const oldAccountIds = new Set(oldAccounts.map(({ id }) => id));
    const oldEventIds = new Set(oldEvents.map(({ id }) => id));
    const newAccountIds = new Set(accounts.map(({ id }) => id));

    expect(accounts.every(({ id }) => !oldAccountIds.has(id))).toBe(true);
    expect(events.every(({ id }) => !oldEventIds.has(id))).toBe(true);
    expect(events.every(({ accountId }) => newAccountIds.has(accountId))).toBe(
      true
    );

    const transfers = events.filter(({ transferId }) => transferId !== null);
    expect(transfers).toHaveLength(2);
    expect(transfers[0].transferId).toBe(transfers[1].transferId);
    expect(transfers[0].transferId).not.toBeNull();

    const oldTransferIds = new Set(
      oldEvents.map(({ transferId }) => transferId).filter(Boolean)
    );
    expect(oldTransferIds.has(transfers[0].transferId)).toBe(false);

    expect(transfers[0].accountId).not.toBe(transfers[1].accountId);
    expect(
      events.every(
        ({ transferCounterpartyAccountId }) =>
          transferCounterpartyAccountId === null ||
          newAccountIds.has(transferCounterpartyAccountId)
      )
    ).toBe(true);
  });

  it('requires both sides of a transfer and remaps transfer identifiers', async () => {
    const input = fixture(),
      first = input.backup.accounts[0],
      secondId = randomUUID(),
      transferId = randomUUID();
    first.cashManagement.events.push({
      id: randomUUID(),
      date: '2026-03-01',
      sequence: 3,
      type: 'MOVEMENT',
      amount: '-20',
      transferId
    });
    input.backup.accounts.push({
      id: secondId,
      name: 'Other account',
      currency: 'EUR',
      platformId: null,
      cashManagement: {
        ...first.cashManagement,
        events: [
          {
            id: randomUUID(),
            date: '2026-03-01',
            sequence: 1,
            type: 'MOVEMENT',
            amount: '20',
            transferId
          }
        ]
      }
    });
    input.choices.push({ sourceId: secondId, targetId: 'SKIP' });
    expect((await service.run(input, userId, true)).errors.join()).toContain(
      'both source and destination'
    );
    input.choices[1].targetId = 'NEW';
    await commit(input);
    const events = await prisma.cashEvent.findMany({
      where: { userId, transferId: { not: null } }
    });
    expect(events).toHaveLength(2);
    expect(events[0].transferId).toBe(events[1].transferId);
    expect(events[0].transferId).not.toBe(transferId);
  });
  it('does not match account names and refuses another users account', async () => {
    const input = fixture();
    await prisma.account.create({
      data: { userId, name: input.backup.accounts[0].name, currency: 'EUR' }
    });
    expect((await service.run(input, userId, true)).accounts[0].action).toBe(
      'NEW'
    );
    const other = randomUUID();
    users.push(other);
    await prisma.user.create({ data: { id: other } });
    const foreign = await prisma.account.create({
      data: { userId: other, currency: 'EUR' }
    });
    input.choices[0].targetId = foreign.id;
    expect((await service.run(input, userId, true)).errors.join()).toContain(
      'Destination account not found'
    );
  });
  it('associates an empty existing account explicitly and protects existing ledgers', async () => {
    const input = fixture();
    const target = await prisma.account.create({
      data: { userId, currency: 'EUR', name: 'Existing' }
    });
    input.choices[0].targetId = target.id;
    await commit(input);
    expect(await prisma.account.count({ where: { userId } })).toBe(1);
    expect((await service.run(input, userId, true)).errors.join()).toContain(
      'already has cash history'
    );
  });
  it('keeps unmanaged balances before the cash ledger opening', async () => {
    const input = fixture();
    input.backup.accounts[0].balances = [
      { date: new Date('2025-12-01'), value: 123 } as never
    ];
    await commit(input);
    const balances = await prisma.accountBalance.findMany({
      where: { userId },
      orderBy: { date: 'asc' }
    });
    expect(balances[0].date.toISOString().slice(0, 10)).toBe('2025-12-01');
    expect(balances[0].value).toBe(123);
    expect(balances.at(-1).value).toBe(4699);
  });

  it('restores settings for a new user with an empty default account', async () => {
    await prisma.account.create({
      data: { userId, name: 'My Account', currency: 'CHF' }
    });
    await commit(fixture());
    expect(
      (await prisma.settings.findUnique({ where: { userId } })).settings
    ).toMatchObject({ baseCurrency: 'EUR' });
  });

  it('recognizes an existing financial activity in an explicitly selected account without adding it again', async () => {
    const input = fixture();
    delete input.backup.accounts[0].cashManagement;
    const target = await prisma.account.create({
      data: { userId, currency: 'EUR', name: 'Target' }
    });
    const a = input.backup.activities[0];
    const profile = await prisma.symbolProfile.create({
      data: { userId, dataSource: 'MANUAL', symbol: a.symbol, currency: 'EUR' }
    });
    await prisma.order.create({
      data: {
        userId,
        accountId: target.id,
        accountUserId: userId,
        symbolProfileId: profile.id,
        date: new Date(a.date),
        type: a.type,
        quantity: a.quantity,
        unitPrice: a.unitPrice,
        fee: a.fee,
        currency: a.currency
      }
    });
    input.choices[0].targetId = target.id;
    const plan = await service.run(input, userId, true);
    expect(plan.duplicates).toBe(1);
    expect(plan.newActivities).toBe(0);
    await service.run({ ...input, digest: plan.digest }, userId, false);
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
    expect(await prisma.symbolProfile.count({ where: { userId } })).toBe(1);
  });

  it('restores cash after activities were imported first, even if a manual symbol changed', async () => {
    const input = fixture();
    const a = input.backup.activities[0];
    const target = await prisma.account.create({
      data: { userId, currency: 'EUR', name: 'Activities imported first' }
    });
    const profile = await prisma.symbolProfile.create({
      data: {
        userId,
        dataSource: 'MANUAL',
        symbol: randomUUID(),
        name: input.backup.assetProfiles[0].name,
        currency: 'EUR'
      }
    });
    await prisma.order.create({
      data: {
        userId,
        accountId: target.id,
        accountUserId: userId,
        symbolProfileId: profile.id,
        date: new Date(a.date),
        type: a.type,
        quantity: a.quantity,
        unitPrice: a.unitPrice,
        fee: a.fee,
        currency: a.currency
      }
    });
    input.choices[0].targetId = target.id;
    const plan = await service.run(input, userId, true);
    expect(plan.errors).toEqual([]);
    expect(plan.duplicates).toBe(1);
    await service.run({ ...input, digest: plan.digest }, userId, false);
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
    expect(
      (await cash.get({ accountId: target.id, userId })).balances.at(-1).value
    ).toBe('4699');
  });
  it.each([
    { currency: 'EUR', withBalance: false },
    { currency: 'EUR', withBalance: true },
    { currency: null, withBalance: false },
    { currency: null, withBalance: true }
  ])(
    'preserves legacy mode through actual JSON export and restore: %j',
    async ({ currency, withBalance }) => {
      const source = await prisma.account.create({
        data: { userId, name: 'Legacy account', currency }
      });
      if (withBalance)
        await prisma.accountBalance.create({
          data: {
            accountId: source.id,
            userId,
            date: new Date('2026-01-01T00:00:00Z'),
            value: 100
          }
        });
      const exporter = new ExportService(
        {
          accounts: ({ where }) =>
            prisma.account.findMany({
              where,
              include: { balances: true, tags: true, platform: true }
            })
        } as never,
        { getActivities: async () => ({ activities: [] }) } as never,
        null,
        { getTagsForUser: async () => [] } as never,
        cash
      );
      const backup = await exporter.export({
        userId,
        userSettings: { baseCurrency: 'EUR' } as never
      });
      expect(backup.accounts).toHaveLength(1);
      expect(backup.accounts[0]).not.toHaveProperty('cashManagement');
      expect(backup.accounts[0].currency).toBe(currency);
      expect(backup.accounts[0].balances).toHaveLength(withBalance ? 1 : 0);
      expect(await prisma.accountCashState.count({ where: { userId } })).toBe(
        0
      );
      const destinationId = randomUUID();
      users.push(destinationId);
      await prisma.user.create({ data: { id: destinationId } });
      const input = (await new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      }).transform(
        { backup, choices: [{ sourceId: source.id, targetId: 'NEW' }] },
        { metatype: PortfolioRestoreDto, type: 'body' }
      )) as PortfolioRestoreDto;
      const preview = await service.run(input, destinationId, true);
      expect(preview.errors).toEqual([]);
      await service.run(
        { ...input, digest: preview.digest },
        destinationId,
        false
      );
      const target = await prisma.account.findFirst({
        where: { userId: destinationId },
        include: { balances: true, cashState: true }
      });
      expect(target.currency).toBe(currency);
      expect(target.cashState).toBeNull();
      expect(target.balances).toHaveLength(withBalance ? 1 : 0);
      const writer = new AccountBalanceService(emitter, null, prisma, cash);
      const written = await writer.createOrUpdateAccountBalance({
        accountId: target.id,
        userId: destinationId,
        date: '2026-01-02',
        balance: 250
      });
      expect(written.value).toBe(250);
      expect(
        await cash.getPersisted({ accountId: target.id, userId: destinationId })
      ).toBeNull();
    }
  );

  it('exports a persisted cash ledger but keeps a legacy account unactivated in the same backup', async () => {
    const active = await prisma.account.create({
      data: { userId, name: 'Active', currency: 'EUR' }
    });
    const legacy = await prisma.account.create({
      data: { userId, name: 'Legacy', currency: null }
    });
    await cash.createEvent({
      accountId: active.id,
      userId,
      expectedRevision: 0,
      event: { date: '2026-01-01', type: 'MOVEMENT', amount: '100' }
    });
    const exporter = new ExportService(
      {
        accounts: ({ where }) =>
          prisma.account.findMany({
            where,
            include: { balances: true, tags: true, platform: true }
          })
      } as never,
      { getActivities: async () => ({ activities: [] }) } as never,
      null,
      { getTagsForUser: async () => [] } as never,
      cash
    );
    const backup = await exporter.export({
      userId,
      userSettings: { baseCurrency: 'EUR' } as never
    });
    expect(
      backup.accounts.find((a) => a.id === active.id).cashManagement.events
    ).toHaveLength(1);
    expect(backup.accounts.find((a) => a.id === legacy.id)).not.toHaveProperty(
      'cashManagement'
    );
    expect(await prisma.accountCashState.count({ where: { userId } })).toBe(1);
  });
});
