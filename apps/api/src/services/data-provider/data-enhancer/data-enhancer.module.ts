import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { CryptocurrencyModule } from '@ghostfolio/api/services/cryptocurrency/cryptocurrency.module';
import { IsharesDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/etf-composition/ishares/ishares.service';
import { VanguardDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/etf-composition/vanguard/vanguard.service';
import { WisdomtreeDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/etf-composition/wisdomtree/wisdomtree.service';
import { XtrackersDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/etf-composition/xtrackers/xtrackers.service';
import { OpenFigiDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/openfigi/openfigi.service';
import { TrackinsightDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/trackinsight/trackinsight.service';
import { YahooFinanceDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/yahoo-finance/yahoo-finance.service';
import { FetchModule } from '@ghostfolio/api/services/fetch/fetch.module';

import { Module } from '@nestjs/common';

import { DataEnhancerService } from './data-enhancer.service';
import {
  InvescoDataEnhancerService,
  AmundiDataEnhancerService
} from './etf-composition/issuer-api/issuer-api.service';

@Module({
  exports: [
    DataEnhancerService,
    OpenFigiDataEnhancerService,
    TrackinsightDataEnhancerService,
    YahooFinanceDataEnhancerService,
    XtrackersDataEnhancerService,
    VanguardDataEnhancerService,
    IsharesDataEnhancerService,
    WisdomtreeDataEnhancerService,
    InvescoDataEnhancerService,
    AmundiDataEnhancerService,
    'DataEnhancers'
  ],
  imports: [ConfigurationModule, CryptocurrencyModule, FetchModule],
  providers: [
    DataEnhancerService,
    OpenFigiDataEnhancerService,
    TrackinsightDataEnhancerService,
    YahooFinanceDataEnhancerService,
    XtrackersDataEnhancerService,
    VanguardDataEnhancerService,
    IsharesDataEnhancerService,
    WisdomtreeDataEnhancerService,
    InvescoDataEnhancerService,
    AmundiDataEnhancerService,
    {
      inject: [
        OpenFigiDataEnhancerService,
        TrackinsightDataEnhancerService,
        YahooFinanceDataEnhancerService,
        XtrackersDataEnhancerService,
        VanguardDataEnhancerService,
        IsharesDataEnhancerService,
        WisdomtreeDataEnhancerService,
        InvescoDataEnhancerService,
        AmundiDataEnhancerService
      ],
      provide: 'DataEnhancers',
      useFactory: (
        openfigi,
        trackinsight,
        yahooFinance,
        xtrackers,
        vanguard,
        ishares,
        wisdomtree,
        invesco,
        amundi
      ) => [
        openfigi,
        trackinsight,
        yahooFinance,
        xtrackers,
        vanguard,
        ishares,
        wisdomtree,
        invesco,
        amundi
      ]
    }
  ]
})
export class DataEnhancerModule {}
