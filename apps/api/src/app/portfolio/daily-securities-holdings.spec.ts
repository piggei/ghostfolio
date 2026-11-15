import { Big } from 'big.js';

import { selectDailySecuritiesHoldings } from './daily-securities-holdings';
import type { HoldingBalance } from './interfaces/holding-balance.interface';
import type { HoldingBalancesAtDate } from './interfaces/holding-balances-at-date.interface';

describe('Daily securities holdings selector', () => {
  const holding = (
    symbol: string,
    quantity: string,
    overrides: Partial<HoldingBalance> = {}
  ): HoldingBalance => ({
    activitiesCount: 1,
    assetSubClass: null,
    averagePrice: new Big(100),
    currency: 'EUR',
    dataSource: 'YAHOO',
    dateOfFirstActivity: '2026-10-01',
    fee: new Big(0),
    feeInBaseCurrency: new Big(0),
    includeInHoldings: true,
    investment: new Big(100),
    quantity: new Big(quantity),
    skipErrors: false,
    symbol,
    tax: new Big(0),
    taxInBaseCurrency: new Big(0),
    ...overrides
  });

  const snapshot = (
    date: string,
    holdings: HoldingBalance[]
  ): HoldingBalancesAtDate => ({
    date,
    holdings
  });

  it('selects the snapshot matching the requested date', () => {
    const result = selectDailySecuritiesHoldings({
      date: '2026-10-02',
      history: [
        snapshot('2026-10-01', [holding('AAA', '2')]),
        snapshot('2026-10-02', [holding('AAA', '3')])
      ]
    });

    expect(result.status).toBe('available');

    if (result.status === 'available') {
      expect(result.sourceDate).toBe('2026-10-02');
      expect(result.holdings[0].quantity.toFixed()).toBe('3');
    }
  });

  it('uses the latest preceding snapshot on a day without trades', () => {
    const result = selectDailySecuritiesHoldings({
      date: '2026-10-04',
      history: [
        snapshot('2026-10-01', [holding('AAA', '2')]),
        snapshot('2026-10-02', [holding('AAA', '3')])
      ]
    });

    expect(result.status).toBe('available');

    if (result.status === 'available') {
      expect(result.sourceDate).toBe('2026-10-02');
      expect(result.holdings[0].quantity.toFixed()).toBe('3');
    }
  });

  it('does not use future positions to reconstruct the past', () => {
    expect(
      selectDailySecuritiesHoldings({
        date: '2026-10-01',
        history: [snapshot('2026-10-02', [holding('AAA', '3')])]
      })
    ).toEqual({
      date: '2026-10-01',
      status: 'unavailable',
      reason: 'missing_holdings_history',
      holdings: []
    });
  });

  it('excludes synthetic CASH positions', () => {
    const result = selectDailySecuritiesHoldings({
      date: '2026-10-02',
      history: [
        snapshot('2026-10-02', [
          holding('AAA', '2'),
          holding('EUR', '1000', { assetSubClass: 'CASH' })
        ])
      ]
    });

    expect(result.status).toBe('available');

    if (result.status === 'available') {
      expect(result.holdings.map(({ symbol }) => symbol)).toEqual(['AAA']);
    }
  });

  it('excludes zero quantities and holdings outside the portfolio', () => {
    const result = selectDailySecuritiesHoldings({
      date: '2026-10-02',
      history: [
        snapshot('2026-10-02', [
          holding('ZERO', '0'),
          holding('HIDDEN', '2', { includeInHoldings: false }),
          holding('ACTIVE', '4')
        ])
      ]
    });

    expect(result.status).toBe('available');

    if (result.status === 'available') {
      expect(result.holdings.map(({ symbol }) => symbol)).toEqual(['ACTIVE']);
    }
  });

  it('preserves negative quantities', () => {
    const result = selectDailySecuritiesHoldings({
      date: '2026-10-02',
      history: [snapshot('2026-10-02', [holding('SHORT', '-2.5')])]
    });

    expect(result.status).toBe('available');

    if (result.status === 'available') {
      expect(result.holdings[0].quantity.toFixed()).toBe('-2.5');
    }
  });

  it('rejects invalid calendar dates', () => {
    expect(() =>
      selectDailySecuritiesHoldings({
        date: '2026-02-30',
        history: []
      })
    ).toThrow(RangeError);
  });
});
