import { Big } from 'big.js';

import type { DailySecuritiesValuationResult } from './daily-securities-valuation';
import {
  HistoricalFxInput,
  resolveHistoricalFx
} from './historical-fx-resolver';

export type DailySecuritiesConversionResult =
  | {
      status: 'available';
      securitiesValue: string;
      exchangeRates: Record<string, string>;
    }
  | {
      status: 'unavailable';
      securitiesValue: null;
      reason:
        | 'missing_securities_valuation'
        | 'missing_exchange_rate'
        | 'invalid_decimal';
      currency?: string;
    };

/**
 * Converts verified security values into the portfolio base currency.
 *
 * Inputs remain decimal strings throughout. Historical FX rates are
 * resolved independently for the accounting date and never substituted
 * with current rates or implicit parity.
 *
 * Cash is intentionally excluded and must be added by DailyNavComposer.
 */
export function convertDailySecuritiesValues({
  date,
  valuation,
  baseCurrency,
  observationsByPair,
  maxAgeDays
}: {
  date: string;
  valuation: DailySecuritiesValuationResult;
  baseCurrency: string;
  observationsByPair: HistoricalFxInput['observationsByPair'];
  maxAgeDays: number;
}): DailySecuritiesConversionResult {
  if (valuation.date !== date) {
    throw new RangeError('Securities valuation date mismatch');
  }

  // Validate the date and age policy even for an empty portfolio.
  resolveHistoricalFx({
    date,
    fromCurrency: baseCurrency,
    toCurrency: baseCurrency,
    maxAgeDays,
    observationsByPair
  });

  if (valuation.status === 'unavailable') {
    return {
      status: 'unavailable',
      securitiesValue: null,
      reason: 'missing_securities_valuation'
    };
  }

  let total = new Big(0);
  const exchangeRates: Record<string, string> = {};

  for (const [currency, valueString] of Object.entries(
    valuation.valuesByCurrency
  )) {
    let value: Big;

    try {
      value = new Big(valueString);
    } catch {
      return {
        status: 'unavailable',
        securitiesValue: null,
        reason: 'invalid_decimal',
        currency
      };
    }

    if (value.eq(0)) {
      continue;
    }

    const conversion = resolveHistoricalFx({
      date,
      fromCurrency: currency,
      toCurrency: baseCurrency,
      maxAgeDays,
      observationsByPair
    });

    if (conversion.status === 'unavailable') {
      return {
        status: 'unavailable',
        securitiesValue: null,
        reason: 'missing_exchange_rate',
        currency
      };
    }

    exchangeRates[currency] = conversion.factor;
    total = total.plus(value.times(new Big(conversion.factor)));
  }

  return {
    status: 'available',
    securitiesValue: total.toFixed(),
    exchangeRates
  };
}
