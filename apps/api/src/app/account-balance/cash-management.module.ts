import { ExchangeRateDataModule } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';

import { CashManagementService } from './cash-management.service';
import { DailyCashClassificationReader } from './daily-cash-classification-reader.service';
import { DailyCashPersistedReader } from './daily-cash-persisted-reader.service';

@Module({
  exports: [
    CashManagementService,
    DailyCashClassificationReader,
    DailyCashPersistedReader
  ],
  imports: [ExchangeRateDataModule, PrismaModule],
  providers: [
    CashManagementService,
    DailyCashClassificationReader,
    DailyCashPersistedReader
  ]
})
export class CashManagementModule {}
