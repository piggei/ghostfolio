import { DailyCashClassificationReader } from '@ghostfolio/api/app/account-balance/daily-cash-classification-reader.service';
import { DailyCashPersistedReader } from '@ghostfolio/api/app/account-balance/daily-cash-persisted-reader.service';
import { ActivitiesService } from '@ghostfolio/api/services/activities/activities.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { DataSource, Prisma } from '@prisma/client';

import { DailyNavOrchestratorService } from './daily-nav-orchestrator.service';

describe('DailyNavOrchestratorService', () => {
  let service: DailyNavOrchestratorService;
  let transaction: Record<string, unknown>;

  let getActivities: jest.Mock;
  let readClassification: jest.Mock;
  let readCash: jest.Mock;
  let getRange: jest.Mock;
  let getDataSource: jest.Mock;
  let prismaTransaction: jest.Mock;

  const startDate = '2026-10-02';
  const endDate = '2026-10-03';

  const classificationInput = {
    userId: 'user-id',
    startDate,
    endDate,
    accounts: [],
    orders: [],
    events: []
  };

  beforeEach(() => {
    transaction = {};

    getActivities = jest.fn().mockResolvedValue({
      activities: [],
      count: 0
    });

    readClassification = jest.fn().mockResolvedValue(classificationInput);

    readCash = jest.fn().mockResolvedValue({
      userId: 'user-id',
      startDate: '2026-10-01',
      endDate,
      accounts: [
        {
          accountId: 'cash-gbp',
          currency: 'GBP',
          source: 'managed',
          included: true,
          revision: 0,
          balances: []
        }
      ]
    });

    getRange = jest.fn().mockResolvedValue([]);
    getDataSource = jest.fn().mockReturnValue(DataSource.YAHOO);

    prismaTransaction = jest.fn(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(transaction as Prisma.TransactionClient)
    );

    service = new DailyNavOrchestratorService(
      {
        getActivitiesForSecuritiesPortfolioCalculator: getActivities
      } as unknown as ActivitiesService,
      {
        read: readClassification
      } as unknown as DailyCashClassificationReader,
      {
        getDataSourceForExchangeRates: getDataSource
      } as unknown as DataProviderService,
      {
        getRange
      } as unknown as MarketDataService,
      {
        read: readCash
      } as unknown as DailyCashPersistedReader,
      {
        $transaction: prismaTransaction
      } as unknown as PrismaService
    );
  });

  describe('acquireSnapshot', () => {
    it('acquires all inputs using one RepeatableRead transaction', async () => {
      const result = await service.acquireSnapshot({
        userId: 'user-id',
        startDate,
        endDate,
        baseCurrency: 'EUR'
      });

      expect(prismaTransaction).toHaveBeenCalledTimes(1);

      expect(prismaTransaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5000,
        timeout: 15000
      });

      expect(getActivities).toHaveBeenCalledWith({
        userId: 'user-id',
        userCurrency: 'EUR',
        transaction
      });

      expect(readClassification).toHaveBeenCalledWith({
        userId: 'user-id',
        startDate,
        endDate,
        transaction
      });

      expect(readCash).toHaveBeenCalledWith({
        userId: 'user-id',
        startDate: '2026-10-01',
        endDate,
        baseCurrency: 'EUR',
        transaction
      });

      expect(getRange).toHaveBeenCalledTimes(1);

      const marketQuery = getRange.mock.calls[0][0];

      expect(marketQuery.transaction).toBe(transaction);

      expect(marketQuery.assetProfileIdentifiers).toEqual(
        expect.arrayContaining([
          { dataSource: DataSource.YAHOO, symbol: 'EURGBP' },
          { dataSource: DataSource.YAHOO, symbol: 'EURUSD' },
          { dataSource: DataSource.YAHOO, symbol: 'GBPEUR' },
          { dataSource: DataSource.YAHOO, symbol: 'GBPUSD' },
          { dataSource: DataSource.YAHOO, symbol: 'USDEUR' },
          { dataSource: DataSource.YAHOO, symbol: 'USDGBP' }
        ])
      );

      expect(marketQuery.dateQuery).toEqual({
        gte: new Date('2026-09-24T00:00:00.000Z'),
        lt: new Date('2026-10-04T00:00:00.000Z')
      });

      expect(result).toMatchObject({
        userId: 'user-id',
        startDate,
        endDate,
        baselineDate: '2026-10-01',
        baseCurrency: 'EUR',
        maxAgeDays: 7,
        cash: {
          accounts: [{ currency: 'GBP' }]
        },
        marketData: []
      });

      expect(result.classifications).toHaveLength(2);
    });

    it('includes currencies from cash states, orders and transfer counterparties', async () => {
      readClassification.mockResolvedValue({
        ...classificationInput,
        accounts: [
          {
            id: 'classification-account',
            userId: 'user-id',
            currency: null,
            excluded: false,
            cashState: {
              currency: 'JPY',
              openingDate: '2026-10-01',
              openingBalance: '100',
              revision: 1,
              includeCashInPortfolio: true
            }
          }
        ],
        orders: [
          {
            id: 'order-id',
            userId: 'user-id',
            accountId: 'classification-account',
            accountUserId: 'user-id',
            date: startDate,
            currency: 'CHF',
            symbolCurrency: 'USD',
            type: 'BUY',
            quantity: '1',
            unitPrice: '100',
            fee: '0',
            tax: '0',
            cashEventId: 'event-id'
          }
        ],
        events: [
          {
            id: 'event-id',
            userId: 'user-id',
            accountId: 'classification-account',
            date: startDate,
            sequence: 1,
            type: 'MOVEMENT',
            value: '100',
            fee: '0',
            economicClassification: null,
            orderId: null,
            transferId: null,
            transferCounterpartyAccountId: null,
            transferCounterpartyMode: null,
            transferCounterpartyAmount: null,
            transferCounterpartyCurrency: 'CAD'
          }
        ]
      });

      await service.acquireSnapshot({
        userId: 'user-id',
        startDate,
        endDate,
        baseCurrency: 'EUR'
      });

      const identifiers = getRange.mock.calls[0][0].assetProfileIdentifiers;
      const symbols = identifiers.map(({ symbol }) => symbol);

      expect(symbols).toEqual(
        expect.arrayContaining([
          'EURJPY',
          'JPYUSD',
          'USDJPY',
          'EURCHF',
          'CHFUSD',
          'USDCHF',
          'EURCAD',
          'CADUSD',
          'USDCAD'
        ])
      );
    });

    it('uses the requested historical freshness threshold', async () => {
      await service.acquireSnapshot({
        userId: 'user-id',
        startDate,
        endDate,
        baseCurrency: 'EUR',
        maxAgeDays: 14
      });

      expect(getRange).toHaveBeenCalledWith(
        expect.objectContaining({
          dateQuery: {
            gte: new Date('2026-09-17T00:00:00.000Z'),
            lt: new Date('2026-10-04T00:00:00.000Z')
          },
          transaction
        })
      );
    });

    it('does not query market data when no foreign currency is present', async () => {
      readCash.mockResolvedValue({
        userId: 'user-id',
        startDate: '2026-10-01',
        endDate,
        accounts: []
      });

      await service.acquireSnapshot({
        userId: 'user-id',
        startDate,
        endDate,
        baseCurrency: 'EUR'
      });

      expect(getRange).not.toHaveBeenCalled();
    });

    it('rejects invalid dates before opening a transaction', async () => {
      await expect(
        service.acquireSnapshot({
          userId: 'user-id',
          startDate: '2026-02-30',
          endDate,
          baseCurrency: 'EUR'
        })
      ).rejects.toThrow(RangeError);

      expect(prismaTransaction).not.toHaveBeenCalled();
    });

    it('rejects reversed date ranges before opening a transaction', async () => {
      await expect(
        service.acquireSnapshot({
          userId: 'user-id',
          startDate: endDate,
          endDate: startDate,
          baseCurrency: 'EUR'
        })
      ).rejects.toThrow('startDate must not follow endDate');

      expect(prismaTransaction).not.toHaveBeenCalled();
    });

    it('rejects invalid freshness thresholds before opening a transaction', async () => {
      await expect(
        service.acquireSnapshot({
          userId: 'user-id',
          startDate,
          endDate,
          baseCurrency: 'EUR',
          maxAgeDays: -1
        })
      ).rejects.toThrow('maxAgeDays must be a non-negative integer');

      expect(prismaTransaction).not.toHaveBeenCalled();
    });
  });
});
