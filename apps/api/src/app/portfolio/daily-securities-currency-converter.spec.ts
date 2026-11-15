import { convertDailySecuritiesValues } from './daily-securities-currency-converter';
import type { DailySecuritiesValuationResult } from './daily-securities-valuation';

describe('Daily securities currency converter', () => {
  const date = '2026-10-02';

  const close = (marketPrice: number) => ({
    date,
    marketPrice,
    state: 'CLOSE' as const,
    isCarriedForward: false
  });

  const valuation = (
    valuesByCurrency: Record<string, string>
  ): DailySecuritiesValuationResult => ({
    date,
    status: 'available',
    valuesByCurrency
  });

  const convert = ({
    valuesByCurrency,
    observationsByPair = {}
  }: {
    valuesByCurrency: Record<string, string>;
    observationsByPair?: Record<string, ReturnType<typeof close>[]>;
  }) =>
    convertDailySecuritiesValues({
      date,
      valuation: valuation(valuesByCurrency),
      baseCurrency: 'EUR',
      observationsByPair,
      maxAgeDays: 7
    });

  it('combines EUR and USD values using verified historical FX', () => {
    expect(
      convert({
        valuesByCurrency: { EUR: '10', USD: '20' },
        observationsByPair: {
          USDEUR: [close(0.8)]
        }
      })
    ).toEqual({
      status: 'available',
      securitiesValue: '26',
      exchangeRates: {
        EUR: '1',
        USD: '0.8'
      }
    });
  });

  it('supports triangulation via USD', () => {
    expect(
      convert({
        valuesByCurrency: { GBP: '2' },
        observationsByPair: {
          GBPUSD: [close(1.25)],
          USDEUR: [close(0.8)]
        }
      })
    ).toEqual({
      status: 'available',
      securitiesValue: '2',
      exchangeRates: {
        GBP: '1'
      }
    });
  });

  it('preserves decimal precision during aggregation', () => {
    expect(
      convert({
        valuesByCurrency: {
          EUR: '0.1',
          USD: '0.3'
        },
        observationsByPair: {
          USDEUR: [close(0.2)]
        }
      })
    ).toMatchObject({
      status: 'available',
      securitiesValue: '0.16'
    });
  });

  it('preserves negative securities valuations', () => {
    expect(
      convert({
        valuesByCurrency: { USD: '-100' },
        observationsByPair: {
          USDEUR: [close(0.8)]
        }
      })
    ).toMatchObject({
      status: 'available',
      securitiesValue: '-80'
    });
  });

  it('rejects missing FX instead of assuming parity', () => {
    expect(
      convert({
        valuesByCurrency: { USD: '100' }
      })
    ).toEqual({
      status: 'unavailable',
      securitiesValue: null,
      reason: 'missing_exchange_rate',
      currency: 'USD'
    });
  });

  it('rejects invalid decimal values', () => {
    expect(
      convert({
        valuesByCurrency: { EUR: 'not-a-number' }
      })
    ).toEqual({
      status: 'unavailable',
      securitiesValue: null,
      reason: 'invalid_decimal',
      currency: 'EUR'
    });
  });

  it('accepts a verified empty set without requiring FX', () => {
    expect(
      convert({
        valuesByCurrency: {}
      })
    ).toEqual({
      status: 'available',
      securitiesValue: '0',
      exchangeRates: {}
    });
  });

  it('rejects a securities valuation from a different date', () => {
    expect(() =>
      convertDailySecuritiesValues({
        date,
        valuation: {
          date: '2026-10-03',
          status: 'available',
          valuesByCurrency: { EUR: '100' }
        },
        baseCurrency: 'EUR',
        observationsByPair: {},
        maxAgeDays: 7
      })
    ).toThrow(RangeError);
  });
});
