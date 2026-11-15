import { Big } from 'big.js';

import {
  HistoricalCloseObservation,
  resolveHistoricalClose
} from './historical-close-resolver';

const FX_DECIMAL_PLACES = 40;
const FxBig = Big();

FxBig.DP = FX_DECIMAL_PLACES;
FxBig.RM = FxBig.roundHalfUp;

export interface HistoricalFxInput {
  date: string;
  fromCurrency: string;
  toCurrency: string;
  maxAgeDays: number;
  observationsByPair: Readonly<
    Record<string, readonly HistoricalCloseObservation[] | undefined>
  >;
}

export interface HistoricalFxSource {
  pair: string;
  sourceDate: string;
  inverted: boolean;
}

export type HistoricalFxResult =
  | {
      status: 'available';
      factor: string;
      sources: HistoricalFxSource[];
    }
  | {
      status: 'unavailable';
      factor: null;
      reason: 'missing_exchange_rate';
    };

interface CurrencyNormalization {
  rootCurrency: string;
  scaleToRoot: string;
}

const DERIVED_CURRENCIES: Record<string, CurrencyNormalization> = {
  GBp: { rootCurrency: 'GBP', scaleToRoot: '0.01' },
  ILA: { rootCurrency: 'ILS', scaleToRoot: '0.01' },
  ZAc: { rootCurrency: 'ZAR', scaleToRoot: '0.01' }
};

function normalizeCurrency(currency: string): CurrencyNormalization {
  return (
    DERIVED_CURRENCIES[currency] ?? {
      rootCurrency: currency,
      scaleToRoot: '1'
    }
  );
}

/**
 * Returns every persisted market pair required by the historical FX resolver.
 * Includes direct, inverse and USD-triangulated paths.
 */
export function getHistoricalFxMarketPairs({
  currencies,
  baseCurrency
}: {
  currencies: readonly string[];
  baseCurrency: string;
}): string[] {
  const base = normalizeCurrency(baseCurrency).rootCurrency;
  const pairs = new Set<string>();

  for (const currency of currencies) {
    const root = normalizeCurrency(currency).rootCurrency;

    if (root === base) {
      continue;
    }

    const candidates: [string, string][] = [
      [root, base],
      [base, root],
      [root, 'USD'],
      ['USD', root],
      [base, 'USD'],
      ['USD', base]
    ];

    for (const [from, to] of candidates) {
      if (from !== to) {
        pairs.add(`${from}${to}`);
      }
    }
  }

  return [...pairs].sort();
}

interface ResolvedFx {
  rate: Big;
  sources: HistoricalFxSource[];
}

/**
 * Resolves a verified conversion in either direction.
 * No future quote, implicit parity or unverified carried-forward
 * observation is accepted.
 */
function resolveFxLeg({
  fromCurrency,
  toCurrency,
  date,
  maxAgeDays,
  observationsByPair
}: HistoricalFxInput): ResolvedFx | null {
  if (fromCurrency === toCurrency) {
    return { rate: new FxBig(1), sources: [] };
  }

  const directPair = `${fromCurrency}${toCurrency}`;
  const inversePair = `${toCurrency}${fromCurrency}`;

  for (const [pair, inverted] of [
    [directPair, false],
    [inversePair, true]
  ] as const) {
    const result = resolveHistoricalClose({
      date,
      maxAgeDays,
      observations: observationsByPair[pair] ?? []
    });

    if (result.status === 'unavailable') {
      continue;
    }

    const price = new FxBig(result.price);

    return {
      rate: inverted ? new FxBig(1).div(price) : price,
      sources: [
        {
          pair,
          sourceDate: result.sourceDate,
          inverted
        }
      ]
    };
  }

  return null;
}

/**
 * Resolves historical FX without using current rates or synthetic parity.
 *
 * Direct and inverse market pairs take precedence. If neither resolves,
 * two verified legs through Ghostfolio's USD default currency are tried.
 *
 * Derived subunit currencies use Ghostfolio's fixed ratios.
 *
 * The caller must fetch sufficient historical observations for each
 * potentially required market pair.
 */
export function resolveHistoricalFx({
  date,
  fromCurrency,
  toCurrency,
  maxAgeDays,
  observationsByPair
}: HistoricalFxInput): HistoricalFxResult {
  // Validate the date and policy even for identity conversions.
  resolveHistoricalClose({
    date,
    maxAgeDays,
    observations: []
  });

  if (!fromCurrency || !toCurrency) {
    throw new RangeError('Both FX currencies are required');
  }

  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);

  const input = {
    date,
    fromCurrency: from.rootCurrency,
    toCurrency: to.rootCurrency,
    maxAgeDays,
    observationsByPair
  };

  let resolved = resolveFxLeg(input);

  if (!resolved) {
    const first = resolveFxLeg({
      ...input,
      toCurrency: 'USD'
    });

    const second = resolveFxLeg({
      ...input,
      fromCurrency: 'USD'
    });

    if (first && second) {
      resolved = {
        rate: first.rate.times(second.rate),
        sources: [...first.sources, ...second.sources]
      };
    }
  }

  if (!resolved) {
    return {
      status: 'unavailable',
      factor: null,
      reason: 'missing_exchange_rate'
    };
  }

  const factor = new FxBig(from.scaleToRoot)
    .times(resolved.rate)
    .div(new FxBig(to.scaleToRoot));

  return {
    status: 'available',
    factor: factor.round(FX_DECIMAL_PLACES, FxBig.roundHalfUp).toFixed(),
    sources: resolved.sources
  };
}
