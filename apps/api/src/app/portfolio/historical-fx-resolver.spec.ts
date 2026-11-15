import { Big } from 'big.js';

import {
  getHistoricalFxMarketPairs,
  resolveHistoricalFx,
  type HistoricalFxInput
} from './historical-fx-resolver';

describe('Historical FX resolver', () => {
  const close = (
    date: string,
    marketPrice: number,
    isCarriedForward = false
  ) => ({
    date,
    marketPrice,
    state: 'CLOSE' as const,
    isCarriedForward
  });

  const resolve = (overrides: Partial<HistoricalFxInput> = {}) =>
    resolveHistoricalFx({
      date: '2026-10-02',
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      maxAgeDays: 7,
      observationsByPair: {},
      ...overrides
    });

  it('returns exact identity without market quotes', () => {
    expect(
      resolve({
        fromCurrency: 'EUR',
        toCurrency: 'EUR'
      })
    ).toEqual({
      status: 'available',
      factor: '1',
      sources: []
    });
  });

  it('uses a verified direct currency pair', () => {
    expect(
      resolve({
        observationsByPair: {
          EURUSD: [close('2026-10-02', 1.25)]
        }
      })
    ).toEqual({
      status: 'available',
      factor: '1.25',
      sources: [
        {
          pair: 'EURUSD',
          sourceDate: '2026-10-02',
          inverted: false
        }
      ]
    });
  });

  it('inverts a verified reverse pair', () => {
    expect(
      resolve({
        observationsByPair: {
          USDEUR: [close('2026-10-02', 0.8)]
        }
      })
    ).toEqual({
      status: 'available',
      factor: '1.25',
      sources: [
        {
          pair: 'USDEUR',
          sourceDate: '2026-10-02',
          inverted: true
        }
      ]
    });
  });

  it('prefers a direct pair over its inverse', () => {
    expect(
      resolve({
        observationsByPair: {
          EURUSD: [close('2026-10-02', 1.2)],
          USDEUR: [close('2026-10-02', 0.8)]
        }
      })
    ).toMatchObject({
      status: 'available',
      factor: '1.2',
      sources: [{ pair: 'EURUSD', inverted: false }]
    });
  });

  it('triangulates through USD with verified closing prices', () => {
    expect(
      resolve({
        fromCurrency: 'GBP',
        toCurrency: 'EUR',
        observationsByPair: {
          GBPUSD: [close('2026-10-02', 1.3)],
          USDEUR: [close('2026-10-02', 0.9)]
        }
      })
    ).toEqual({
      status: 'available',
      factor: '1.17',
      sources: [
        {
          pair: 'GBPUSD',
          sourceDate: '2026-10-02',
          inverted: false
        },
        {
          pair: 'USDEUR',
          sourceDate: '2026-10-02',
          inverted: false
        }
      ]
    });
  });

  it('rejects triangulation when one leg is stale', () => {
    expect(
      resolve({
        date: '2026-10-15',
        fromCurrency: 'GBP',
        toCurrency: 'EUR',
        observationsByPair: {
          GBPUSD: [close('2026-10-02', 1.3)],
          USDEUR: [close('2026-10-15', 0.9)]
        }
      })
    ).toEqual({
      status: 'unavailable',
      factor: null,
      reason: 'missing_exchange_rate'
    });
  });

  it('never uses a future exchange rate', () => {
    expect(
      resolve({
        observationsByPair: {
          EURUSD: [close('2026-10-03', 1.25)]
        }
      })
    ).toEqual({
      status: 'unavailable',
      factor: null,
      reason: 'missing_exchange_rate'
    });
  });

  it('does not treat carried-forward observations as fresh rates', () => {
    expect(
      resolve({
        date: '2026-10-15',
        observationsByPair: {
          EURUSD: [close('2026-10-02', 1.25), close('2026-10-15', 1.25, true)]
        }
      })
    ).toEqual({
      status: 'unavailable',
      factor: null,
      reason: 'missing_exchange_rate'
    });
  });

  it('never assumes parity when FX is missing', () => {
    expect(resolve()).toEqual({
      status: 'unavailable',
      factor: null,
      reason: 'missing_exchange_rate'
    });
  });

  it.each([
    ['GBp', 'GBP'],
    ['ILA', 'ILS'],
    ['ZAc', 'ZAR']
  ])('converts derived subunit %s to %s', (fromCurrency, toCurrency) => {
    expect(resolve({ fromCurrency, toCurrency })).toEqual({
      status: 'available',
      factor: '0.01',
      sources: []
    });
  });

  it('converts GBP to GBp using the reciprocal fixed scale', () => {
    expect(
      resolve({
        fromCurrency: 'GBP',
        toCurrency: 'GBp'
      })
    ).toEqual({
      status: 'available',
      factor: '100',
      sources: []
    });
  });

  it('combines a derived currency scale with historical FX', () => {
    expect(
      resolve({
        fromCurrency: 'GBp',
        toCurrency: 'USD',
        observationsByPair: {
          GBPUSD: [close('2026-10-02', 1.25)]
        }
      })
    ).toEqual({
      status: 'available',
      factor: '0.0125',
      sources: [
        {
          pair: 'GBPUSD',
          sourceDate: '2026-10-02',
          inverted: false
        }
      ]
    });
  });

  it('rejects invalid FX dates even for identity conversion', () => {
    expect(() =>
      resolve({
        date: '2026-02-30',
        fromCurrency: 'EUR',
        toCurrency: 'EUR'
      })
    ).toThrow(RangeError);
  });

  it('rejects a negative freshness threshold', () => {
    expect(() => resolve({ maxAgeDays: -1 })).toThrow(RangeError);
  });
});

