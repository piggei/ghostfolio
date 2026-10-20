import { AccountBalance } from '@ghostfolio/common/interfaces';

import { IsArray, IsBoolean, IsObject, IsOptional } from 'class-validator';

import { CreateAccountDto } from './create-account.dto';

export class CreateAccountWithBalancesDto extends CreateAccountDto {
  @IsObject()
  @IsOptional()
  cashManagement?: import('@ghostfolio/common/interfaces').CashManagementExport;
  @IsArray()
  @IsOptional()
  balances?: AccountBalance[];

  /**
   * @deprecated Accepted for backward compatibility with old export files
   * and mapped to the "Exclude from Analysis" tag (`TAG_ID_EXCLUDE_FROM_ANALYSIS`)
   */
  @IsBoolean()
  @IsOptional()
  isExcluded?: boolean;
}
