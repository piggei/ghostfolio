import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import 'reflect-metadata';

import { CashMutationDto } from './cash-management.dto';

describe('Manual cash economic classification DTO', () => {
  const validate = (event: Record<string, unknown>) =>
    validateSync(
      plainToInstance(CashMutationDto, { expectedRevision: 0, event }),
      { whitelist: true, forbidNonWhitelisted: true }
    );
  const movement = { type: 'MOVEMENT', amount: '500', date: '2026-10-02' };

  it.each(['EXTERNAL_CAPITAL', 'INCOME', 'EXPENSE', null, undefined])(
    'accepts category %s on a movement',
    (economicClassification) => {
      expect(validate({ ...movement, economicClassification })).toEqual([]);
    }
  );
  it('accepts an unchanged old-client payload', () => {
    expect(validate(movement)).toEqual([]);
  });
  it.each(['external_capital', '', 1, false, {}, []])(
    'rejects invalid category %p',
    (economicClassification) => {
      expect(
        validate({ ...movement, economicClassification }).length
      ).toBeGreaterThan(0);
    }
  );
  it.each(['EXTERNAL_CAPITAL', 'INCOME', 'EXPENSE'])(
    'rejects category %s on a checkpoint',
    (economicClassification) => {
      expect(
        validate({
          type: 'CHECKPOINT',
          balance: '100',
          date: '2026-10-02',
          economicClassification
        }).length
      ).toBeGreaterThan(0);
    }
  );
  it('accepts explicit clearing on a checkpoint', () => {
    expect(
      validate({
        type: 'CHECKPOINT',
        balance: '100',
        date: '2026-10-02',
        economicClassification: null
      })
    ).toEqual([]);
  });
  it.each(['orderId', 'transferId', 'transferCounterpartyAmount'])(
    'does not accept forged relationship %s',
    (field) => {
      expect(
        validate({
          ...movement,
          economicClassification: 'INCOME',
          [field]: 'forged'
        }).length
      ).toBeGreaterThan(0);
    }
  );
});
