import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { TAG_ID_EXCLUDE_FROM_ANALYSIS } from '@ghostfolio/common/config';

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { classifyCashEvents } from './cash-event-classifier';
import { CashManagementService } from './cash-management.service';
import { DailyCashClassificationReader } from './daily-cash-classification-reader.service';

const databaseUrl = process.env.PNL_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('Daily cash classification reader (PostgreSQL)', () => {
  let prisma: PrismaService;
  let reader: DailyCashClassificationReader;

  const users: string[] = [];

  beforeAll(async () => {
    const url = new URL(databaseUrl);

    if (
      url.pathname !== '/ghostfolio_pnl_test' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '5432'
    ) {
      throw new Error(
        'PNL_TEST_DATABASE_URL must target local ghostfolio_pnl_test'
      );
    }

    prisma = new PrismaService(
      new ConfigService({
        DATABASE_URL: databaseUrl,
        LOG_LEVELS: '[]'
      })
    );

    await prisma.$connect();

    const result = await prisma.$queryRaw<{ database: string }[]>`
      SELECT current_database() AS database
    `;

    if (result[0]?.database !== 'ghostfolio_pnl_test') {
      throw new Error('Unexpected PostgreSQL database');
    }

    reader = new DailyCashClassificationReader(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      try {
        if (users.length > 0) {
          await prisma.cashEvent.deleteMany({
            where: { userId: { in: users } }
          });

          await prisma.user.deleteMany({
            where: { id: { in: users } }
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  it('reads a persisted classified cash movement', async () => {
    const userId = randomUUID();
    users.push(userId);

    await prisma.user.create({
      data: { id: userId }
    });

    const account = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL reader integration'
      }
    });

    await prisma.accountCashState.create({
      data: {
        accountId: account.id,
        userId,
        currency: 'EUR',
        openingDate: new Date('2026-10-01T00:00:00.000Z'),
        openingBalance: '1000',
        includeCashInPortfolio: true
      }
    });

    const event = await prisma.cashEvent.create({
      data: {
        accountId: account.id,
        userId,
        date: new Date('2026-10-02T00:00:00.000Z'),
        sequence: 1,
        type: 'MOVEMENT',
        economicClassification: 'EXTERNAL_CAPITAL',
        value: '25.123456789012345678901234567890'
      }
    });

    const snapshot = await reader.read({
      userId,
      startDate: '2026-10-02',
      endDate: '2026-10-02'
    });

    expect(snapshot.userId).toBe(userId);
    expect(snapshot.startDate).toBe('2026-10-02');
    expect(snapshot.endDate).toBe('2026-10-02');

    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.orders).toHaveLength(0);
    expect(snapshot.events).toHaveLength(1);

    expect(snapshot.events[0]).toMatchObject({
      id: event.id,
      userId,
      accountId: account.id,
      date: '2026-10-02',
      type: 'MOVEMENT',
      economicClassification: 'EXTERNAL_CAPITAL',
      fee: '0'
    });

    expect(
      new Prisma.Decimal(snapshot.events[0].value).equals(
        '25.123456789012345678901234567890'
      )
    ).toBe(true);

    const classified = classifyCashEvents(snapshot);

    expect(classified).toHaveLength(1);
    expect(classified[0].coverage).toBe('verified');
    expect(classified[0].externalFlows).toHaveLength(1);
    expect(classified[0].externalFlows[0].currency).toBe('EUR');
    expect(
      new Prisma.Decimal(classified[0].externalFlows[0].amount).equals(
        '25.123456789012345678901234567890'
      )
    ).toBe(true);
  });

  it('reads a synchronized BUY order and its cash settlement', async () => {
    const userId = randomUUID();
    users.push(userId);

    await prisma.user.create({ data: { id: userId } });

    const account = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL order integration'
      }
    });

    const cashManagement = new CashManagementService(
      new EventEmitter2(),
      prisma
    );

    await cashManagement.open({
      userId,
      accountId: account.id,
      date: '2026-10-01',
      balance: '1000'
    });

    const order = await cashManagement.runInAccounts(
      { userId, accountIds: [account.id] },
      async (transaction) => {
        const created = await transaction.order.create({
          data: {
            account: {
              connect: {
                id_userId: { id: account.id, userId }
              }
            },
            user: { connect: { id: userId } },
            date: new Date('2026-10-02T00:00:00.000Z'),
            type: 'BUY',
            quantity: 1,
            unitPrice: 10,
            fee: 0,
            currency: 'EUR',
            SymbolProfile: {
              create: {
                currency: 'EUR',
                symbol: randomUUID(),
                dataSource: 'MANUAL',
                userId
              }
            }
          },
          include: { SymbolProfile: true }
        });

        await cashManagement.synchronizeOrder(transaction, created, {
          enabled: true
        });

        return created;
      }
    );

    const persisted = await prisma.cashEvent.findUnique({
      where: { orderId: order.id }
    });

    expect(persisted).not.toBeNull();
    expect(persisted.type).toBe('MOVEMENT');
    expect(persisted.orderId).toBe(order.id);
    expect(persisted.value.equals('-10')).toBe(true);

    const snapshot = await reader.read({
      userId,
      startDate: '2026-10-02',
      endDate: '2026-10-02'
    });

    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.orders).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);

    expect(snapshot.orders[0]).toMatchObject({
      id: order.id,
      accountId: account.id,
      date: '2026-10-02',
      type: 'BUY',
      cashEventId: persisted.id
    });

    expect(snapshot.events[0]).toMatchObject({
      id: persisted.id,
      orderId: order.id,
      accountId: account.id,
      date: '2026-10-02',
      type: 'MOVEMENT'
    });

    const classified = classifyCashEvents(snapshot);

    expect(classified).toHaveLength(1);
    expect(classified[0].coverage).toBe('verified');
    expect(classified[0].externalFlows).toEqual([
      {
        currency: 'EUR',
        amount: '0'
      }
    ]);
  });

  it('reads a managed-to-managed cash transfer as internal', async () => {
    const userId = randomUUID();
    users.push(userId);

    await prisma.user.create({ data: { id: userId } });

    const source = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL transfer source'
      }
    });

    const destination = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL transfer destination'
      }
    });

    const exchangeRate = {
      toCurrencyAtDate: jest.fn().mockImplementation((amount: number) => amount)
    };

    const cashManagement = new CashManagementService(
      new EventEmitter2(),
      prisma,
      exchangeRate as never
    );

    await cashManagement.open({
      userId,
      accountId: source.id,
      date: '2026-10-01',
      balance: '1000'
    });

    await cashManagement.open({
      userId,
      accountId: destination.id,
      date: '2026-10-01',
      balance: '0'
    });

    await cashManagement.transfer({
      userId,
      accountIdFrom: source.id,
      accountIdTo: destination.id,
      balance: 25
    });

    const persisted = await prisma.cashEvent.findMany({
      where: {
        userId,
        transferId: { not: null }
      },
      orderBy: { accountId: 'asc' }
    });

    expect(persisted).toHaveLength(2);

    const debit = persisted.find((event) => event.accountId === source.id);
    const credit = persisted.find(
      (event) => event.accountId === destination.id
    );

    expect(debit).toBeDefined();
    expect(credit).toBeDefined();

    expect(debit.value.equals('-25')).toBe(true);
    expect(credit.value.equals('25')).toBe(true);

    expect(debit.transferId).toBe(credit.transferId);
    expect(debit.transferCounterpartyAccountId).toBe(destination.id);
    expect(credit.transferCounterpartyAccountId).toBe(source.id);
    expect(debit.transferCounterpartyMode).toBe('CASH');
    expect(credit.transferCounterpartyMode).toBe('CASH');

    const date = debit.date.toISOString().slice(0, 10);

    expect(credit.date.toISOString().slice(0, 10)).toBe(date);

    const snapshot = await reader.read({
      userId,
      startDate: date,
      endDate: date
    });

    expect(snapshot.accounts).toHaveLength(2);
    expect(snapshot.orders).toHaveLength(0);
    expect(snapshot.events).toHaveLength(2);

    expect(snapshot.events.map(({ id }) => id).sort()).toEqual(
      persisted.map(({ id }) => id).sort()
    );

    const classified = classifyCashEvents(snapshot);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe('complete');
    expect(classified[0].coverage).toBe('verified');
    expect(classified[0].reconciliation).toBe('none');
    expect(classified[0].externalFlows).toEqual([
      { currency: 'EUR', amount: '0' }
    ]);

    expect(classified[0].items).toHaveLength(1);

    const transferItem = classified[0].items[0];

    expect(transferItem.kind).toBe('transfer');
    expect(transferItem.coverage).toBe('verified');
    expect(transferItem.externalFlows).toHaveLength(2);
    expect(
      transferItem.externalFlows.every(
        ({ currency, amount }) =>
          currency === 'EUR' && new Prisma.Decimal(amount).equals(0)
      )
    ).toBe(true);

    expect(transferItem.sources.transferId).toBe(debit.transferId);
    expect(transferItem.sources.cashEventIds).toEqual(
      persisted.map(({ id }) => id).sort()
    );
  });

  it('classifies a transfer to an excluded account as external', async () => {
    const userId = randomUUID();
    users.push(userId);

    await prisma.user.create({ data: { id: userId } });

    const source = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL included transfer source'
      }
    });

    const destination = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL excluded transfer destination'
      }
    });

    await prisma.tagsOnAccounts.create({
      data: {
        accountId: destination.id,
        userId,
        tagId: TAG_ID_EXCLUDE_FROM_ANALYSIS
      }
    });

    const exchangeRate = {
      toCurrencyAtDate: jest.fn().mockImplementation((amount: number) => amount)
    };

    const cashManagement = new CashManagementService(
      new EventEmitter2(),
      prisma,
      exchangeRate as never
    );

    await cashManagement.open({
      userId,
      accountId: source.id,
      date: '2026-10-01',
      balance: '1000'
    });

    await cashManagement.open({
      userId,
      accountId: destination.id,
      date: '2026-10-01',
      balance: '0'
    });

    await cashManagement.transfer({
      userId,
      accountIdFrom: source.id,
      accountIdTo: destination.id,
      balance: 25
    });

    const persisted = await prisma.cashEvent.findMany({
      where: {
        userId,
        transferId: { not: null }
      }
    });

    expect(persisted).toHaveLength(2);

    const debit = persisted.find((event) => event.accountId === source.id);
    const credit = persisted.find(
      (event) => event.accountId === destination.id
    );

    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    expect(debit.value.equals('-25')).toBe(true);
    expect(credit.value.equals('25')).toBe(true);
    expect(debit.transferId).toBe(credit.transferId);

    const date = debit.date.toISOString().slice(0, 10);

    expect(credit.date.toISOString().slice(0, 10)).toBe(date);

    const snapshot = await reader.read({
      userId,
      startDate: date,
      endDate: date
    });

    expect(snapshot.accounts).toHaveLength(2);
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.orders).toHaveLength(0);

    expect(
      snapshot.accounts.find((account) => account.id === source.id)?.excluded
    ).toBe(false);

    expect(
      snapshot.accounts.find((account) => account.id === destination.id)
        ?.excluded
    ).toBe(true);

    expect(snapshot.events.map(({ id }) => id).sort()).toEqual(
      persisted.map(({ id }) => id).sort()
    );

    const classified = classifyCashEvents(snapshot);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe('complete');
    expect(classified[0].coverage).toBe('verified');
    expect(classified[0].reconciliation).toBe('none');
    expect(classified[0].externalFlows).toEqual([
      { currency: 'EUR', amount: '-25' }
    ]);

    expect(classified[0].items).toHaveLength(1);

    const transferItem = classified[0].items[0];

    expect(transferItem.kind).toBe('transfer');
    expect(transferItem.coverage).toBe('verified');
    expect(transferItem.externalFlows).toEqual([
      { currency: 'EUR', amount: '-25' }
    ]);

    expect(transferItem.sources.transferId).toBe(debit.transferId);
    expect(transferItem.sources.cashEventIds).toEqual(
      persisted.map(({ id }) => id).sort()
    );
  });

  it('classifies a transfer from an excluded account as external', async () => {
    const userId = randomUUID();
    users.push(userId);

    await prisma.user.create({ data: { id: userId } });

    const source = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL excluded transfer source'
      }
    });

    const destination = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL included transfer destination'
      }
    });

    await prisma.tagsOnAccounts.create({
      data: {
        accountId: source.id,
        userId,
        tagId: TAG_ID_EXCLUDE_FROM_ANALYSIS
      }
    });

    const exchangeRate = {
      toCurrencyAtDate: jest.fn().mockImplementation((amount: number) => amount)
    };

    const cashManagement = new CashManagementService(
      new EventEmitter2(),
      prisma,
      exchangeRate as never
    );

    await cashManagement.open({
      userId,
      accountId: source.id,
      date: '2026-10-01',
      balance: '1000'
    });

    await cashManagement.open({
      userId,
      accountId: destination.id,
      date: '2026-10-01',
      balance: '0'
    });

    await cashManagement.transfer({
      userId,
      accountIdFrom: source.id,
      accountIdTo: destination.id,
      balance: 25
    });

    const persisted = await prisma.cashEvent.findMany({
      where: {
        userId,
        transferId: { not: null }
      }
    });

    expect(persisted).toHaveLength(2);

    const debit = persisted.find((event) => event.accountId === source.id);
    const credit = persisted.find(
      (event) => event.accountId === destination.id
    );

    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    expect(debit.value.equals('-25')).toBe(true);
    expect(credit.value.equals('25')).toBe(true);
    expect(debit.transferId).toBe(credit.transferId);

    const date = debit.date.toISOString().slice(0, 10);

    expect(credit.date.toISOString().slice(0, 10)).toBe(date);

    const snapshot = await reader.read({
      userId,
      startDate: date,
      endDate: date
    });

    expect(snapshot.accounts).toHaveLength(2);
    expect(snapshot.orders).toHaveLength(0);
    expect(snapshot.events).toHaveLength(2);

    expect(
      snapshot.accounts.find((account) => account.id === source.id)?.excluded
    ).toBe(true);

    expect(
      snapshot.accounts.find((account) => account.id === destination.id)
        ?.excluded
    ).toBe(false);

    expect(snapshot.events.map(({ id }) => id).sort()).toEqual(
      persisted.map(({ id }) => id).sort()
    );

    const classified = classifyCashEvents(snapshot);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe('complete');
    expect(classified[0].coverage).toBe('verified');
    expect(classified[0].reconciliation).toBe('none');
    expect(classified[0].externalFlows).toEqual([
      { currency: 'EUR', amount: '25' }
    ]);

    expect(classified[0].items).toHaveLength(1);

    const transferItem = classified[0].items[0];

    expect(transferItem.kind).toBe('transfer');
    expect(transferItem.coverage).toBe('verified');
    expect(transferItem.externalFlows).toEqual([
      { currency: 'EUR', amount: '25' }
    ]);

    expect(transferItem.sources.transferId).toBe(debit.transferId);
    expect(transferItem.sources.cashEventIds).toEqual(
      persisted.map(({ id }) => id).sort()
    );
  });

  it('marks a BUY order without cash settlement as unavailable', async () => {
    const userId = randomUUID();
    users.push(userId);

    await prisma.user.create({ data: { id: userId } });

    const account = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL missing settlement integration'
      }
    });

    const cashManagement = new CashManagementService(
      new EventEmitter2(),
      prisma
    );

    await cashManagement.open({
      userId,
      accountId: account.id,
      date: '2026-10-01',
      balance: '1000'
    });

    const order = await prisma.order.create({
      data: {
        account: {
          connect: {
            id_userId: { id: account.id, userId }
          }
        },
        user: { connect: { id: userId } },
        date: new Date('2026-10-02T00:00:00.000Z'),
        type: 'BUY',
        quantity: 1,
        unitPrice: 10,
        fee: 0,
        currency: 'EUR',
        SymbolProfile: {
          create: {
            currency: 'EUR',
            symbol: randomUUID(),
            dataSource: 'MANUAL',
            userId
          }
        }
      }
    });

    // Intentionally omit synchronizeOrder(): the persisted order has
    // no corresponding cash settlement.
    expect(
      await prisma.cashEvent.count({
        where: { userId, orderId: order.id }
      })
    ).toBe(0);

    const snapshot = await reader.read({
      userId,
      startDate: '2026-10-02',
      endDate: '2026-10-02'
    });

    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.orders).toHaveLength(1);
    expect(snapshot.events).toHaveLength(0);

    expect(snapshot.orders[0]).toMatchObject({
      id: order.id,
      accountId: account.id,
      type: 'BUY',
      date: '2026-10-02',
      cashEventId: null
    });

    const classified = classifyCashEvents(snapshot);

    expect(classified).toHaveLength(1);
    expect(classified[0]).toMatchObject({
      date: '2026-10-02',
      classification: 'unclassified',
      coverage: 'unavailable',
      reconciliation: 'none',
      externalFlows: null
    });

    expect(classified[0].items).toHaveLength(1);

    expect(classified[0].items[0]).toMatchObject({
      kind: 'unavailable',
      classification: 'unclassified',
      coverage: 'unavailable',
      externalFlows: null,
      cashChanges: [],
      issues: ['ORDER_CASH_EFFECT_MISSING']
    });

    expect(classified[0].items[0].sources.orderIds).toEqual([order.id]);
  });

  it('rejects a managed transfer with a missing counterpart', async () => {
    const userId = randomUUID();
    users.push(userId);

    await prisma.user.create({ data: { id: userId } });

    const source = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL incomplete transfer source'
      }
    });

    const destination = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'PnL incomplete transfer destination'
      }
    });

    const exchangeRate = {
      toCurrencyAtDate: jest.fn().mockImplementation((amount: number) => amount)
    };

    const cashManagement = new CashManagementService(
      new EventEmitter2(),
      prisma,
      exchangeRate as never
    );

    await cashManagement.open({
      userId,
      accountId: source.id,
      date: '2026-10-01',
      balance: '1000'
    });

    await cashManagement.open({
      userId,
      accountId: destination.id,
      date: '2026-10-01',
      balance: '0'
    });

    await cashManagement.transfer({
      userId,
      accountIdFrom: source.id,
      accountIdTo: destination.id,
      balance: 25
    });

    const originalEvents = await prisma.cashEvent.findMany({
      where: {
        userId,
        transferId: { not: null }
      }
    });

    expect(originalEvents).toHaveLength(2);

    const debit = originalEvents.find((event) => event.accountId === source.id);

    const credit = originalEvents.find(
      (event) => event.accountId === destination.id
    );

    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    expect(debit.transferId).toBe(credit.transferId);
    expect(debit.transferCounterpartyMode).toBe('CASH');

    // Simulate persisted ledger corruption: remove only the credit leg.
    // The account and the debit leg's counterpart metadata remain intact.
    await prisma.cashEvent.delete({
      where: { id: credit.id }
    });

    const persisted = await prisma.cashEvent.findMany({
      where: { userId, transferId: debit.transferId }
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(debit.id);

    const date = debit.date.toISOString().slice(0, 10);

    const snapshot = await reader.read({
      userId,
      startDate: date,
      endDate: date
    });

    expect(snapshot.accounts).toHaveLength(2);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({
      id: debit.id,
      accountId: source.id,
      transferId: debit.transferId,
      transferCounterpartyAccountId: destination.id,
      transferCounterpartyMode: 'CASH'
    });

    const classified = classifyCashEvents(snapshot);

    expect(classified).toHaveLength(1);
    expect(classified[0]).toMatchObject({
      date,
      classification: 'unclassified',
      coverage: 'unavailable',
      reconciliation: 'none',
      externalFlows: null
    });

    expect(classified[0].items).toHaveLength(1);
    expect(classified[0].items[0]).toMatchObject({
      kind: 'transfer',
      classification: 'unclassified',
      coverage: 'unavailable',
      externalFlows: null,
      issues: ['TRANSFER_COUNTERPART_MISSING']
    });

    expect(classified[0].items[0].sources.transferId).toBe(debit.transferId);
    expect(classified[0].items[0].sources.cashEventIds).toEqual([debit.id]);
  });

  it('isolates persisted cash events and orders between users', async () => {
    const userA = randomUUID();
    const userB = randomUUID();

    users.push(userA, userB);

    await prisma.user.createMany({
      data: [{ id: userA }, { id: userB }]
    });

    const accountA = await prisma.account.create({
      data: {
        userId: userA,
        currency: 'EUR',
        name: 'PnL isolated account A'
      }
    });

    const accountB = await prisma.account.create({
      data: {
        userId: userB,
        currency: 'EUR',
        name: 'PnL isolated account B'
      }
    });

    const cashManagement = new CashManagementService(
      new EventEmitter2(),
      prisma
    );

    await cashManagement.open({
      userId: userA,
      accountId: accountA.id,
      date: '2026-10-01',
      balance: '1000'
    });

    await cashManagement.open({
      userId: userB,
      accountId: accountB.id,
      date: '2026-10-01',
      balance: '1000'
    });

    const eventB = await prisma.cashEvent.create({
      data: {
        accountId: accountB.id,
        userId: userB,
        date: new Date('2026-10-02T00:00:00.000Z'),
        sequence: 1,
        type: 'MOVEMENT',
        economicClassification: 'EXTERNAL_CAPITAL',
        value: '-80'
      }
    });

    const orderA = await cashManagement.runInAccounts(
      { userId: userA, accountIds: [accountA.id] },
      async (transaction) => {
        const created = await transaction.order.create({
          data: {
            account: {
              connect: {
                id_userId: { id: accountA.id, userId: userA }
              }
            },
            user: { connect: { id: userA } },
            date: new Date('2026-10-02T00:00:00.000Z'),
            type: 'BUY',
            quantity: 1,
            unitPrice: 10,
            fee: 0,
            currency: 'EUR',
            SymbolProfile: {
              create: {
                currency: 'EUR',
                symbol: randomUUID(),
                dataSource: 'MANUAL',
                userId: userA
              }
            }
          },
          include: { SymbolProfile: true }
        });

        await cashManagement.synchronizeOrder(transaction, created, {
          enabled: true
        });

        return created;
      }
    );

    const orderASettlement = await prisma.cashEvent.findUnique({
      where: { orderId: orderA.id }
    });

    expect(orderASettlement).not.toBeNull();

    const eventA = await prisma.cashEvent.create({
      data: {
        accountId: accountA.id,
        userId: userA,
        date: new Date('2026-10-02T00:00:00.000Z'),
        sequence: orderASettlement.sequence + 1,
        type: 'MOVEMENT',
        economicClassification: 'EXTERNAL_CAPITAL',
        value: '25'
      }
    });

    const orderB = await prisma.order.create({
      data: {
        account: {
          connect: {
            id_userId: { id: accountB.id, userId: userB }
          }
        },
        user: { connect: { id: userB } },
        date: new Date('2026-10-02T00:00:00.000Z'),
        type: 'BUY',
        quantity: 1,
        unitPrice: 20,
        fee: 0,
        currency: 'EUR',
        SymbolProfile: {
          create: {
            currency: 'EUR',
            symbol: randomUUID(),
            dataSource: 'MANUAL',
            userId: userB
          }
        }
      }
    });

    const settlementA = await prisma.cashEvent.findUnique({
      where: { orderId: orderA.id }
    });

    expect(settlementA).not.toBeNull();

    expect(
      await prisma.cashEvent.count({
        where: { userId: userB, orderId: orderB.id }
      })
    ).toBe(0);

    const scope = {
      startDate: '2026-10-02',
      endDate: '2026-10-02'
    };

    const snapshotA = await reader.read({
      ...scope,
      userId: userA
    });

    const snapshotB = await reader.read({
      ...scope,
      userId: userB
    });

    expect(snapshotA.userId).toBe(userA);
    expect(snapshotB.userId).toBe(userB);

    expect(snapshotA.accounts.map(({ id }) => id)).toEqual([accountA.id]);
    expect(snapshotB.accounts.map(({ id }) => id)).toEqual([accountB.id]);

    expect(snapshotA.orders.map(({ id }) => id)).toEqual([orderA.id]);
    expect(snapshotB.orders.map(({ id }) => id)).toEqual([orderB.id]);

    expect(snapshotA.events.map(({ id }) => id).sort()).toEqual(
      [eventA.id, settlementA.id].sort()
    );

    expect(snapshotB.events.map(({ id }) => id)).toEqual([eventB.id]);

    expect(snapshotA.events.every(({ userId }) => userId === userA)).toBe(true);

    expect(snapshotB.events.every(({ userId }) => userId === userB)).toBe(true);

    const classifiedA = classifyCashEvents(snapshotA);
    const classifiedB = classifyCashEvents(snapshotB);

    expect(classifiedA).toHaveLength(1);
    expect(classifiedA[0]).toMatchObject({
      classification: 'complete',
      coverage: 'verified',
      reconciliation: 'none',
      externalFlows: [{ currency: 'EUR', amount: '25' }]
    });

    expect(classifiedB).toHaveLength(1);
    expect(classifiedB[0]).toMatchObject({
      classification: 'unclassified',
      coverage: 'unavailable',
      reconciliation: 'none',
      externalFlows: null
    });

    expect(
      classifiedB[0].items.some(({ issues }) =>
        issues.includes('ORDER_CASH_EFFECT_MISSING')
      )
    ).toBe(true);

    expect(
      classifiedA[0].items.some(({ issues }) =>
        issues.includes('ORDER_CASH_EFFECT_MISSING')
      )
    ).toBe(false);
  });
});
