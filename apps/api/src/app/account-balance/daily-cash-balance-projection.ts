import type { CashBalanceCalculation } from './cash-balance-calculator';

export type DailyCashBalance = { date: string } & (
  | { status: 'available'; balance: string }
  | {
      status: 'unavailable';
      balance: null;
      reason: 'no_opening_balance';
    }
);

/**
 * Projects the complete, unfiltered balances returned by calculateCashBalances.
 * The first row is the opening day's final balance; rows are unique and sorted.
 * No ledger events are replayed here. Values remain in the account's currency
 * and are serialized exactly, without rounding or classifying movements.
 * The inclusive civil-date range is independent of the instance time zone.
 */
export function projectDailyCashBalances({
  balances,
  startDate,
  endDate
}: {
  balances: readonly CashBalanceCalculation['balances'][number][];
  startDate: string;
  endDate: string;
}): DailyCashBalance[] {
  const start = parseCivilDate(startDate);
  const end = parseCivilDate(endDate);
  if (start > end) {
    throw new RangeError('Cash projection start must not follow its end');
  }

  let previousDate: string | undefined;
  for (const { date } of balances) {
    parseCivilDate(date);
    if (previousDate !== undefined && date <= previousDate) {
      throw new RangeError(
        'Canonical cash balance dates must be unique and sorted'
      );
    }
    previousDate = date;
  }

  const days: DailyCashBalance[] = [];
  let index = 0;
  let balance: string | undefined;
  for (
    const cursor = start;
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    while (index < balances.length && balances[index].date <= date) {
      balance = balances[index].value.toFixed();
      index += 1;
    }
    days.push(
      balance === undefined
        ? {
            date,
            status: 'unavailable',
            balance: null,
            reason: 'no_opening_balance'
          }
        : { date, status: 'available', balance }
    );
  }
  return days;
}

function parseCivilDate(value: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('Cash projection dates must use YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError('Cash projection dates must be valid calendar dates');
  }
  return date;
}
