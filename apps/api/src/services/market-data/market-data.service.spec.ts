import { parseDate } from '@ghostfolio/common/helper';

import { DataSource } from '@prisma/client';

import { MarketDataService } from './market-data.service';

describe('MarketDataService', () => {
  let marketDataService: MarketDataService;
  let prismaService: {
    $transaction: jest.Mock;
    marketData: {
      count: jest.Mock;
      createMany: jest.Mock;
      deleteMany: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(() => {
    prismaService = {
      $transaction: jest.fn(),
      marketData: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({})
      }
    };

    marketDataService = new MarketDataService(prismaService as any);
  });

  describe('read methods', () => {
    it('uses the supplied transaction in get()', async () => {
      const expected = { marketPrice: 100 };
      const transaction = {
        marketData: {
          findFirst: jest.fn().mockResolvedValue(expected)
        }
      };

      const date = parseDate('2026-08-22');

      const result = await marketDataService.get({
        dataSource: 'YAHOO',
        symbol: 'AAPL',
        date,
        transaction: transaction as never
      });

      expect(result).toBe(expected);
      expect(transaction.marketData.findFirst).toHaveBeenCalledWith({
        where: {
          dataSource: 'YAHOO',
          symbol: 'AAPL',
          date
        }
      });
      expect(prismaService.marketData.findFirst).not.toHaveBeenCalled();
    });

    it('uses PrismaService in get() when no transaction is supplied', async () => {
      const expected = { marketPrice: 100 };
      prismaService.marketData.findFirst.mockResolvedValue(expected);

      const date = parseDate('2026-08-22');

      const result = await marketDataService.get({
        dataSource: 'YAHOO',
        symbol: 'AAPL',
        date
      });

      expect(result).toBe(expected);
      expect(prismaService.marketData.findFirst).toHaveBeenCalledWith({
        where: {
          dataSource: 'YAHOO',
          symbol: 'AAPL',
          date
        }
      });
    });

    it('uses the supplied transaction in getRange()', async () => {
      const expected = [{ marketPrice: 100 }];
      const transaction = {
        marketData: {
          findMany: jest.fn().mockResolvedValue(expected)
        }
      };

      const dateQuery = {
        gte: parseDate('2026-08-01'),
        lt: parseDate('2026-09-01')
      };

      const assetProfileIdentifiers = [
        { dataSource: DataSource.YAHOO, symbol: 'AAPL' }
      ];

      const result = await marketDataService.getRange({
        assetProfileIdentifiers,
        dateQuery,
        skip: 10,
        take: 20,
        transaction: transaction as never
      });

      expect(result).toBe(expected);
      expect(transaction.marketData.findMany).toHaveBeenCalledWith({
        skip: 10,
        take: 20,
        orderBy: [{ date: 'asc' }, { symbol: 'asc' }],
        where: {
          date: dateQuery,
          OR: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
        }
      });
      expect(prismaService.marketData.findMany).not.toHaveBeenCalled();
    });

    it('uses PrismaService in getRange() when no transaction is supplied', async () => {
      const expected = [{ marketPrice: 100 }];
      prismaService.marketData.findMany.mockResolvedValue(expected);

      const dateQuery = {
        gte: parseDate('2026-08-01')
      };

      const assetProfileIdentifiers = [
        { dataSource: DataSource.YAHOO, symbol: 'AAPL' }
      ];

      const result = await marketDataService.getRange({
        assetProfileIdentifiers,
        dateQuery
      });

      expect(result).toBe(expected);
      expect(prismaService.marketData.findMany).toHaveBeenCalledWith({
        orderBy: [{ date: 'asc' }, { symbol: 'asc' }],
        where: {
          date: dateQuery,
          OR: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
        }
      });
    });
  });

  describe('getRangeCount', () => {
    it('uses the supplied transaction', async () => {
      const transactionCount = jest.fn().mockResolvedValue(42);

      const transaction = {
        marketData: {
          count: transactionCount
        }
      };

      const dateQuery = {
        gte: parseDate('2026-08-01'),
        lt: parseDate('2026-09-01')
      };

      const assetProfileIdentifiers = [
        { dataSource: DataSource.YAHOO, symbol: 'AAPL' },
        { dataSource: DataSource.MANUAL, symbol: 'MSFT' }
      ];

      const result = await marketDataService.getRangeCount({
        assetProfileIdentifiers,
        dateQuery,
        transaction: transaction as never
      });

      expect(result).toBe(42);
      expect(transactionCount).toHaveBeenCalledTimes(1);

      expect(transactionCount).toHaveBeenCalledWith({
        where: {
          date: dateQuery,
          OR: [
            { dataSource: DataSource.YAHOO, symbol: 'AAPL' },
            { dataSource: DataSource.MANUAL, symbol: 'MSFT' }
          ]
        }
      });

      expect(prismaService.marketData.count).not.toHaveBeenCalled();
    });

    it('uses PrismaService when no transaction is supplied', async () => {
      prismaService.marketData.count.mockResolvedValue(17);

      const dateQuery = {
        gte: parseDate('2026-08-01'),
        lt: parseDate('2026-09-01')
      };

      const assetProfileIdentifiers = [
        { dataSource: DataSource.YAHOO, symbol: 'AAPL' }
      ];

      const result = await marketDataService.getRangeCount({
        assetProfileIdentifiers,
        dateQuery
      });

      expect(result).toBe(17);

      expect(prismaService.marketData.count).toHaveBeenCalledWith({
        where: {
          date: dateQuery,
          OR: [{ dataSource: DataSource.YAHOO, symbol: 'AAPL' }]
        }
      });
    });
  });

  describe('updateMany', () => {
    it('does not drop isCarriedForward', async () => {
      prismaService.$transaction.mockImplementation((promises) => {
        return Promise.all(promises);
      });

      await marketDataService.updateMany({
        data: [
          {
            dataSource: 'YAHOO',
            date: parseDate('2026-08-22'),
            isCarriedForward: true,
            marketPrice: 100,
            state: 'CLOSE',
            symbol: 'AAPL'
          }
        ]
      });

      expect(prismaService.marketData.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ isCarriedForward: true }),
          update: expect.objectContaining({ isCarriedForward: true })
        })
      );
    });

    it('resets isCarriedForward if it is omitted by the caller', async () => {
      prismaService.$transaction.mockImplementation((promises) => {
        return Promise.all(promises);
      });

      await marketDataService.updateMany({
        data: [
          {
            dataSource: 'YAHOO',
            date: parseDate('2026-08-22'),
            marketPrice: 100,
            state: 'CLOSE',
            symbol: 'AAPL'
          }
        ]
      });

      expect(prismaService.marketData.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ isCarriedForward: false })
        })
      );
    });
  });

  describe('replaceForSymbol', () => {
    it('does not drop isCarriedForward', async () => {
      prismaService.$transaction.mockImplementation((callback) => {
        return callback(prismaService);
      });

      await marketDataService.replaceForSymbol({
        data: [
          {
            dataSource: 'YAHOO',
            date: parseDate('2026-08-21'),
            isCarriedForward: false,
            marketPrice: 100,
            state: 'CLOSE',
            symbol: 'AAPL'
          },
          {
            dataSource: 'YAHOO',
            date: parseDate('2026-08-22'),
            isCarriedForward: true,
            marketPrice: 100,
            state: 'CLOSE',
            symbol: 'AAPL'
          }
        ],
        dataSource: 'YAHOO',
        symbol: 'AAPL'
      });

      const { data } = prismaService.marketData.createMany.mock.calls[0][0];

      expect(data).toEqual([
        expect.objectContaining({ isCarriedForward: false }),
        expect.objectContaining({ isCarriedForward: true })
      ]);
    });
  });
});
