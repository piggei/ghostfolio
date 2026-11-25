import { MODULE_METADATA } from '@nestjs/common/constants';

import { DataEnhancerModule } from './data-enhancer.module';

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));

jest.mock(
  '@ghostfolio/api/services/data-provider/data-enhancer/yahoo-finance/yahoo-finance.service',
  () => ({
    YahooFinanceDataEnhancerService: class YahooFinanceDataEnhancerService {}
  })
);

describe('DataEnhancerModule registration', () => {
  it('preserves upstream enhancer order and appends ETF providers', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      DataEnhancerModule
    );

    const factory = providers.find(
      (provider) =>
        typeof provider === 'object' && provider.provide === 'DataEnhancers'
    );

    expect(factory).toBeDefined();

    const names = factory.inject.map((service) => service.name);

    expect(names).toEqual([
      'OpenFigiDataEnhancerService',
      'TrackinsightDataEnhancerService',
      'YahooFinanceDataEnhancerService',
      'XtrackersDataEnhancerService',
      'VanguardDataEnhancerService',
      'IsharesDataEnhancerService',
      'WisdomtreeDataEnhancerService',
      'InvescoDataEnhancerService',
      'AmundiDataEnhancerService'
    ]);

    for (const service of factory.inject) {
      expect(providers).toContain(service);
    }

    const instances = factory.inject.map((service) => ({
      name: service.name
    }));

    expect(factory.useFactory(...instances)).toEqual(instances);
  });
});
