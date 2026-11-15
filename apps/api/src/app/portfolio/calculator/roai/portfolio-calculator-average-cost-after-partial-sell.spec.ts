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

import { Big } from 'big.js';

jest.mock('@ghostfolio/api/app/portfolio/current-rate.service', () => {
  return {
    CurrentRateService: jest.fn().mockImplementation(() => {
      return CurrentRateServiceMock;
    })
  };
});

jest.mock(
  '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service',
  () => {
    return {
      PortfolioSnapshotService: jest.fn().mockImplementation(() => {
        return PortfolioSnapshotServiceMock;
      })
    };
  }
);

jest.mock('@ghostfolio/api/services/redis-cache/redis-cache.service', () => {
  return {
    RedisCacheService: jest.fn().mockImplementation(() => {
      return RedisCacheServiceMock;
    })
  };
});

describe('PortfolioCalculator', () => {
  let configurationService: ConfigurationService;
  let currentRateService: CurrentRateService;
  let exchangeRateDataService: ExchangeRateDataService;
  let portfolioCalculatorFactory: PortfolioCalculatorFactory;
  let portfolioSnapshotService: PortfolioSnapshotService;
  let redisCacheService: RedisCacheService;

  beforeEach(() => {
    PortfolioSnapshotServiceMock.reset();
    RedisCacheServiceMock.reset();

    configurationService = new ConfigurationService();

    currentRateService = new CurrentRateService(null, null, null);

    exchangeRateDataService = new ExchangeRateDataService(
      null,
      null,
      null,
      null
    );

    portfolioSnapshotService = new PortfolioSnapshotService(null, null);

    redisCacheService = new RedisCacheService(null, null);

    portfolioCalculatorFactory = new PortfolioCalculatorFactory(
      configurationService,
      currentRateService,
      exchangeRateDataService,
      portfolioSnapshotService,
      redisCacheService
    );
  });

  it('uses the remaining cost basis after a partial sell and another buy', async () => {
    jest.useFakeTimers().setSystemTime(parseDate('2021-12-18').getTime());

    const assetProfile = {
      ...assetProfileDummyData,
      currency: 'CHF',
      dataSource: 'YAHOO' as const,
      name: 'Bâloise Holding AG',
      symbol: 'BALN.SW'
    };

    const activities: Activity[] = [
      {
        ...activityDummyData,
        assetProfile,
        date: new Date('2021-11-22'),
        feeInAssetProfileCurrency: 0,
        feeInBaseCurrency: 0,
        quantity: 10,
        type: 'BUY',
        unitPriceInAssetProfileCurrency: 100
      },
      {
        ...activityDummyData,
        assetProfile,
        date: new Date('2021-11-24'),
        feeInAssetProfileCurrency: 0,
        feeInBaseCurrency: 0,
        quantity: 5,
        type: 'SELL',
        unitPriceInAssetProfileCurrency: 110
      },
      {
        ...activityDummyData,
        assetProfile,
        date: new Date('2021-11-26'),
        feeInAssetProfileCurrency: 0,
        feeInBaseCurrency: 0,
        quantity: 5,
        type: 'BUY',
        unitPriceInAssetProfileCurrency: 200
      },
      {
        ...activityDummyData,
        assetProfile,
        date: new Date('2021-11-30'),
        feeInAssetProfileCurrency: 0,
        feeInBaseCurrency: 0,
        quantity: 10,
        type: 'SELL',
        unitPriceInAssetProfileCurrency: 210
      }
    ];

    const portfolioCalculator = portfolioCalculatorFactory.createCalculator({
      activities,
      calculationType: PerformanceCalculationType.ROAI,
      currency: 'CHF',
      usePortfolioSnapshotCache: false,
      userId: userDummyData.id
    });

    const portfolioSnapshot = await portfolioCalculator.computeSnapshot();

    /**
     * BUY 10 x 100 = 1000
     * SELL 5 x 110 => realized gain 50, remaining cost basis 500
     * BUY 5 x 200 = 1000 => remaining cost basis 1500 for 10 shares
     * SELL 10 x 210 => realized gain 600
     *
     * Total gross performance = 50 + 600 = 650
     */
    expect(portfolioSnapshot.positions[0]).toMatchObject({
      grossPerformance: new Big('650'),
      grossPerformanceWithCurrencyEffect: new Big('650'),
      investment: new Big('0'),
      investmentWithCurrencyEffect: new Big('0'),
      quantity: new Big('0')
    });
  });

  it.each([
    {
      name: 'consecutive partial sells',
      operations: [
        { type: 'BUY', quantity: 10, price: 100 },
        { type: 'SELL', quantity: 3, price: 110 },
        { type: 'SELL', quantity: 2, price: 120 }
      ],
      expectedQuantity: 5,
      expectedInvestment: 500,
      marketPrices: [100, 110, 120, 120]
    },
    {
      name: 'partial sell followed by another buy',
      operations: [
        { type: 'BUY', quantity: 10, price: 100 },
        { type: 'SELL', quantity: 5, price: 110 },
        { type: 'BUY', quantity: 5, price: 200 }
      ],
      expectedQuantity: 10,
      expectedInvestment: 1500,
      marketPrices: [100, 110, 200, 200]
    },
    {
      name: 'partial sell followed by long-to-short transition',
      operations: [
        { type: 'BUY', quantity: 10, price: 10 },
        { type: 'SELL', quantity: 5, price: 12 },
        { type: 'SELL', quantity: 8, price: 12 },
        { type: 'BUY', quantity: 2, price: 11 }
      ],
      expectedQuantity: -1,
      expectedInvestment: null,
      marketPrices: [10, 12, 12, 11]
    }
  ])('preserves average cost after $name', async (scenario) => {
    jest.useFakeTimers().setSystemTime(parseDate('2021-12-18').getTime());

    const assetProfile = {
      ...assetProfileDummyData,
      currency: 'CHF',
      dataSource: 'YAHOO' as const,
      name: 'Bâloise Holding AG',
      symbol: 'BALN.SW'
    };

    const dates = ['2021-11-22', '2021-11-26', '2021-11-30', '2021-12-18'];

    const activities: Activity[] = scenario.operations.map(
      (operation, index) => ({
        ...activityDummyData,
        assetProfile,
        date: parseDate(dates[index]),
        feeInAssetProfileCurrency: 0,
        feeInBaseCurrency: 0,
        quantity: operation.quantity,
        type: operation.type as Activity['type'],
        unitPriceInAssetProfileCurrency: operation.price
      })
    );

    const currentRateServiceForScenario = {
      getValues: jest.fn().mockResolvedValue({
        dataProviderInfos: [],
        errors: [],
        values: dates.map((date, index) => ({
          date: parseDate(date),
          dataSource: 'YAHOO',
          symbol: 'BALN.SW',
          marketPrice: scenario.marketPrices[index]
        }))
      })
    } as unknown as CurrentRateService;

    const scenarioCalculatorFactory = new PortfolioCalculatorFactory(
      configurationService,
      currentRateServiceForScenario,
      exchangeRateDataService,
      portfolioSnapshotService,
      redisCacheService
    );

    const results = [];

    for (const calculationType of [
      PerformanceCalculationType.ROI,
      PerformanceCalculationType.ROAI
    ]) {
      PortfolioSnapshotServiceMock.reset();
      RedisCacheServiceMock.reset();

      const calculator = scenarioCalculatorFactory.createCalculator({
        activities,
        calculationType,
        currency: 'CHF',
        usePortfolioSnapshotCache: false,
        userId: userDummyData.id
      });

      const snapshot = await calculator.computeSnapshot();

      expect(snapshot.hasErrors).toBe(false);
      expect(snapshot.errors).toHaveLength(0);
      expect(snapshot.positions).toHaveLength(1);

      const position = snapshot.positions[0];

      expect(position.quantity.toNumber()).toBe(scenario.expectedQuantity);

      if (scenario.expectedInvestment !== null) {
        expect(position.investment.toNumber()).toBeCloseTo(
          scenario.expectedInvestment,
          8
        );
      }

      results.push({
        calculationType,
        quantity: position.quantity.toString(),
        investment: position.investment.toString(),
        averagePrice: position.averagePrice.toString(),
        value: position.valueInBaseCurrency.toString(),
        grossPerformance: position.grossPerformance.toString(),
        netPerformance: position.netPerformance.toString()
      });
    }

    console.log(
      `PARTIAL SELL CHARACTERIZATION: ${scenario.name}`,
      JSON.stringify(results, null, 2)
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });
});