describe('Historical FX precision isolation', () => {
  it('does not depend on global Big.DP for inverse rates', () => {
    const originalDp = Big.DP;

    try {
      Big.DP = 2;

      const result = resolveHistoricalFx({
        date: '2026-10-02',
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        maxAgeDays: 7,
        observationsByPair: {
          EURUSD: [
            {
              date: '2026-10-02',
              marketPrice: 1.13,
              state: 'CLOSE',
              isCarriedForward: false
            }
          ]
        }
      });

      expect(result).toMatchObject({
        status: 'available',
        factor: '0.8849557522123893805309734513274336283186'
      });
    } finally {
      Big.DP = originalDp;
    }
  });

  it('does not depend on global Big.DP for triangulation', () => {
    const originalDp = Big.DP;

    try {
      Big.DP = 2;

      const result = resolveHistoricalFx({
        date: '2026-10-02',
        fromCurrency: 'GBP',
        toCurrency: 'EUR',
        maxAgeDays: 7,
        observationsByPair: {
          USDGBP: [
            {
              date: '2026-10-02',
              marketPrice: 1.13,
              state: 'CLOSE',
              isCarriedForward: false
            }
          ],
          USDEUR: [
            {
              date: '2026-10-02',
              marketPrice: 0.9,
              state: 'CLOSE',
              isCarriedForward: false
            }
          ]
        }
      });

      expect(result).toMatchObject({
        status: 'available',
        factor: '0.7964601769911504424778761061946902654867'
      });
    } finally {
      Big.DP = originalDp;
    }
  });

  describe('getHistoricalFxMarketPairs', () => {
    it('returns direct, inverse and USD triangulation pairs', () => {
      expect(
        getHistoricalFxMarketPairs({
          currencies: ['GBP'],
          baseCurrency: 'EUR'
        })
      ).toEqual(['EURGBP', 'EURUSD', 'GBPEUR', 'GBPUSD', 'USDEUR', 'USDGBP']);
    });

    it('normalizes derived currencies before generating market pairs', () => {
      expect(
        getHistoricalFxMarketPairs({
          currencies: ['GBp', 'ILA', 'ZAc'],
          baseCurrency: 'EUR'
        })
      ).toEqual([
        'EURGBP',
        'EURILS',
        'EURUSD',
        'EURZAR',
        'GBPEUR',
        'GBPUSD',
        'ILSEUR',
        'ILSUSD',
        'USDEUR',
        'USDGBP',
        'USDILS',
        'USDZAR',
        'ZAREUR',
        'ZARUSD'
      ]);
    });

    it('does not request market data for identity conversions', () => {
      expect(
        getHistoricalFxMarketPairs({
          currencies: ['EUR', 'EUR'],
          baseCurrency: 'EUR'
        })
      ).toEqual([]);
    });

    it('does not generate USDUSD for USD conversions', () => {
      const pairs = getHistoricalFxMarketPairs({
        currencies: ['USD', 'GBP'],
        baseCurrency: 'EUR'
      });

      expect(pairs).not.toContain('USDUSD');
      expect(pairs).toEqual([...new Set(pairs)].sort());
    });

    it('removes duplicate pairs and returns deterministic ordering', () => {
      expect(
        getHistoricalFxMarketPairs({
          currencies: ['USD', 'GBP', 'GBP'],
          baseCurrency: 'EUR'
        })
      ).toEqual(
        getHistoricalFxMarketPairs({
          currencies: ['GBP', 'USD'],
          baseCurrency: 'EUR'
        })
      );
    });
  });
});
