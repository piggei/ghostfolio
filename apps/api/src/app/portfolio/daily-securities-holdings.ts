import type { HoldingBalance } from './interfaces/holding-balance.interface';
import type { HoldingBalancesAtDate } from './interfaces/holding-balances-at-date.interface';

export type DailySecuritiesHoldingsResult =
  | {
      date: string;
      status: 'available';
      sourceDate: string;
      holdings: HoldingBalance[];
    }
  | {
      date: string;
      status: 'unavailable';
      reason: 'missing_holdings_history';
      holdings: [];
    };

function validateCivilDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError('Invalid holdings date');
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new RangeError('Invalid holdings date');
  }
}

/**
 * Selects securities held at the close of a calendar day.
 *
 * Historical quantities are supplied by Ghostfolio's existing
 * PortfolioCalculator and are never recalculated here.
 *
 * CASH positions are excluded because managed cash is valued separately
 * from its decimal ledger.
 *
 * The caller must ensure that the supplied history covers the portfolio
 * scope and contains all relevant activities.
 */
export function selectDailySecuritiesHoldings({
  date,
  history
}: {
  date: string;
  history: readonly HoldingBalancesAtDate[];
}): DailySecuritiesHoldingsResult {
  validateCivilDate(date);

  let latest: HoldingBalancesAtDate | undefined;

  for (const snapshot of history) {
    validateCivilDate(snapshot.date);

    if (
      snapshot.date <= date &&
      (latest === undefined || snapshot.date > latest.date)
    ) {
      latest = snapshot;
    }
  }

  if (!latest) {
    return {
      date,
      status: 'unavailable',
      reason: 'missing_holdings_history',
      holdings: []
    };
  }

  const holdings = latest.holdings.filter((holding) => {
    return (
      holding.assetSubClass !== 'CASH' &&
      holding.includeInHoldings &&
      !holding.quantity.eq(0)
    );
  });

  return {
    date,
    status: 'available',
    sourceDate: latest.date,
    holdings
  };
}
