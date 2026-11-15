import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Prisma } from '@prisma/client';

import { DailyCashPersistedReader } from './daily-cash-persisted-reader.service';

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

function setup({
  accounts = [],
  previousGroups = [],
  legacyRows = []
}: {
  accounts?: unknown[];
  previousGroups?: unknown[];
  legacyRows?: unknown[];
} = {}) {
  const accountFindMany = jest.fn().mockResolvedValue(accounts);
  const groupBy = jest.fn().mockResolvedValue(previousGroups);
  const balanceFindMany = jest.fn().mockResolvedValue(legacyRows);

  const transactionClient = {
    account: {
      findMany: accountFindMany
    },
    accountBalance: {
      groupBy,
      findMany: balanceFindMany
    }
  };

  const $transaction = jest.fn(
    async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient)
  );

  const prisma = { $transaction };

  const reader = new DailyCashPersistedReader(
    prisma as unknown as PrismaService
  );

  return {
    reader,
    prisma,
    transactionClient,
    accountFindMany,
    groupBy,
    balanceFindMany
  };
}

const scope = {
  userId: 'user-a',
  startDate: '2026-10-01',
  endDate: '2026-10-02',
  baseCurrency: 'EUR'
};

describe('DailyCashPersistedReader', () => {
  describe('external transaction', () => {
    it('reads managed cash through the supplied transaction', async () => {
      const { reader, prisma, transactionClient, accountFindMany } = setup({
        accounts: [
          {
            id: 'managed-account',
            currency: 'EUR',
            cashState: {
              accountId: 'managed-account',
              currency: 'EUR',
              includeCashInPortfolio: true,
              isAutomaticOpening: false,
              openingBalance: new Prisma.Decimal('1000'),
              openingDate: day('2026-10-01'),
              revision: 1,
              events: []
            }
          }
        ]
      });

      const result = await reader.read({
        ...scope,
        transaction: transactionClient as unknown as Prisma.TransactionClient
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();

      expect(accountFindMany).toHaveBeenCalledTimes(1);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]).toMatchObject({
        accountId: 'managed-account',
        currency: 'EUR',
        source: 'managed',
        included: true,
        revision: 1
      });

      expect(transactionClient.account.findMany).toHaveBeenCalledTimes(1);
    });

    it('uses the supplied transaction for legacy balance queries', async () => {
      const { reader, prisma, transactionClient, groupBy, balanceFindMany } =
        setup({
          accounts: [
            {
              id: 'legacy-account',
              currency: 'EUR',
              cashState: null
            }
          ],
          previousGroups: [],
          legacyRows: [
            {
              accountId: 'legacy-account',
              date: day('2026-10-01'),
              value: 125
            }
          ]
        });

      const result = await reader.read({
        ...scope,
        transaction: transactionClient as unknown as Prisma.TransactionClient
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();

      expect(transactionClient.account.findMany).toHaveBeenCalledTimes(1);
      expect(groupBy).toHaveBeenCalledTimes(1);
      expect(balanceFindMany).toHaveBeenCalledTimes(1);

      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]).toMatchObject({
        accountId: 'legacy-account',
        currency: 'EUR',
        source: 'legacy',
        included: true,
        revision: null
      });

      expect(result.accounts[0].balances[0]).toEqual({
        date: '2026-10-01',
        status: 'available',
        balance: '125'
      });
    });

    it('uses the external transaction for the previous legacy balance lookup', async () => {
      const previousDate = day('2026-09-30');

      const { reader, transactionClient, groupBy, balanceFindMany } = setup({
        accounts: [
          {
            id: 'legacy-account',
            currency: 'EUR',
            cashState: null
          }
        ],
        previousGroups: [
          {
            accountId: 'legacy-account',
            _max: { date: previousDate }
          }
        ],
        legacyRows: [
          {
            accountId: 'legacy-account',
            date: previousDate,
            value: 100
          }
        ]
      });

      await reader.read({
        ...scope,
        transaction: transactionClient as unknown as Prisma.TransactionClient
      });

      expect(groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-a',
            accountId: { in: ['legacy-account'] }
          })
        })
      );

      expect(balanceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              {
                accountId: 'legacy-account',
                date: previousDate
              }
            ])
          })
        })
      );
    });
  });

  describe('autonomous transaction', () => {
    it('opens a RepeatableRead transaction when no external client is supplied', async () => {
      const { reader, prisma, transactionClient } = setup();

      const result = await reader.read(scope);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
      });

      expect(transactionClient.account.findMany).toHaveBeenCalledTimes(1);
      expect(result.accounts).toEqual([]);
    });

    it('rejects invalid date ranges before opening a transaction', async () => {
      const { reader, prisma } = setup();

      await expect(
        reader.read({
          ...scope,
          startDate: '2026-10-03',
          endDate: '2026-10-02'
        })
      ).rejects.toThrow('Reversed classification range');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects invalid dates before using an external transaction', async () => {
      const { reader, prisma, transactionClient } = setup();

      await expect(
        reader.read({
          ...scope,
          startDate: '2026-02-30',
          transaction: transactionClient as unknown as Prisma.TransactionClient
        })
      ).rejects.toThrow('Invalid civil date');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(transactionClient.account.findMany).not.toHaveBeenCalled();
    });
  });
});
