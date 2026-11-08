import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  ValidateIf,
  ValidateNested
} from 'class-validator';

import { AccountBalanceDto } from './account-balance.dto';
import { CreateAccountDto } from './create-account.dto';

export class CreateAccountWithBalancesDto extends CreateAccountDto {
  // Nullable currencies exist in historical accounts. Preserve them only when
  // restoring legacy balances, never for an activated cash ledger.
  @ValidateIf(
    (account: CreateAccountWithBalancesDto, value: unknown) =>
      value !== null || !!account.cashManagement
  )
  override currency: string;

  @IsObject()
  @IsOptional()
  cashManagement?: import('@ghostfolio/common/interfaces').CashManagementExport;
  @IsArray()
  @IsOptional()
  @Type(() => AccountBalanceDto)
  @ValidateNested({ each: true })
  balances?: AccountBalanceDto[];

  /**
   * @deprecated Accepted for backward compatibility with old export files
   * and mapped to the "Exclude from Analysis" tag (`TAG_ID_EXCLUDE_FROM_ANALYSIS`)
   */
  @IsBoolean()
  @IsOptional()
  isExcluded?: boolean;
}
