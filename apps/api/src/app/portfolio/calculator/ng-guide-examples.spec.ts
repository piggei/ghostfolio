import { CashManagementService } from '@ghostfolio/api/app/account-balance/cash-management.service';
import {
  activityDummyData,
  assetProfileDummyData,
  userDummyData
} from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator-test-utils';
import { PortfolioCalculatorFactory } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator.factory';
import { CurrentRateService } from '@ghostfolio/api/app/portfolio/current-rate.service';
import { CurrentRateServiceMock } from '@ghostfolio/api/app/portfolio/current-rate.service.mock';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { PortfolioSnapshotService } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service';
import { PortfolioSnapshotServiceMock } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service.mock';
import { RedisCacheService } from '@ghostfolio/api/services/redis-cache/redis-cache.service';
import { RedisCacheServiceMock } from '@ghostfolio/api/services/redis-cache/redis-cache.service.mock';
import { parseDate } from '@ghostfolio/common/helper';
import { Activity } from '@ghostfolio/common/interfaces';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { eachDayOfInterval, format } from 'date-fns';

jest.mock('@ghostfolio/api/app/portfolio/current-rate.service', () => ({
  CurrentRateService: jest.fn().mockImplementation(() => CurrentRateServiceMock)
}));
jest.mock(
  '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service',
  () => ({
    PortfolioSnapshotService: jest
      .fn()
      .mockImplementation(() => PortfolioSnapshotServiceMock)
  })
);
jest.mock('@ghostfolio/api/services/redis-cache/redis-cache.service', () => ({
  RedisCacheService: jest.fn().mockImplementation(() => RedisCacheServiceMock)
}));

// These are the guide's numerical scenarios, executed by the existing calculators.
// No financial formula is reimplemented by this test.
function buy(
  date: string,
  quantity: number,
  unitPrice: number,
  tax = 0
): Activity {
  return {
    ...activityDummyData,
    assetProfile: {
      ...assetProfileDummyData,
      currency: 'USD',
      dataSource: 'YAHOO',
      symbol: 'NG_GUIDE'
    },
    date: parseDate(date),
    feeInAssetProfileCurrency: 0,
    feeInBaseCurrency: 0,
    quantity,
    tax,
    taxInAssetProfileCurrency: tax,
    taxInBaseCurrency: tax,
    type: 'BUY',
    unitPriceInAssetProfileCurrency: unitPrice
  };
}

