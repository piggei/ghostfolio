import { CashManagementModule } from '@ghostfolio/api/app/account-balance/cash-management.module';
import { AccountBalanceModule } from '@ghostfolio/api/services/account-balance/account-balance.module';
import { ExchangeRateDataModule } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';
import { TagModule } from '@ghostfolio/api/services/tag/tag.module';

import { Module } from '@nestjs/common';

import { AccountService } from './account.service';

@Module({
  exports: [AccountService],
  imports: [
    CashManagementModule,
    AccountBalanceModule,
    ExchangeRateDataModule,
    PrismaModule,
    TagModule
  ],
  providers: [AccountService]
})
export class AccountModule {}
