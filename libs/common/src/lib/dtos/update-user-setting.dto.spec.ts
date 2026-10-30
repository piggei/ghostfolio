import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { validate } from 'class-validator';

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
