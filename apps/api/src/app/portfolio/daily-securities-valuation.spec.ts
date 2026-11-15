import { Big } from 'big.js';

import {
  calculateDailySecuritiesValuation,
  SecuritiesValuationItem
} from './daily-securities-valuation';

describe('Daily securities valuation', () => {
  const item = ({
    symbol,
    quantity,
    price,
    currency = 'EUR',
    date = '2026-10-02'
  }: {
    symbol: string;
    quantity: string;
    price: number;
    currency?: string;
    date?: string;
  }): SecuritiesValuationItem => ({
    holding: {
      currency,
      dataSource: 'YAHOO',
      quantity: new Big(quantity),
      symbol
    },
    observations: [
      {
        date,
        marketPrice: price,
        state: 'CLOSE',
        isCarriedForward: false
      }
    ]
  });

  it('values fractional quantities without rounding', () => {
    expect(
      calculateDailySecuritiesValuation({
        date: '2026-10-02',
        items: [
          item({
            symbol: 'AAA',
            quantity: '1.25',
            price: 12.5
          })
        ],
        maxAgeDays: 7
      })
    ).toEqual({
      date: '2026-10-02',
      status: 'available',
      valuesByCurrency: { EUR: '15.625' }
    });
  });

  it('aggregates multiple securities in the same currency', () => {
    expect(
      calculateDailySecuritiesValuation({
        date: '2026-10-02',
        items: [
          item({ symbol: 'AAA', quantity: '0.1', price: 0.2 }),
          item({ symbol: 'BBB', quantity: '0.3', price: 0.4 })
        ],
        maxAgeDays: 7
      })
    ).toEqual({
      date: '2026-10-02',
      status: 'available',
      valuesByCurrency: { EUR: '0.14' }
    });
  });

  it('keeps different currencies separate', () => {
    expect(
      calculateDailySecuritiesValuation({
        date: '2026-10-02',
        items: [
          item({ symbol: 'AAA', quantity: '2', price: 10 }),
          item({
            symbol: 'BBB',
            quantity: '3',
            price: 20,
            currency: 'USD'
          })
        ],
        maxAgeDays: 7
      })
    ).toEqual({
      date: '2026-10-02',
      status: 'available',
      valuesByCurrency: {
        EUR: '20',
        USD: '60'
      }
    });
  });

  it('preserves negative short positions', () => {
    expect(
      calculateDailySecuritiesValuation({
        date: '2026-10-02',
        items: [item({ symbol: 'SHORT', quantity: '-2.5', price: 40 })],
        maxAgeDays: 7
      })
    ).toEqual({
      date: '2026-10-02',
      status: 'available',
      valuesByCurrency: { EUR: '-100' }
    });
  });

  it('uses a genuine previous close within the age limit', () => {
    expect(
      calculateDailySecuritiesValuation({
        date: '2026-10-04',
        items: [
          item({
            symbol: 'AAA',
            quantity: '2',
            price: 125.5
          })
        ],
        maxAgeDays: 7
      })
    ).toEqual({
      date: '2026-10-04',
      status: 'available',
      valuesByCurrency: { EUR: '251' }
    });
  });

  it('rejects a stale closing price', () => {
    expect(
      calculateDailySecuritiesValuation({
        date: '2026-10-15',
        items: [
          item({
            symbol: 'AAA',
            quantity: '2',
            price: 125.5
          })
        ],
        maxAgeDays: 7
      })
    ).toMatchObject({
      status: 'unavailable',
      reason: 'stale_price',
      symbol: 'AAA',
      valuesByCurrency: null
    });
  });

  it('rejects missing prices and identifies the affected security', () => {
    const missing = item({
      symbol: 'MISSING',
      quantity: '3',
      price: 50
    });

    missing.observations = [];

    expect(
      calculateDailySecuritiesValuation({
        date: '2026-10-02',
        items: [item({ symbol: 'AAA', quantity: '2', price: 10 }), missing],
        maxAgeDays: 7
      })
    ).toMatchObject({
      date: '2026-10-02',
      status: 'unavailable',
      reason: 'missing_price',
      dataSource: 'YAHOO',
      symbol: 'MISSING',
      currency: 'EUR',
      valuesByCurrency: null
    });
  });

  it('returns zero securities valuation for a verified empty set', () => {
    expect(
      calculateDailySecuritiesValuation({
        date: '2026-10-02',
        items: [],
        maxAgeDays: 7
      })
    ).toEqual({
      date: '2026-10-02',
      status: 'available',
      valuesByCurrency: {}
    });
  });

  it('validates dates even when there are no securities', () => {
    expect(() =>
      calculateDailySecuritiesValuation({
        date: '2026-02-30',
        items: [],
        maxAgeDays: 7
      })
    ).toThrow(RangeError);
  });
});
