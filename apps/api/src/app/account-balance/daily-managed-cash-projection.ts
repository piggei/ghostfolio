import { Big } from 'big.js';

import {
  calculateCashBalances,
  type CashBalanceEvent
} from './cash-balance-calculator';
import {
  projectDailyCashBalances,
  type DailyCashBalance
} from './daily-cash-balance-projection';

export type DailyManagedCashEvent =
  | {
      date: string;
      sequence: number;
      type: 'CHECKPOINT';
      balance: string;
    }
  | {
      date: string;
      sequence: number;
      type: 'MOVEMENT';
      amount: string;
      fee?: string | null;
    };

export interface DailyManagedCashSnapshot {
  accountId: string;
  currency: string;
  includeCashInPortfolio?: boolean | null;
  isAutomaticOpening: boolean;
  revision: number;
  openingBalance: {
    date: string;
    sequence: number;
    balance: string;
  };
  events: readonly DailyManagedCashEvent[];
}

export interface DailyManagedCashProjection {
  accountId: string;
  currency: string;
  included: boolean;
  revision: number;
  balances: DailyCashBalance[];
}

/**
 * Rebuilds daily balances from a persisted managed-cash snapshot.
 *
 * Snapshot movement amounts are gross of separately recorded fees.
 * The canonical cash calculator instead expects fee-adjusted movements.
 * Reapply the same normalization used by CashManagementService.
 *
 * No legacy AccountBalance floats or historical FX rates are used here.
 */
export function projectDailyManagedCash({
  snapshot,
  startDate,
  endDate
}: {
  snapshot: DailyManagedCashSnapshot;
  startDate: string;
  endDate: string;
}): DailyManagedCashProjection {
  let openingBalance = snapshot.openingBalance;
  let sourceEvents = snapshot.events;

  const firstCheckpoint = snapshot.isAutomaticOpening
    ? snapshot.events
        .filter((event) => event.type === 'CHECKPOINT')
        .sort((left, right) => {
          return (
            left.date.localeCompare(right.date) ||
            left.sequence - right.sequence
          );
        })[0]
    : undefined;

  if (firstCheckpoint) {
    // Legacy balances migrated to an automatic ledger establish
    // the first reliable historical balance.
    openingBalance = {
      date: firstCheckpoint.date,
      sequence: firstCheckpoint.sequence,
      balance: firstCheckpoint.balance
    };

    sourceEvents = snapshot.events.filter((event) => {
      return (
        event.date > firstCheckpoint.date ||
        (event.date === firstCheckpoint.date &&
          event.sequence > firstCheckpoint.sequence)
      );
    });
  }

  const events: CashBalanceEvent[] = sourceEvents.map((event) => {
    const position = {
      date: event.date,
      sequence: event.sequence
    };

    if (event.type === 'CHECKPOINT') {
      return {
        ...position,
        type: 'CHECKPOINT',
        balance: event.balance
      };
    }

    return {
      ...position,
      type: 'MOVEMENT',
      amount: new Big(event.amount).minus(event.fee ?? '0').toFixed()
    };
  });

  const calculation = calculateCashBalances({
    openingBalance,
    events
  });

  // For a zero-based automatic ledger without checkpoints, the implicit
  // opening is technical. The first movement establishes availability.
  const dailyBalances =
    snapshot.isAutomaticOpening && !firstCheckpoint
      ? calculation.balances.slice(1)
      : calculation.balances;

  return {
    accountId: snapshot.accountId,
    currency: snapshot.currency,
    included: snapshot.includeCashInPortfolio ?? true,
    revision: snapshot.revision,
    balances: projectDailyCashBalances({
      balances: dailyBalances,
      startDate,
      endDate
    })
  };
}
