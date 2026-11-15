import { projectDailyCashBalances } from '@ghostfolio/api/app/account-balance/daily-cash-balance-projection';

import {
  AssetSubClass,
  DataSource,
  Type as ActivityType
} from '@prisma/client';
import { Big } from 'big.js';

import { projectDailyHoldings } from './daily-holdings-projector';
import { composeDailyNav } from './daily-nav-composer';
import { calculateDailyPnl } from './daily-pnl-calculator';
import { convertDailySecuritiesValues } from './daily-securities-currency-converter';
import { calculateDailySecuritiesValuation } from './daily-securities-valuation';
import { resolveHistoricalFx } from './historical-fx-resolver';
import type { PortfolioCalculatorActivity } from './interfaces/portfolio-calculator-activity.interface';

describe('Daily NAV integration', () => {
  const date = '2026-10-02';

  const close = (marketPrice: number) => ({
    date,
    marketPrice,
    state: 'CLOSE' as const,
    isCarriedForward: false
  });

  const fx = {
    USDEUR: [close(0.8)],
    GBPUSD: [close(1.25)]
  };

  const cash = ({
    accountId,
    currency,
    openingDate = date,
    openingBalance,
    included = true
  }: {
    accountId: string;
    currency: string;
    openingDate?: string;
    openingBalance: string;
    included?: boolean;
  }) => {
    const projected = projectDailyCashBalances({
      balances: [
        {
          date: openingDate,
          value: new Big(openingBalance)
        }
      ],
      startDate: date,
      endDate: date
    })[0];

    return {
      accountId,
      currency,
      included,
      balance: projected.balance
    };
  };

  const nav = ({
    valuesByCurrency = {},
    cashAccounts = [],
    observationsByPair = fx
  }: {
    valuesByCurrency?: Record<string, string>;
    cashAccounts?: ReturnType<typeof cash>[];
    observationsByPair?: typeof fx | Record<string, ReturnType<typeof close>[]>;
  }) => {
    const securities = convertDailySecuritiesValues({
      date,
      valuation: {
        date,
        status: 'available',
        valuesByCurrency
      },
      baseCurrency: 'EUR',
      observationsByPair,
      maxAgeDays: 7
    });

    const exchangeRates: Record<string, string> = {};

    for (const account of cashAccounts) {
      if (
        !account.included ||
        account.balance === null ||
        new Big(account.balance).eq(0)
      ) {
        continue;
      }

      const resolved = resolveHistoricalFx({
        date,
        fromCurrency: account.currency,
        toCurrency: 'EUR',
        observationsByPair,
        maxAgeDays: 7
      });

      if (resolved.status === 'available') {
        exchangeRates[account.currency] = resolved.factor;
      }
    }

    return composeDailyNav({
      date,
      securitiesValue:
        securities.status === 'available' ? securities.securitiesValue : null,
      cashAccounts,
      baseCurrency: 'EUR',
      exchangeRates
    });
  };

  it('combines mult currency securities and cash once', () => {
    expect(
      nav({
        valuesByCurrency: {
          EUR: '100',
          USD: '200'
        },
        cashAccounts: [
          cash({
            accountId: 'eur',
            currency: 'EUR',
            openingBalance: '50'
          }),
          cash({
            accountId: 'gbp',
            currency: 'GBP',
            openingBalance: '10'
          })
        ]
      })
    ).toEqual({
      date,
      status: 'available',
      nav: '320'
    });
  });

  it('preserves negative cash balances', () => {
    expect(
      nav({
        valuesByCurrency: { EUR: '100' },
        cashAccounts: [
          cash({
            accountId: 'eur',
            currency: 'EUR',
            openingBalance: '-25.125'
          })
        ]
      })
    ).toMatchObject({
      status: 'available',
      nav: '74.875'
    });
  });

  it('does not invent an opening cash balance', () => {
    expect(
      nav({
        valuesByCurrency: { EUR: '100' },
        cashAccounts: [
          cash({
            accountId: 'eur',
            currency: 'EUR',
            openingDate: '2026-10-03',
            openingBalance: '50'
          })
        ]
      })
    ).toMatchObject({
      status: 'unavailable',
      nav: null,
      reason: 'missing_cash_balance'
    });
  });

  it('rejects missing FX for nonzero foreign cash', () => {
    expect(
      nav({
        valuesByCurrency: { EUR: '100' },
        cashAccounts: [
          cash({
            accountId: 'gbp',
            currency: 'GBP',
            openingBalance: '20'
          })
        ],
        observationsByPair: {}
      })
    ).toMatchObject({
      status: 'unavailable',
      nav: null,
      reason: 'missing_exchange_rate'
    });
  });

  it('does not include excluded cash accounts', () => {
    expect(
      nav({
        valuesByCurrency: { EUR: '100' },
        cashAccounts: [
          cash({
            accountId: 'excluded',
            currency: 'GBP',
            openingDate: '2026-10-03',
            openingBalance: '100000',
            included: false
          })
        ],
        observationsByPair: {}
      })
    ).toMatchObject({
      status: 'available',
      nav: '100'
    });
  });

  it('preserves NAV and daily PnL across short-to-long transitions', () => {
    const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];

    const operations = [
      { type: ActivityType.SELL, quantity: 10, price: 10 },
      { type: ActivityType.BUY, quantity: 5, price: 12 },
      { type: ActivityType.BUY, quantity: 8, price: 12 },
      { type: ActivityType.SELL, quantity: 2, price: 11 }
    ];

    const activities: PortfolioCalculatorActivity[] = operations.map(
      (operation, index) => ({
        assetProfile: {
          assetSubClass: AssetSubClass.STOCK,
          currency: 'CHF',
          dataSource: DataSource.YAHOO,
          name: 'Integration test asset',
          symbol: 'SHORT.TEST',
          userId: undefined
        },
        date: dates[index],
        fee: new Big(0),
        feeInBaseCurrency: new Big(0),
        quantity: new Big(operation.quantity),
        tags: [],
        tax: new Big(0),
        taxInBaseCurrency: new Big(0),
        type: operation.type,
        unitPrice: new Big(operation.price)
      })
    );

    const prices = [10, 12, 12, 11];
    const cashBalances = [1100, 1040, 944, 966];

    const holdingsHistory = projectDailyHoldings(activities);

    expect(holdingsHistory).toHaveLength(4);

    expect(holdingsHistory.map(({ holdings }) => holdings[0])).toMatchObject([
      {
        quantity: new Big(-10),
        investment: new Big(-100),
        averagePrice: new Big(10)
      },
      {
        quantity: new Big(-5),
        investment: new Big(-50),
        averagePrice: new Big(10)
      },
      {
        quantity: new Big(3),
        investment: new Big(36),
        averagePrice: new Big(12)
      },
      {
        quantity: new Big(1),
        investment: new Big(12),
        averagePrice: new Big(12)
      }
    ]);

    const navResults = dates.map((date, index) => {
      const valuation = calculateDailySecuritiesValuation({
        date,
        items: holdingsHistory[index].holdings.map((holding) => ({
          holding,
          observations: [
            {
              date,
              marketPrice: prices[index],
              state: 'CLOSE' as const,
              isCarriedForward: false
            }
          ]
        })),
        maxAgeDays: 7
      });

      if (valuation.status !== 'available') {
        throw new Error(
          `Securities valuation unavailable: ${valuation.reason}`
        );
      }

      const fxObservations = {
        CHFEUR: [
          {
            date,
            marketPrice: 0.9,
            state: 'CLOSE' as const,
            isCarriedForward: false
          }
        ]
      };

      const securities = convertDailySecuritiesValues({
        date,
        valuation,
        baseCurrency: 'EUR',
        observationsByPair: fxObservations,
        maxAgeDays: 7
      });

      if (securities.status !== 'available') {
        throw new Error(
          `Securities conversion unavailable: ${securities.reason}`
        );
      }

      const projectedCash = projectDailyCashBalances({
        balances: [
          {
            date,
            value: new Big(cashBalances[index])
          }
        ],
        startDate: date,
        endDate: date
      })[0];

      const result = composeDailyNav({
        date,
        securitiesValue: securities.securitiesValue,
        cashAccounts: [
          {
            accountId: 'integration-cash',
            currency: 'CHF',
            balance: projectedCash.balance,
            included: true
          }
        ],
        baseCurrency: 'EUR',
        exchangeRates: securities.exchangeRates
      });

      if (result.status !== 'available') {
        throw new Error(`NAV unavailable: ${result.reason}`);
      }

      return result;
    });

    expect(navResults.map(({ nav }) => nav)).toEqual([
      '900',
      '882',
      '882',
      '879.3'
    ]);

    const pnlResults = navResults.slice(1).map((result, index) =>
      calculateDailyPnl({
        openingNav: navResults[index].nav,
        closingNav: result.nav,
        externalNetFlows: '0',
        movementClassification: 'complete',
        reconciliation: 'none'
      })
    );

    expect(pnlResults).toEqual([
      { status: 'available', dailyPnl: '-18' },
      { status: 'available', dailyPnl: '0' },
      { status: 'available', dailyPnl: '-2.7' }
    ]);
  });

  it('preserves NAV and daily PnL across long-to-short transitions', () => {
    const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];

    const operations = [
      { type: ActivityType.BUY, quantity: 10, price: 10 },
      { type: ActivityType.SELL, quantity: 5, price: 12 },
      { type: ActivityType.SELL, quantity: 8, price: 12 },
      { type: ActivityType.BUY, quantity: 2, price: 11 }
    ];

    const activities: PortfolioCalculatorActivity[] = operations.map(
      (operation, index) => ({
        assetProfile: {
          assetSubClass: AssetSubClass.STOCK,
          currency: 'CHF',
          dataSource: DataSource.YAHOO,
          name: 'Integration test asset',
          symbol: 'SHORT.TEST',
          userId: undefined
        },
        date: dates[index],
        fee: new Big(0),
        feeInBaseCurrency: new Big(0),
        quantity: new Big(operation.quantity),
        tags: [],
        tax: new Big(0),
        taxInBaseCurrency: new Big(0),
        type: operation.type,
        unitPrice: new Big(operation.price)
      })
    );

    const prices = [10, 12, 12, 11];
    const cashBalances = [900, 960, 1056, 1034];

    const holdingsHistory = projectDailyHoldings(activities);

    expect(holdingsHistory).toHaveLength(4);

    const navResults = dates.map((date, index) => {
      const holdings = holdingsHistory[index].holdings;

      const valuation = calculateDailySecuritiesValuation({
        date,
        items: holdings.map((holding) => ({
          holding,
          observations: [
            {
              date,
              marketPrice: prices[index],
              state: 'CLOSE' as const,
              isCarriedForward: false
            }
          ]
        })),
        maxAgeDays: 7
      });

      expect(valuation.status).toBe('available');

      const fxObservations = {
        CHFEUR: [
          {
            date,
            marketPrice: 0.9,
            state: 'CLOSE' as const,
            isCarriedForward: false
          }
        ]
      };

      const securities = convertDailySecuritiesValues({
        date,
        valuation,
        baseCurrency: 'EUR',
        observationsByPair: fxObservations,
        maxAgeDays: 7
      });

      if (securities.status !== 'available') {
        throw new Error(
          `Securities conversion unavailable: ${securities.reason}`
        );
      }

      const projectedCash = projectDailyCashBalances({
        balances: [
          {
            date,
            value: new Big(cashBalances[index])
          }
        ],
        startDate: date,
        endDate: date
      })[0];

      const result = composeDailyNav({
        date,
        securitiesValue: securities.securitiesValue,
        cashAccounts: [
          {
            accountId: 'integration-cash',
            currency: 'CHF',
            balance: projectedCash.balance,
            included: true
          }
        ],
        baseCurrency: 'EUR',
        exchangeRates: securities.exchangeRates
      });

      expect(result.status).toBe('available');

      return result;
    });

    expect(
      navResults.map((result) =>
        result.status === 'available' ? result.nav : null
      )
    ).toEqual(['900', '918', '918', '920.7']);

    const pnlResults = navResults.slice(1).map((result, index) => {
      const openingNav = navResults[index];

      expect(openingNav.status).toBe('available');
      expect(result.status).toBe('available');

      if (openingNav.status !== 'available' || result.status !== 'available') {
        throw new Error('Unexpected unavailable NAV');
      }

      return calculateDailyPnl({
        openingNav: openingNav.nav,
        closingNav: result.nav,
        externalNetFlows: '0',
        movementClassification: 'complete',
        reconciliation: 'none'
      });
    });

    expect(pnlResults).toEqual([
      { status: 'available', dailyPnl: '18' },
      { status: 'available', dailyPnl: '0' },
      { status: 'available', dailyPnl: '2.7' }
    ]);
  });
});
