import { Big } from 'big.js';

import {
  HistoricalCloseObservation,
  HistoricalCloseResult,
  resolveHistoricalClose
} from './historical-close-resolver';
import type { HoldingBalance } from './interfaces/holding-balance.interface';

export interface SecuritiesValuationItem {
  holding: Pick<
    HoldingBalance,
    'currency' | 'dataSource' | 'quantity' | 'symbol'
  >;
  observations: readonly HistoricalCloseObservation[];
}

export type DailySecuritiesValuationResult =
  | {
      date: string;
      status: 'available';
      valuesByCurrency: Record<string, string>;
    }
  | {
      date: string;
      status: 'unavailable';
      reason: Extract<
        HistoricalCloseResult,
        { status: 'unavailable' }
      >['reason'];
      dataSource: HoldingBalance['dataSource'];
      symbol: string;
      currency: string;
      valuesByCurrency: null;
    };

/**
 * Values an already selected set of securities using genuine historical
 * closing prices. All arithmetic uses Big and remains in the security's
 * original currency.
 *
 * The caller must supply complete position history and quote observations.
 * FX conversion and managed cash are deliberately handled elsewhere.
 */
export function calculateDailySecuritiesValuation({
  date,
  items,
  maxAgeDays
}: {
  date: string;
  items: readonly SecuritiesValuationItem[];
  maxAgeDays: number;
}): DailySecuritiesValuationResult {
  const values = new Map<string, Big>();

  if (items.length === 0) {
    // Validate the requested date and price-age policy even without holdings.
    resolveHistoricalClose({
      date,
      observations: [],
      maxAgeDays
    });

    return {
      date,
      status: 'available',
      valuesByCurrency: {}
    };
  }

  for (const { holding, observations } of items) {
    const resolved = resolveHistoricalClose({
      date,
      observations,
      maxAgeDays
    });

    if (resolved.status === 'unavailable') {
      return {
        date,
        status: 'unavailable',
        reason: resolved.reason,
        dataSource: holding.dataSource,
        symbol: holding.symbol,
        currency: holding.currency,
        valuesByCurrency: null
      };
    }

    const value = holding.quantity.times(new Big(resolved.price));

    values.set(
      holding.currency,
      (values.get(holding.currency) ?? new Big(0)).plus(value)
    );
  }

  return {
    date,
    status: 'available',
    valuesByCurrency: Object.fromEntries(
      [...values.entries()].map(([currency, value]) => [
        currency,
        value.toFixed()
      ])
    )
  };
}