describe('NG guide examples against the integrated financial calculators', () => {
  afterEach(() => jest.useRealTimers());

  it('includes the recorded tax in linked cash without changing gross income', async () => {
    const service = new CashManagementService(null, null, null);
    const cash = service as unknown as {
      orderAmount: (order: object, currency: string) => Promise<string>;
    };
    const amount = await cash.orderAmount(
      {
        type: 'DIVIDEND',
        quantity: 1,
        unitPrice: 100,
        fee: 0,
        tax: 26,
        currency: 'EUR',
        date: parseDate('2025-01-01'),
        SymbolProfile: { currency: 'EUR' }
      },
      'EUR'
    );
    expect(amount).toBe('74');
  });

  async function calculate({
    activities,
    calculationType,
    endDate,
    price
  }: {
    activities: Activity[];
    calculationType: PerformanceCalculationType;
    endDate: string;
    price: (date: string) => number;
  }) {
    jest.useFakeTimers().setSystemTime(parseDate(endDate));
    PortfolioSnapshotServiceMock.reset();
    RedisCacheServiceMock.reset();
    const currentRateService = new CurrentRateService(null, null, null);
    jest
      .spyOn(currentRateService, 'getValues')
      .mockImplementation(({ dataGatheringItems, dateQuery }) =>
        Promise.resolve({
          values: eachDayOfInterval({
            start: dateQuery.gte,
            end: dateQuery.lt
          }).flatMap((date) =>
            dataGatheringItems.map(({ dataSource, symbol }) => ({
              date,
              dataSource,
              symbol,
              marketPrice: price(format(date, 'yyyy-MM-dd'))
            }))
          ),
          dataProviderInfos: [],
          errors: []
        })
      );
    const calculator = new PortfolioCalculatorFactory(
      new ConfigurationService(),
      currentRateService,
      new ExchangeRateDataService(null, null, null, null),
      new PortfolioSnapshotService(null, null),
      new RedisCacheService(null, null)
    ).createCalculator({
      activities,
      calculationType,
      currency: 'USD',
      userId: userDummyData.id,
      usePortfolioSnapshotCache: false
    });
    const snapshot = await calculator.computeSnapshot();
    expect(snapshot.hasErrors).toBe(false);
    const { chart } = await calculator.getPerformance({
      start: activities[0].date,
      end: parseDate(endDate)
    });
    return { ...snapshot.historicalData.at(-1), range: chart.at(-1) };
  }

  it.each(Object.values(PerformanceCalculationType))(
    'no-flow 365-day example is 10 percent with %s',
    async (calculationType) => {
      const result = await calculate({
        activities: [buy('2025-01-01', 10, 100)],
        calculationType,
        endDate: '2026-01-01',
        price: (date) => (date === '2026-01-01' ? 110 : 100)
      });
      expect(result.netPerformanceWithCurrencyEffect).toBeCloseTo(100, 8);
      expect(result.netPerformanceInPercentageWithCurrencyEffect).toBeCloseTo(
        0.1,
        8
      );
    }
  );

  it.each([
    [PerformanceCalculationType.ROI, 0.05],
    [PerformanceCalculationType.ROAI, 0.075]
  ] as const)(
    'four-day additional-investment example uses the documented denominator for %s',
    async (calculationType, expected) => {
      const result = await calculate({
        activities: [buy('2025-01-01', 10, 100), buy('2025-01-03', 10, 100)],
        calculationType,
        endDate: '2025-01-04',
        price: (date) => (date === '2025-01-04' ? 105 : 100)
      });
      expect(result.netPerformanceWithCurrencyEffect).toBeCloseTo(100, 8);
      expect(result.netPerformanceInPercentageWithCurrencyEffect).toBeCloseTo(
        expected,
        8
      );
      if (calculationType === PerformanceCalculationType.ROAI) {
        expect(
          result.range.netPerformanceInPercentageWithCurrencyEffect
        ).toBeCloseTo(100 / 1500, 8);
      }
    }
  );

  it.each([
    [PerformanceCalculationType.TWR, 0.08],
    [PerformanceCalculationType.MWR, -0.006681547693192]
  ] as const)(
    'two 365-day periods distinguish cumulative TWR and annualized MWR (%s)',
    async (calculationType, expected) => {
      const result = await calculate({
        activities: [
          buy('2023-01-01', 10, 100),
          buy('2024-01-01', 1000 / 120, 120)
        ],
        calculationType,
        endDate: '2024-12-31',
        price: (date) =>
          date === '2024-12-31' ? 108 : date >= '2024-01-01' ? 120 : 100
      });
      expect(result.netPerformanceWithCurrencyEffect).toBeCloseTo(-20, 8);
      expect(result.netPerformanceInPercentageWithCurrencyEffect).toBeCloseTo(
        expected,
        8
      );
    }
  );

  it.each([PerformanceCalculationType.TWR, PerformanceCalculationType.MWR])(
    'documents the existing percentage tax limitation for %s without changing it',
    async (calculationType) => {
      const result = await calculate({
        activities: [buy('2025-01-01', 10, 100, 20)],
        calculationType,
        endDate: '2026-01-01',
        price: (date) => (date === '2026-01-01' ? 110 : 100)
      });
      expect(result.netPerformanceWithCurrencyEffect).toBeCloseTo(80, 8);
      expect(result.netPerformanceInPercentageWithCurrencyEffect).toBeCloseTo(
        0.1,
        8
      );
    }
  );
});
