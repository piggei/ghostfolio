import {
  activityDummyData,
  assetProfileDummyData
} from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator-test-utils';
import { PortfolioCalculatorFactory } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator.factory';
import { PortfolioSnapshotCalculationContext } from '@ghostfolio/api/app/portfolio/interfaces/snapshot-calculation-context.interface';
import { parseDate } from '@ghostfolio/common/helper';
import { Activity } from '@ghostfolio/common/interfaces';
import { PortfolioSnapshot } from '@ghostfolio/common/models';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

jest.mock('@ghostfolio/api/app/portfolio/current-rate.service', () => ({
  CurrentRateService: jest.fn()
}));
jest.mock(
  '@ghostfolio/api/services/configuration/configuration.service',
  () => ({
    ConfigurationService: jest.fn()
  })
);
jest.mock(
  '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service',
  () => ({
    ExchangeRateDataService: jest.fn()
  })
);
jest.mock(
  '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service',
  () => ({
    PortfolioSnapshotService: jest.fn()
  })
);
jest.mock('@ghostfolio/api/services/redis-cache/redis-cache.service', () => ({
  RedisCacheService: jest.fn()
}));

describe('Portfolio snapshot calculation context', () => {
  const rates = {
    USDEUR: {
      '2025-12-29': 0.8,
      '2025-12-30': 0.8,
      '2025-12-31': 0.8,
      '2026-01-01': 0.8
    }
  };
  let snapshot: PortfolioSnapshot;
  let context: PortfolioSnapshotCalculationContext;
  let value: string | undefined;
  let factory: PortfolioCalculatorFactory;
  let args: Parameters<PortfolioCalculatorFactory['createCalculator']>[0];
  let quotes: { getValues: jest.Mock };
  let fx: { getExchangeRatesByCurrency: jest.Mock };
  let queue: { addJobToQueue: jest.Mock; getJob: jest.Mock };

  const payload = (
    calculationContext: unknown = context,
    expiration = Date.now() + 60000
  ) => {
    return JSON.stringify({
      calculationContext,
      expiration,
      portfolioSnapshot: snapshot
    });
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(parseDate('2026-01-01'));
    value = undefined;
    const activity: Activity = {
      ...activityDummyData,
      assetProfile: {
        ...assetProfileDummyData,
        assetClass: 'EQUITY',
        assetSubClass: 'STOCK',
        currency: 'USD',
        dataSource: 'YAHOO',
        name: 'Cache test',
        symbol: 'CACHE_TEST'
      },
      date: parseDate('2025-12-30'),
      feeInAssetProfileCurrency: 0,
      feeInBaseCurrency: 0,
      quantity: 1,
      type: 'BUY',
      unitPriceInAssetProfileCurrency: 100
    };
    quotes = {
      getValues: jest.fn().mockResolvedValue({
        dataProviderInfos: [],
        errors: [],
        values: [
          {
            date: parseDate('2025-12-30'),
            dataSource: 'YAHOO',
            symbol: 'CACHE_TEST',
            marketPrice: 100
          },
          {
            date: parseDate('2026-01-01'),
            dataSource: 'YAHOO',
            symbol: 'CACHE_TEST',
            marketPrice: 110
          }
        ]
      })
    };
    fx = { getExchangeRatesByCurrency: jest.fn().mockResolvedValue(rates) };
    queue = {
      addJobToQueue: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue({
        finished: jest.fn().mockImplementation(async () => {
          value = payload();
        })
      })
    };
    factory = new PortfolioCalculatorFactory(
      { get: () => 365 } as never,
      quotes as never,
      fx as never,
      queue as never,
      {
        getPortfolioSnapshotKey: () => 'context-test',
        get: async () => value
      } as never
    );
    args = {
      accountBalanceItems: [],
      activities: [activity],
      calculationType: PerformanceCalculationType.ROI,
      currency: 'EUR',
      filters: [],
      userId: 'context-test'
    };
    const calculator = factory.createCalculator({
      ...args,
      usePortfolioSnapshotCache: false
    });
    snapshot = await calculator.getSnapshot();
    context = calculator.getCalculationContext();
    quotes.getValues.mockClear();
    fx.getExchangeRatesByCurrency.mockClear();
  });

  afterEach(() => jest.useRealTimers());

  it('captures the FX rates of the completed computation outside the public snapshot', () => {
    expect(context).toEqual({
      version: 1,
      currency: 'EUR',
      exchangeRatesByCurrency: rates
    });
    expect(snapshot).not.toHaveProperty('calculationContext');
  });

  // TWR/MWR are still placeholders on upstream main. These cases exercise the
  // shared cache lifecycle without invoking their unimplemented formulas.
  it.each(Object.values(PerformanceCalculationType))(
    'restores the same frozen context on a %s cache hit',
    async (calculationType) => {
      value = payload();
      fx.getExchangeRatesByCurrency.mockResolvedValue({
        USDEUR: { '2026-01-01': 0.9 }
      });
      const calculator = factory.createCalculator({ ...args, calculationType });
      const cached = await calculator.getSnapshot();
      expect(JSON.parse(JSON.stringify(cached))).toEqual(
        JSON.parse(JSON.stringify(snapshot))
      );
      expect(calculator.getCalculationContext()).toEqual(context);
      expect(quotes.getValues).not.toHaveBeenCalled();
      expect(fx.getExchangeRatesByCurrency).not.toHaveBeenCalled();
      expect(queue.addJobToQueue).not.toHaveBeenCalled();
    }
  );

  it.each([PerformanceCalculationType.TWR, PerformanceCalculationType.MWR])(
    'rebuilds legacy %s snapshots instead of calculating periods with missing FX',
    async (calculationType) => {
      value = JSON.stringify({
        expiration: Date.now() + 60000,
        portfolioSnapshot: snapshot
      });
      const calculator = factory.createCalculator({ ...args, calculationType });
      await calculator.getSnapshot();
      expect(calculator.getCalculationContext()).toEqual(context);
      expect(queue.addJobToQueue).toHaveBeenCalledTimes(1);
      expect(queue.getJob).toHaveBeenCalledWith('context-test');
      expect(quotes.getValues).not.toHaveBeenCalled();
      expect(fx.getExchangeRatesByCurrency).not.toHaveBeenCalled();
    }
  );

  it.each([PerformanceCalculationType.ROI, PerformanceCalculationType.ROAI])(
    'continues to serve legacy %s snapshots without recalculation',
    async (calculationType) => {
      value = JSON.stringify({
        expiration: Date.now() + 60000,
        portfolioSnapshot: snapshot
      });
      await factory
        .createCalculator({ ...args, calculationType })
        .getSnapshot();
      expect(queue.addJobToQueue).not.toHaveBeenCalled();
      expect(quotes.getValues).not.toHaveBeenCalled();
    }
  );

  it.each([
    { ...rates, invalid: [] },
    { USDEUR: { '2026-01-01': '0.8' } },
    { USDEUR: { '2026-01-01': null } },
    null,
    []
  ])('rebuilds malformed FX contexts (%j)', async (exchangeRatesByCurrency) => {
    value = payload({ ...context, exchangeRatesByCurrency });
    const calculator = factory.createCalculator({
      ...args,
      calculationType: PerformanceCalculationType.MWR
    });
    await calculator.getSnapshot();
    expect(calculator.getCalculationContext()).toEqual(context);
    expect(queue.addJobToQueue).toHaveBeenCalledTimes(1);
  });

  it.each([{ version: 0 }, { currency: 'USD' }])(
    'rebuilds incompatible contexts (%j)',
    async (changes) => {
      value = payload({ ...context, ...changes });
      const calculator = factory.createCalculator(args);
      await calculator.getSnapshot();
      expect(calculator.getCalculationContext()).toEqual(context);
      expect(queue.addJobToQueue).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps an expired snapshot and its FX together while refreshing in the background', async () => {
    value = payload(context, Date.now() - 1);
    const calculator = factory.createCalculator({
      ...args,
      calculationType: PerformanceCalculationType.MWR
    });
    await calculator.getSnapshot();
    expect(calculator.getCalculationContext()).toEqual(context);
    expect(queue.addJobToQueue).toHaveBeenCalledTimes(1);
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(fx.getExchangeRatesByCurrency).not.toHaveBeenCalled();
  });

  it('accepts an empty context for a portfolio with no investments', async () => {
    const empty = factory.createCalculator({
      ...args,
      activities: [],
      usePortfolioSnapshotCache: false
    });
    const emptySnapshot = await empty.getSnapshot();
    value = JSON.stringify({
      calculationContext: empty.getCalculationContext(),
      expiration: Date.now() + 60000,
      portfolioSnapshot: emptySnapshot
    });
    const cached = factory.createCalculator({
      ...args,
      activities: [],
      calculationType: PerformanceCalculationType.MWR
    });
    expect((await cached.getSnapshot()).historicalData).toEqual([]);
    expect(cached.getCalculationContext().exchangeRatesByCurrency).toEqual({});
    expect(queue.addJobToQueue).not.toHaveBeenCalled();
  });
});
