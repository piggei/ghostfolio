import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { TAG_ID_EXCLUDE_FROM_ANALYSIS } from '@ghostfolio/common/config';

import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { DailyCashPersistedReader } from './daily-cash-persisted-reader.service';

const databaseUrl = process.env.CASH_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('Daily cash persisted reader (PostgreSQL)', () => {
  let prisma: PrismaService;
  let reader: DailyCashPersistedReader;

  const users: string[] = [];

  const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

  beforeAll(async () => {
    const url = new URL(databaseUrl);

    if (
      !url.pathname.startsWith('/cash_test_') ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '5433'
    ) {
      throw new Error(
        'CASH_TEST_DATABASE_URL must target a local disposable cash_test_ database'
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

    const expectedDatabase = url.pathname.slice(1);

    if (result[0]?.database !== expectedDatabase) {
      throw new Error('Unexpected PostgreSQL database');
    }

    reader = new DailyCashPersistedReader(prisma);
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

  async function createUser(): Promise<string> {
    const userId = randomUUID();
    users.push(userId);

    await prisma.user.create({
      data: { id: userId }
    });

    return userId;
  }

  async function createAccount(
    userId: string,
    currency: string | null = 'EUR'
  ) {
    return prisma.account.create({
      data: {
        userId,
        currency,
        name: 'Daily cash reader integration'
      }
    });
  }

  async function read(
    userId: string,
    startDate = '2026-10-01',
    endDate = '2026-10-03',
    accountIds?: string[]
  ) {
    return reader.read({
      userId,
      startDate,
      endDate,
      baseCurrency: 'EUR',
      ...(accountIds === undefined ? {} : { accountIds })
    });
  }

  it('reads managed Decimal balances without losing precision or subtracting fees twice', async () => {
    const userId = await createUser();
    const account = await createAccount(userId);

    await prisma.accountCashState.create({
      data: {
        accountId: account.id,
        userId,
        currency: 'EUR',
        openingDate: day('2026-10-01'),
        openingBalance: '1000.000000000000000000000000000000',
        isAutomaticOpening: false,
        includeCashInPortfolio: true
      }
    });

    await prisma.cashEvent.create({
      data: {
        accountId: account.id,
        userId,
        date: day('2026-10-02'),
        sequence: 1,
        type: 'MOVEMENT',
        value: '25.123456789012345678901234567890',
        fee: '0.000000000000000000000000000001'
      }
    });

    const result = await read(userId);

    expect(result.accounts).toHaveLength(1);

    expect(result.accounts[0]).toMatchObject({
      accountId: account.id,
      currency: 'EUR',
      source: 'managed',
      included: true,
      revision: 0
    });

    expect(result.accounts[0].balances).toEqual([
      {
        date: '2026-10-01',
        status: 'available',
        balance: '1000'
      },
      {
        date: '2026-10-02',
        status: 'available',
        balance: '1025.123456789012345678901234567889'
      },
      {
        date: '2026-10-03',
        status: 'available',
        balance: '1025.123456789012345678901234567889'
      }
    ]);
  });

  it('reconstructs movements around absolute reconciliation checkpoints', async () => {
    const userId = await createUser();
    const account = await createAccount(userId);

    await prisma.accountCashState.create({
      data: {
        accountId: account.id,
        userId,
        currency: 'EUR',
        openingDate: day('2026-10-01'),
        openingBalance: '1000',
        isAutomaticOpening: false
      }
    });

    await prisma.cashEvent.createMany({
      data: [
        {
          accountId: account.id,
          userId,
          date: day('2026-10-02'),
          sequence: 1,
          type: 'MOVEMENT',
          value: '50'
        },
        {
          accountId: account.id,
          userId,
          date: day('2026-10-03'),
          sequence: 2,
          type: 'CHECKPOINT',
          value: '900'
        },
        {
          accountId: account.id,
          userId,
          date: day('2026-10-04'),
          sequence: 3,
          type: 'MOVEMENT',
          value: '25'
        }
      ]
    });

    const result = await read(userId, '2026-10-01', '2026-10-04');

    expect(result.accounts[0].balances).toEqual([
      { date: '2026-10-01', status: 'available', balance: '1000' },
      { date: '2026-10-02', status: 'available', balance: '1050' },
      { date: '2026-10-03', status: 'available', balance: '900' },
      { date: '2026-10-04', status: 'available', balance: '925' }
    ]);
  });

  it('reconstructs legacy balances and ignores managed projections', async () => {
    const userId = await createUser();
    const account = await createAccount(userId);

    await prisma.accountBalance.createMany({
      data: [
        {
          accountId: account.id,
          userId,
          date: day('2026-09-30'),
          value: 100
        },
        {
          accountId: account.id,
          userId,
          date: day('2026-10-02'),
          value: 125
        },
        {
          accountId: account.id,
          userId,
          date: day('2026-10-03'),
          value: 999,
          isCashManagementProjection: true
        },
        {
          accountId: account.id,
          userId,
          date: day('2026-10-04'),
          value: 150
        }
      ]
    });

    const result = await read(userId);

    expect(result.accounts).toHaveLength(1);

    expect(result.accounts[0]).toMatchObject({
      accountId: account.id,
      currency: 'EUR',
      source: 'legacy',
      included: true,
      revision: null
    });

    expect(result.accounts[0].balances).toEqual([
      { date: '2026-10-01', status: 'available', balance: '100' },
      { date: '2026-10-02', status: 'available', balance: '125' },
      { date: '2026-10-03', status: 'available', balance: '125' }
    ]);
  });

  it('preserves zero for a verified empty account without a ledger', async () => {
    const userId = await createUser();
    const account = await createAccount(userId);
    const result = await read(userId);
    expect(result.accounts[0].accountId).toBe(account.id);
    expect(result.accounts[0].source).toBe('legacy');
    expect(result.accounts[0].balances).toEqual([
      { date: '2026-10-01', status: 'available', balance: '0' },
      { date: '2026-10-02', status: 'available', balance: '0' },
      { date: '2026-10-03', status: 'available', balance: '0' }
    ]);
  });

  it('does not infer zero when a legacy balance exists after the requested period', async () => {
    const userId = await createUser();
    const account = await createAccount(userId);
    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        userId,
        date: day('2026-11-15'),
        value: 200
      }
    });
    const result = await read(userId);
    expect(
      result.accounts[0].balances.every((row) => row.status === 'unavailable')
    ).toBe(true);
  });

  it('retains automatic zero history before the first external deposit', async () => {
    const userId = await createUser();
    const account = await createAccount(userId);
    await prisma.accountCashState.create({
      data: {
        accountId: account.id,
        userId,
        currency: 'EUR',
        openingDate: day('0001-01-01'),
        openingBalance: '0',
        isAutomaticOpening: true
      }
    });
    await prisma.cashEvent.create({
      data: {
        accountId: account.id,
        userId,
        date: day('2026-10-02'),
        sequence: 1,
        type: 'MOVEMENT',
        value: '200',
        economicClassification: 'EXTERNAL_CAPITAL'
      }
    });
    const result = await read(userId);
    expect(result.accounts[0].balances).toEqual([
      { date: '2026-10-01', status: 'available', balance: '0' },
      { date: '2026-10-02', status: 'available', balance: '200' },
      { date: '2026-10-03', status: 'available', balance: '200' }
    ]);
  });

  it('isolates accounts belonging to different users', async () => {
    const firstUserId = await createUser();
    const secondUserId = await createUser();

    const firstAccount = await createAccount(firstUserId);
    const secondAccount = await createAccount(secondUserId);

    await prisma.accountBalance.createMany({
      data: [
        {
          accountId: firstAccount.id,
          userId: firstUserId,
          date: day('2026-10-01'),
          value: 100
        },
        {
          accountId: secondAccount.id,
          userId: secondUserId,
          date: day('2026-10-01'),
          value: 999999
        }
      ]
    });

    const result = await read(firstUserId);

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].accountId).toBe(firstAccount.id);
    expect(result.accounts[0].accountId).not.toBe(secondAccount.id);
    expect(result.accounts[0].balances[0]).toMatchObject({
      status: 'available',
      balance: '100'
    });
  });

  it('preserves managed cash history when excluded from portfolio NAV', async () => {
    const userId = await createUser();
    const account = await createAccount(userId);

    await prisma.accountCashState.create({
      data: {
        accountId: account.id,
        userId,
        currency: 'EUR',
        openingDate: day('2026-10-01'),
        openingBalance: '500',
        includeCashInPortfolio: false,
        isAutomaticOpening: false
      }
    });

    const result = await read(userId);

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({
      accountId: account.id,
      source: 'managed',
      included: false
    });

    expect(result.accounts[0].balances[0]).toEqual({
      date: '2026-10-01',
      status: 'available',
      balance: '500'
    });
  });
  it('excludes accounts carrying the official analysis exclusion tag', async () => {
    const userId = await createUser();
    const included = await createAccount(userId);
    const excluded = await createAccount(userId);

    await prisma.tagsOnAccounts.create({
      data: {
        accountId: excluded.id,
        userId,
        tagId: TAG_ID_EXCLUDE_FROM_ANALYSIS
      }
    });

    const result = await read(userId);

    expect(result.accounts.map(({ accountId }) => accountId)).toEqual([
      included.id
    ]);
  });

  it('restricts results to explicitly requested account IDs', async () => {
    const userId = await createUser();
    const first = await createAccount(userId);
    const second = await createAccount(userId);
    const third = await createAccount(userId);

    const result = await read(userId, '2026-10-01', '2026-10-03', [second.id]);

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].accountId).toBe(second.id);
    expect(result.accounts[0].accountId).not.toBe(first.id);
    expect(result.accounts[0].accountId).not.toBe(third.id);
  });

  it('keeps analysis exclusion effective within an explicit account scope', async () => {
    const userId = await createUser();
    const included = await createAccount(userId);
    const excluded = await createAccount(userId);

    await prisma.tagsOnAccounts.create({
      data: {
        accountId: excluded.id,
        userId,
        tagId: TAG_ID_EXCLUDE_FROM_ANALYSIS
      }
    });

    const result = await read(userId, '2026-10-01', '2026-10-03', [
      included.id,
      excluded.id
    ]);

    expect(result.accounts.map(({ accountId }) => accountId)).toEqual([
      included.id
    ]);
  });

  it('uses the portfolio base currency for legacy accounts without currency', async () => {
    const userId = await createUser();
    const account = await createAccount(userId, null);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        userId,
        date: day('2026-10-01'),
        value: 125
      }
    });

    const result = await read(userId);

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({
      accountId: account.id,
      currency: 'EUR',
      source: 'legacy',
      included: true
    });

    expect(result.accounts[0].balances[0]).toEqual({
      date: '2026-10-01',
      status: 'available',
      balance: '125'
    });
  });
});
