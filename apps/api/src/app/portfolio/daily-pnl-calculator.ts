import { Big } from 'big.js';

export interface DailyPnlInput {
  openingNav: string | null | undefined;
  closingNav: string | null | undefined;
  externalNetFlows: string | null | undefined;
  movementClassification: 'complete' | 'unclassified';
  reconciliation: 'none' | 'unresolved';
}

export type DailyPnlResult =
  | { status: 'available'; dailyPnl: string }
  | {
      status: 'unavailable';
      dailyPnl: null;
      reason:
        | 'unclassified_movements'
        | 'unresolved_reconciliation'
        | 'missing_valuation'
        | 'missing_external_flows'
        | 'invalid_decimal';
    };

/**
 * All amounts must already be in the portfolio base currency. Positive external
 * flows enter the included portfolio; negative flows leave it. NAV includes
 * securities and managed cash, including income and expenses already recorded
 * in cash. Do not add realized gains or deduct fees/taxes a second time.
 *
 * The caller supplies classification and valuation availability. This function
 * neither classifies events nor resolves reconciliations, prices or FX rates.
 */
export function calculateDailyPnl(input: DailyPnlInput): DailyPnlResult {
  const unavailable = (
    reason: Extract<DailyPnlResult, { status: 'unavailable' }>['reason']
  ): DailyPnlResult => ({ status: 'unavailable', dailyPnl: null, reason });

  // Require affirmative classification; omitted runtime assurances fail closed.
  if (input.movementClassification !== 'complete') {
    return unavailable('unclassified_movements');
  }
  if (input.reconciliation !== 'none') {
    return unavailable('unresolved_reconciliation');
  }
  if (input.openingNav == null || input.closingNav == null) {
    return unavailable('missing_valuation');
  }
  if (input.externalNetFlows == null) {
    return unavailable('missing_external_flows');
  }

  try {
    const amounts = [
      input.openingNav,
      input.closingNav,
      input.externalNetFlows
    ];
    if (amounts.some((amount) => typeof amount !== 'string')) {
      return unavailable('invalid_decimal');
    }
    const [openingNav, closingNav, externalNetFlows] = amounts.map(
      (amount) => new Big(amount)
    );

    return {
      status: 'available',
      dailyPnl: closingNav.minus(openingNav).minus(externalNetFlows).toFixed()
    };
  } catch {
    return unavailable('invalid_decimal');
  }
}
