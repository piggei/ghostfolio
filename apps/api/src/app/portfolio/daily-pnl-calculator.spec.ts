import { calculateDailyPnl } from './daily-pnl-calculator';
import type { DailyPnlInput } from './daily-pnl-calculator';

const complete: DailyPnlInput = {
  openingNav: '1000',
  closingNav: '1000',
  externalNetFlows: '0',
  movementClassification: 'complete',
  reconciliation: 'none'
};

describe('Daily total portfolio PnL', () => {
  it.each([
    // All fixtures explicitly state opening NAV, closing NAV, signed flows, PnL.
    [
      'securities appreciation: securities 1000 to 1100, cash 200',
      '1200',
      '1300',
      '0',
      '100'
    ],
    ['external deposit', '1200', '1700', '500', '0'],
    ['external withdrawal', '1700', '1400', '-300', '0'],
    [
      'purchase: cash 1000 to cash 500 plus 10 shares at 50',
      '1000',
      '1000',
      '0',
      '0'
    ],
    [
      'partial sale: 10 shares at 50 plus cash 500 to 6 at 60 plus cash 740 (realized 40 already included)',
      '1000',
      '1100',
      '0',
      '100'
    ],
    [
      'dividend paid into cash with unchanged securities',
      '1200',
      '1230',
      '0',
      '30'
    ],
    ['dividend offsets ex-dividend price reduction', '1200', '1200', '0', '0'],
    ['interest paid into cash', '1000', '1010', '0', '10'],
    ['fee 5 and tax 3 charged once against cash', '1200', '1192', '0', '-8'],
    ['dividend 30 net of tax 6 and fee 1', '1200', '1223', '0', '23'],
    ['external deposit 500 with separate fee 2', '1000', '1498', '500', '-2'],
    ['internal transfer: A1000/B200 to A700/B500', '1200', '1200', '0', '0'],
    ['transfer out across inclusion boundary', '1000', '700', '-300', '0'],
    ['transfer in across inclusion boundary', '700', '1000', '300', '0'],
    [
      'USD cash already converted: 1000 USD at 0.90 to 0.92 EUR',
      '900',
      '920',
      '0',
      '20'
    ],
    [
      'closed holding: securities 1200 and cash 100 to cash 1300',
      '1300',
      '1300',
      '0',
      '0'
    ],
    ['verified zero with zero NAV', '0', '0', '0', '0'],
    [
      'complete sale: securities 1000 plus cash 100 to cash 1300; realized 200 is not added twice',
      '1100',
      '1300',
      '0',
      '200'
    ],
    ['exact decimal subtraction', '0.1', '0.3', '0.1', '0.1'],
    [
      'precision beyond currency and Number precision',
      '9007199254740993.00000000000000000001',
      '9007199254740993.00000000000000000004',
      '0.00000000000000000001',
      '0.00000000000000000002'
    ]
  ])('%s', (_name, openingNav, closingNav, externalNetFlows, expected) => {
    expect(
      calculateDailyPnl({
        ...complete,
        openingNav,
        closingNav,
        externalNetFlows
      })
    ).toEqual({
      status: 'available',
      dailyPnl: expected
    });
  });

  it('does not treat an unresolved reconciliation from 1000 to 1050 as gain', () => {
    expect(
      calculateDailyPnl({
        ...complete,
        closingNav: '1050',
        reconciliation: 'unresolved'
      })
    ).toEqual({
      status: 'unavailable',
      dailyPnl: null,
      reason: 'unresolved_reconciliation'
    });
  });

  it('does not neutralize or infer an unclassified movement', () => {
    expect(
      calculateDailyPnl({
        ...complete,
        closingNav: '1500',
        movementClassification: 'unclassified'
      })
    ).toEqual({
      status: 'unavailable',
      dailyPnl: null,
      reason: 'unclassified_movements'
    });
  });

  it.each(['openingNav', 'closingNav', 'externalNetFlows'] as const)(
    'distinguishes missing %s from zero',
    (field) => {
      const missingValues: (null | undefined)[] = [null, undefined];
      for (const value of missingValues) {
        expect(calculateDailyPnl({ ...complete, [field]: value })).toEqual({
          status: 'unavailable',
          dailyPnl: null,
          reason:
            field === 'externalNetFlows'
              ? 'missing_external_flows'
              : 'missing_valuation'
        });
      }
    }
  );

  it.each(['openingNav', 'closingNav', 'externalNetFlows'] as const)(
    'rejects malformed or non-string %s',
    (field) => {
      for (const value of ['', ' ', 'NaN', 'Infinity', '1,000', 'EUR 10', 0]) {
        expect(calculateDailyPnl({ ...complete, [field]: value })).toEqual({
          status: 'unavailable',
          dailyPnl: null,
          reason: 'invalid_decimal'
        });
      }
    }
  );

  it.each(['movementClassification', 'reconciliation'] as const)(
    'requires explicit %s assurance at runtime',
    (field) => {
      expect(
        calculateDailyPnl({ ...complete, [field]: undefined }).status
      ).toBe('unavailable');
    }
  );

  it('is repeatable and does not mutate its input', () => {
    const input = Object.freeze({ ...complete, closingNav: '1000.001' });
    expect(calculateDailyPnl(input)).toEqual({
      status: 'available',
      dailyPnl: '0.001'
    });
    expect(calculateDailyPnl(input)).toEqual(calculateDailyPnl(input));
    expect(input).toEqual({ ...complete, closingNav: '1000.001' });
  });
});
