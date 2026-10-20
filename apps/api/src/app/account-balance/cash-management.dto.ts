import { COMMENT_MAXIMUM_LENGTH } from '@ghostfolio/common/config';
import { IsValidAccountBalanceDateConstraint } from '@ghostfolio/common/validator-constraints/is-valid-account-balance-date';

import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested
} from 'class-validator';

export class CashRevisionDto {
  @IsBoolean()
  @IsOptional()
  confirmNegativeBalance?: boolean;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  expectedRevision: number;
}

export class CashOpeningDto {
  @IsString()
  @MaxLength(100)
  balance: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @Validate(IsValidAccountBalanceDateConstraint)
  date: string;

  @IsBoolean()
  @IsOptional()
  confirmNegativeBalance?: boolean;
}

export class CashEventDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  fee?: string;

  @IsString()
  @MaxLength(100)
  @ValidateIf((event) => event.type === 'MOVEMENT')
  amount?: string;

  @IsString()
  @MaxLength(100)
  @ValidateIf((event) => event.type === 'CHECKPOINT')
  balance?: string;

  @IsString()
  @IsOptional()
  @MaxLength(COMMENT_MAXIMUM_LENGTH)
  comment?: string | null;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @Validate(IsValidAccountBalanceDateConstraint)
  date: string;

  @IsIn(['MOVEMENT', 'CHECKPOINT'])
  type: 'MOVEMENT' | 'CHECKPOINT';
}

export class CashMutationDto extends CashRevisionDto {
  @IsDefined()
  @Type(() => CashEventDto)
  @ValidateNested()
  event: CashEventDto;
}

export class CashPreferencesDto extends CashRevisionDto {
  @IsBoolean()
  @IsOptional()
  defaultUpdateCash?: boolean;

  @IsBoolean()
  @IsOptional()
  includeCashInPortfolio?: boolean;
}
