import { Big } from 'big.js';

export interface DailyNavCashAccount {
  accountId: string;
  currency: string;
  balance: string | null | undefined;
  included: boolean;
}

export interface DailyNavInput {
  date: string;
  securitiesValue: string | null | undefined;
  cashAccounts: readonly DailyNavCashAccount[];
  baseCurrency: string;
  /**
   * Verified conversion factors from each source currency to the
   * portfolio base currency, for the accounting date supplied.
   *
   * Missing rates must never be interpreted as parity.
   */
  exchangeRates: Readonly<Record<string, string | null | undefined>>;
}

export type DailyNavResult =
  | {
      date: string;
      status: 'available';
      nav: string;
    }
  | {
      date: string;
      status: 'unavailable';
      nav: null;
      reason:
        | 'missing_securities_valuation'
        | 'missing_cash_balance'
        | 'missing_exchange_rate'
        | 'invalid_decimal';
    };

function parseDecimal(value: string | null | undefined): Big | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  try {
    return new Big(value);
  } catch {
    return null;
  }
}

/**
 * Combines an independently verified securities valuation with the
 * included cash accounts, without introducing floating-point rounding.
 *
 * The caller is responsible for validating the accounting date,
 * securities prices, cash ledger balances and historical FX provenance.
 *
 * This function must not receive a securities value that already
 * includes the same cash balances.
 */
export function composeDailyNav({
  date,
  securitiesValue,
  cashAccounts,
  baseCurrency,
  exchangeRates
}: DailyNavInput): DailyNavResult {
  const unavailable = (
    reason: Extract<DailyNavResult, { status: 'unavailable' }>['reason']
  ): DailyNavResult => ({
    date,
    status: 'unavailable',
    nav: null,
    reason
  });

  if (securitiesValue == null) {
    return unavailable('missing_securities_valuation');
  }

  const securities = parseDecimal(securitiesValue);

  if (securities === null) {
    return unavailable('invalid_decimal');
  }

  let nav = securities;

  for (const account of cashAccounts) {
    if (!account.included) {
      continue;
    }

    if (account.balance == null) {
      return unavailable('missing_cash_balance');
    }

    const balance = parseDecimal(account.balance);

    if (balance === null) {
      return unavailable('invalid_decimal');
    }

    if (account.currency === baseCurrency || balance.eq(0)) {
      nav = nav.plus(balance);
      continue;
    }

    const rateValue = exchangeRates[account.currency];

    if (rateValue == null) {
      return unavailable('missing_exchange_rate');
    }

    const rate = parseDecimal(rateValue);

    if (rate === null || rate.lte(0)) {
      return unavailable('invalid_decimal');
    }

    nav = nav.plus(balance.times(rate));
  }

  return {
    date,
    status: 'available',
    nav: nav.toFixed()
  };
}
