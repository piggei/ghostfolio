import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { PortfolioSnapshotProcessor } from './portfolio-snapshot.processor';

jest.mock(
  '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator.factory',
  () => ({ PortfolioCalculatorFactory: jest.fn() })
);
jest.mock(
  '@ghostfolio/api/services/account-balance/account-balance.service',
  () => ({ AccountBalanceService: jest.fn() })
);
jest.mock('@ghostfolio/api/services/activities/activities.service', () => ({
  ActivitiesService: jest.fn()
}));
jest.mock(
  '@ghostfolio/api/services/configuration/configuration.service',
  () => ({ ConfigurationService: jest.fn() })
);
jest.mock('@ghostfolio/api/services/redis-cache/redis-cache.service', () => ({
  RedisCacheService: jest.fn()
}));

describe('Portfolio snapshot cache producer', () => {
  it('computes once without reading an older cache and writes the matching FX context', async () => {
    const snapshot = { historicalData: [] };
    const calculationContext = {
      version: 1,
      currency: 'EUR',
      exchangeRatesByCurrency: { USDEUR: { '2026-01-01': 0.8 } }
    };
    const calculator = {
      getSnapshot: jest.fn().mockResolvedValue(snapshot),
      getCalculationContext: jest.fn().mockReturnValue(calculationContext),
      computeSnapshot: jest.fn()
    };
    const factory = { createCalculator: jest.fn().mockReturnValue(calculator) };
    const redis = {
      getPortfolioSnapshotKey: jest.fn().mockReturnValue('snapshot-key'),
      set: jest.fn().mockResolvedValue(undefined)
    };
    const activities = {
      getActivitiesForPortfolioCalculator: jest
        .fn()
        .mockResolvedValue({ activities: [] })
    };
    const balances = {
      getAccountBalanceItems: jest.fn().mockResolvedValue([])
    };
    const processor = new PortfolioSnapshotProcessor(
      balances as never,
      activities as never,
      factory as never,
      { get: () => 60000 } as never,
      redis as never
    );
    const result = await processor.calculatePortfolioSnapshot({
      data: {
        userId: 'test',
        userCurrency: 'EUR',
        calculationType: PerformanceCalculationType.ROI,
        filters: []
      }
    } as never);
    expect(result).toBe(snapshot);
    expect(factory.createCalculator).toHaveBeenCalledWith(
      expect.objectContaining({ usePortfolioSnapshotCache: false })
    );
    expect(calculator.getSnapshot).toHaveBeenCalledTimes(1);
    expect(calculator.computeSnapshot).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, serialized] = redis.set.mock.calls[0];
    expect(key).toBe('snapshot-key');
    expect(JSON.parse(serialized)).toEqual({
      calculationContext,
      portfolioSnapshot: snapshot,
      expiration: expect.any(Number)
    });
  });

  it('does not publish a partial context when the calculation fails', async () => {
    const calculator = {
      getSnapshot: jest.fn().mockRejectedValue(new Error('calculation failed')),
      getCalculationContext: jest.fn()
    };
    const redis = { getPortfolioSnapshotKey: jest.fn(), set: jest.fn() };
    const processor = new PortfolioSnapshotProcessor(
      { getAccountBalanceItems: async () => [] } as never,
      {
        getActivitiesForPortfolioCalculator: async () => ({ activities: [] })
      } as never,
      { createCalculator: () => calculator } as never,
      { get: () => 60000 } as never,
      redis as never
    );
    await expect(
      processor.calculatePortfolioSnapshot({
        data: {
          userId: 'test',
          userCurrency: 'EUR',
          calculationType: PerformanceCalculationType.ROI
        }
      } as never)
    ).rejects.toThrow('calculation failed');
    expect(calculator.getCalculationContext).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});
