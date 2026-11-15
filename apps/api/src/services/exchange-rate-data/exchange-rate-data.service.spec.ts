import { DEFAULT_CURRENCY } from '@ghostfolio/common/config';

import { DataSource, Prisma } from '@prisma/client';

import { ExchangeRateDataService } from './exchange-rate-data.service';

describe('ExchangeRateDataService transaction support', () => {
  let service: ExchangeRateDataService;
  let get: jest.Mock;
  let getRange: jest.Mock;

  const transaction = {} as Prisma.TransactionClient;
  const date = new Date('2024-01-15T00:00:00.000Z');
  const startDate = new Date('2024-01-01T00:00:00.000Z');
  const endDate = new Date('2024-01-01T23:59:59.999Z');

  beforeEach(() => {
    get = jest.fn();
    getRange = jest.fn();

    service = new ExchangeRateDataService(
      {
        getDataSourceForExchangeRates: jest
          .fn()
          .mockReturnValue(DataSource.YAHOO)
      } as never,
      { get, getRange } as never,
      {} as never,
      {} as never
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('toCurrencyAtDate', () => {
    it('uses the transaction for a direct conversion', async () => {
      get.mockResolvedValue({ marketPrice: 0.9 });

      const result = await service.toCurrencyAtDate(
        100,
        'EUR',
        'USD',
        date,
        transaction
      );

      expect(result).toBe(90);
      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith({
        dataSource: DataSource.YAHOO,
        symbol: 'EURUSD',
        date,
        transaction
      });
    });

    it('uses the same transaction for both legs of a triangulated conversion', async () => {
      get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ marketPrice: 0.8 })
        .mockResolvedValueOnce({ marketPrice: 1.25 });

      const result = await service.toCurrencyAtDate(
        100,
        'CHF',
        'GBP',
        date,
        transaction
      );

      expect(result).toBe(156.25);
      expect(get).toHaveBeenCalledTimes(3);

      expect(get).toHaveBeenNthCalledWith(1, {
        dataSource: DataSource.YAHOO,
        symbol: 'CHFGBP',
        date,
        transaction
      });

      expect(get).toHaveBeenNthCalledWith(2, {
        dataSource: DataSource.YAHOO,
        symbol: `${DEFAULT_CURRENCY}CHF`,
        date,
        transaction
      });

      expect(get).toHaveBeenNthCalledWith(3, {
        dataSource: DataSource.YAHOO,
        symbol: `${DEFAULT_CURRENCY}GBP`,
        date,
        transaction
      });
    });

    it('preserves autonomous direct conversion without a transaction', async () => {
      get.mockResolvedValue({ marketPrice: 0.9 });

      const result = await service.toCurrencyAtDate(100, 'EUR', 'USD', date);

      expect(result).toBe(90);
      expect(get).toHaveBeenCalledWith({
        dataSource: DataSource.YAHOO,
        symbol: 'EURUSD',
        date,
        transaction: undefined
      });
    });

    it('returns undefined when neither direct nor triangulated rates are available', async () => {
      get.mockResolvedValue(null);

      const result = await service.toCurrencyAtDate(
        100,
        'CHF',
        'GBP',
        date,
        transaction
      );

      expect(result).toBeUndefined();
      expect(get).toHaveBeenCalledTimes(3);
      expect(get).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ transaction })
      );
      expect(get).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ transaction })
      );
    });
  });

  describe('getExchangeRatesByCurrency', () => {
    it('uses the transaction for a direct historical conversion', async () => {
      jest.useFakeTimers().setSystemTime(endDate);
      getRange.mockResolvedValue([{ date: startDate, marketPrice: 0.9 }]);

      const result = await service.getExchangeRatesByCurrency({
        currencies: ['EUR'],
        startDate,
        endDate,
        targetCurrency: 'USD',
        transaction
      });

      expect(result.EURUSD['2024-01-01']).toBe(0.9);
      expect(getRange).toHaveBeenCalledTimes(1);
      expect(getRange).toHaveBeenCalledWith({
        assetProfileIdentifiers: [
          {
            dataSource: DataSource.YAHOO,
            symbol: 'EURUSD'
          }
        ],
        dateQuery: {
          gte: startDate,
          lt: endDate
        },
        transaction
      });
    });

    it('uses the same transaction for both legs of a historical triangulated conversion', async () => {
      jest.useFakeTimers().setSystemTime(endDate);
      getRange
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ date: startDate, marketPrice: 0.8 }])
        .mockResolvedValueOnce([{ date: startDate, marketPrice: 1.25 }]);

      const result = await service.getExchangeRatesByCurrency({
        currencies: ['CHF'],
        startDate,
        endDate,
        targetCurrency: 'GBP',
        transaction
      });

      expect(result.CHFGBP['2024-01-01']).toBe(1.5625);
      expect(getRange).toHaveBeenCalledTimes(3);

      for (const [call] of getRange.mock.calls) {
        expect(call.transaction).toBe(transaction);
      }

      expect(
        getRange.mock.calls.map(
          ([call]) => call.assetProfileIdentifiers[0].symbol
        )
      ).toEqual(['CHFGBP', `${DEFAULT_CURRENCY}CHF`, `${DEFAULT_CURRENCY}GBP`]);
    });

    it('preserves autonomous historical conversion without a transaction', async () => {
      jest.useFakeTimers().setSystemTime(endDate);
      getRange.mockResolvedValue([{ date: startDate, marketPrice: 0.9 }]);

      const result = await service.getExchangeRatesByCurrency({
        currencies: ['EUR'],
        startDate,
        endDate,
        targetCurrency: 'USD'
      });

      expect(result.EURUSD['2024-01-01']).toBe(0.9);
      expect(getRange).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: undefined
        })
      );
    });
  });
});
