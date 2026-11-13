import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { validate, validateSync } from 'class-validator';

import { UpdateUserSettingDto } from './update-user-setting.dto';

describe('UpdateUserSettingDto performance calculation', () => {
  it.each(Object.values(PerformanceCalculationType))(
    'accepts %s',
    async (calculationType) => {
      const dto = new UpdateUserSettingDto();
      dto.performanceCalculationType = calculationType;

      const errors = await validate(dto);

      expect(
        errors.filter(
          (error) => error.property === 'performanceCalculationType'
        )
      ).toHaveLength(0);
    }
  );

  it.each(['INVALID', 'ROA', '', 123, null])(
    'rejects invalid value %s',
    async (value) => {
      const dto = new UpdateUserSettingDto();
      dto.performanceCalculationType = value as PerformanceCalculationType;

      const errors = await validate(dto);

      if (value === null) {
        // Null is accepted by @IsOptional, matching existing DTO semantics.
        expect(
          errors.filter(
            (error) => error.property === 'performanceCalculationType'
          )
        ).toHaveLength(0);
      } else {
        expect(
          errors.some(
            (error) => error.property === 'performanceCalculationType'
          )
        ).toBe(true);
      }
    }
  );
});

describe('UpdateUserSettingDto benchmark comparison mode', () => {
  function validateMode(value?: unknown) {
    const dto = new UpdateUserSettingDto();

    if (value !== undefined) {
      Object.assign(dto, { benchmarkComparisonMode: value });
    }

    return validateSync(dto).filter(({ property }) => {
      return property === 'benchmarkComparisonMode';
    });
  }

  it.each([
    'TRADITIONAL',
    'ACTIVITY_MATCHED_ROI',
    'ACTIVITY_MATCHED_ROAI',
    'ACTIVITY_MATCHED_MWR',
    'ACTIVITY_MATCHED_TWR'
  ])('accepts %s', (mode) => {
    expect(validateMode(mode)).toEqual([]);
  });

  it('accepts an omitted mode for backward compatibility', () => {
    expect(validateMode()).toEqual([]);
  });

  it.each(['ROI', 'ROAI', 'MWR', 'INVALID', '', 123, true, [], {}])(
    'rejects invalid mode %p',
    (mode) => {
      expect(validateMode(mode)).toHaveLength(1);
    }
  );

  it('currently accepts null through IsOptional', () => {
    expect(validateMode(null)).toEqual([]);
  });
});
