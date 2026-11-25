import { classifyCashEvents } from '@ghostfolio/api/app/account-balance/cash-event-classifier';
import type { CashClassificationInput } from '@ghostfolio/api/app/account-balance/cash-event-classifier';
import type { DailyCashPersistedResult } from '@ghostfolio/api/app/account-balance/daily-cash-persisted-reader.service';
import { projectDailyManagedCash } from '@ghostfolio/api/app/account-balance/daily-managed-cash-projection';
import type { HoldingBalance } from '@ghostfolio/api/app/portfolio/interfaces/holding-balance.interface';

import { AssetSubClass, DataSource, MarketDataState } from '@prisma/client';
import { Big } from 'big.js';

import type { DailyNavAcquisitionSnapshot } from './daily-nav-orchestrator.service';
import { DailyNavOrchestratorService } from './daily-nav-orchestrator.service';

describe('DailyNavOrchestratorService financial calculations', () => {
  const baselineDate = '2026-10-01';
  const startDate = '2026-10-02';
  const endDate = '2026-10-02';

  const holding: HoldingBalance = {
    activitiesCount: 1,
    assetSubClass: AssetSubClass.STOCK,
    averagePrice: new Big(100),
    currency: 'EUR',
    dataSource: DataSource.YAHOO,
    dateOfFirstActivity: baselineDate,
    fee: new Big(0),
    feeInBaseCurrency: new Big(0),
    includeInHoldings: true,
    investment: new Big(1000),
    quantity: new Big(10),
    skipErrors: false,
    symbol: 'AAA',
    tax: new Big(0),
    taxInBaseCurrency: new Big(0),
    tags: []
  };

  function close(date: string, marketPrice: number) {
    return {
      id: `price-${date}`,
      createdAt: new Date(`${date}T12:00:00.000Z`),
      date: new Date(`${date}T00:00:00.000Z`),
      dataSource: DataSource.YAHOO,
      symbol: 'AAA',
      marketPrice,
      state: MarketDataState.CLOSE,
      isCarriedForward: false
    };
  }

  function createSnapshot({
    marketData,
    baselineCash = '2000',
    closingCash = '2500',
    externalFlows = [{ currency: 'EUR', amount: '500' }]
  }: {
    marketData: ReturnType<typeof close>[];
    baselineCash?: string;
    closingCash?: string;
    externalFlows?: { currency: string; amount: string }[];
  }): DailyNavAcquisitionSnapshot {
    const cash: DailyCashPersistedResult = {
      userId: 'user-id',
      startDate: baselineDate,
      endDate,
      accounts: [
        {
          accountId: 'account-eur',
          currency: 'EUR',
          source: 'managed',
          included: true,
          revision: 1,
          balances: [
            {
              date: baselineDate,
              status: 'available',
              balance: baselineCash
            },
            {
              date: startDate,
              status: 'available',
              balance: closingCash
            }
          ]
        }
      ]
    };

    const classificationInput = {
      userId: 'user-id',
      startDate,
      endDate,
      accounts: [],
      orders: [],
      events: []
    } as CashClassificationInput;

    return {
      userId: 'user-id',
      startDate,
      endDate,
      baselineDate,
      baseCurrency: 'EUR',
      maxAgeDays: 7,
      activities: [],
      holdingsHistory: [
        {
          date: baselineDate,
          holdings: [holding]
        }
      ],
      classificationInput,
      classifications: [
        {
          date: startDate,
          externalFlows,
          classification: 'complete',
          coverage: 'verified',
          reconciliation: 'none',
          items: []
        }
      ],
      cash,
      marketData: marketData as never,
      fxPairs: [],
      exchangeRateDataSource: DataSource.YAHOO
    };
  }

  function createService(snapshot: DailyNavAcquisitionSnapshot) {
    const service = new DailyNavOrchestratorService(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never
    );

    jest.spyOn(service, 'acquireSnapshot').mockResolvedValue(snapshot);

    return service;
  }

  it.each([
    [false, 'EUR'],
    [false, 'USD'],
    [true, 'EUR']
  ] as const)(
    'retains PnL when adding an automatic account (deposit: %s, currency: %s)',
    async (withDeposit, currency) => {
      const snapshot = createSnapshot({
        marketData: [close(baselineDate, 100), close(startDate, 110)],
        baselineCash: '2000',
        closingCash: '2000',
        externalFlows: []
      });
      const request = {
        userId: 'user-id',
        startDate,
        endDate,
        baseCurrency: 'EUR'
      };
      const original =
        await createService(snapshot).calculateDailyPerformance(request);
      const projection = projectDailyManagedCash({
        snapshot: {
          accountId: 'new-account',
          currency,
          includeCashInPortfolio: true,
          isAutomaticOpening: true,
          revision: 1,
          openingBalance: { date: '0001-01-01', sequence: 0, balance: '0' },
          events: withDeposit
            ? [
                {
                  date: startDate,
                  sequence: 1,
                  type: 'MOVEMENT',
                  amount: '200'
                }
              ]
            : []
        },
        startDate: baselineDate,
        endDate
      });
      snapshot.cash.accounts.push({
        accountId: 'new-account',
        currency,
        source: 'managed',
        included: projection.included,
        revision: 1,
        balances: projection.balances
      });
      snapshot.classifications = classifyCashEvents({
        userId: 'user-id',
        startDate,
        endDate,
        accounts: [
          {
            id: 'new-account',
            userId: 'user-id',
            currency,
            excluded: false,
            cashState: {
              currency,
              openingDate: '0001-01-01',
              openingBalance: '0',
              revision: 1,
              includeCashInPortfolio: true
            }
          }
        ],
        orders: [],
        events: withDeposit
          ? [
              {
                id: 'deposit',
                userId: 'user-id',
                accountId: 'new-account',
                date: startDate,
                sequence: 1,
                type: 'MOVEMENT',
                value: '200',
                fee: '0',
                economicClassification: 'EXTERNAL_CAPITAL',
                orderId: null,
                transferId: null,
                transferCounterpartyAccountId: null,
                transferCounterpartyMode: null,
                transferCounterpartyAmount: null,
                transferCounterpartyCurrency: null
              }
            ]
          : []
      });
      const result =
        await createService(snapshot).calculateDailyPerformance(request);
      expect(original.days[0].pnl).toEqual({
        status: 'available',
        dailyPnl: '100'
      });
      expect(result.days[0].pnl).toEqual(original.days[0].pnl);
      expect(result.days[0].nav).toEqual({
        date: startDate,
        status: 'available',
        nav: withDeposit ? '3300' : '3100'
      });
    }
  );

  it('calculates NAV and PnL correctly when an external deposit increases cash', async () => {
    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(startDate, 110)]
    });

    const service = createService(snapshot);

    const result = await service.calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days).toHaveLength(1);

    expect(result.days[0]).toMatchObject({
      date: startDate,
      nav: {
        date: startDate,
        status: 'available',
        nav: '3600'
      },
      pnl: {
        status: 'available',
        dailyPnl: '100'
      }
    });

    // The baseline is internal and is not returned as a calendar day.
    expect(result.days[0].date).not.toBe(baselineDate);
  });

  it('does not use a future closing price to value the opening NAV', async () => {
    const snapshot = createSnapshot({
      marketData: [close(startDate, 110)],
      baselineCash: '2000',
      closingCash: '2000',
      externalFlows: []
    });

    const service = createService(snapshot);

    const result = await service.calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days[0].nav).toMatchObject({
      status: 'available',
      nav: '3100'
    });

    expect(result.days[0].pnl).toEqual({
      status: 'unavailable',
      dailyPnl: null,
      reason: 'missing_valuation'
    });
  });

  it('does not calculate PnL when the external flow classification is unavailable', async () => {
    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(startDate, 100)],
      baselineCash: '2000',
      closingCash: '2000',
      externalFlows: null
    });

    snapshot.classifications[0].classification = 'unclassified';

    const service = createService(snapshot);

    const result = await service.calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days[0].nav).toMatchObject({
      status: 'available',
      nav: '3000'
    });

    expect(result.days[0].pnl).toEqual({
      status: 'unavailable',
      dailyPnl: null,
      reason: 'unclassified_movements'
    });
  });

  it('does not calculate PnL when historical FX for external flows is missing', async () => {
    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(startDate, 100)],
      baselineCash: '1000',
      closingCash: '1100',
      externalFlows: [{ currency: 'USD', amount: '100' }]
    });

    snapshot.fxPairs = ['USDEUR'];

    const result = await createService(snapshot).calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days[0].nav).toMatchObject({
      status: 'available',
      nav: '2100'
    });

    expect(result.days[0].pnl).toEqual({
      status: 'unavailable',
      dailyPnl: null,
      reason: 'missing_external_flows'
    });
  });

  it('does not calculate PnL when cash classification coverage is unavailable', async () => {
    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(startDate, 100)],
      baselineCash: '2000',
      closingCash: '2000',
      externalFlows: []
    });

    snapshot.classifications[0].coverage = 'unavailable';

    const result = await createService(snapshot).calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days[0].nav).toMatchObject({
      status: 'available',
      nav: '3000'
    });

    expect(result.days[0].pnl).toEqual({
      status: 'unavailable',
      dailyPnl: null,
      reason: 'unclassified_movements'
    });
  });

  it('does not calculate PnL when cash reconciliation is unresolved', async () => {
    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(startDate, 100)],
      baselineCash: '2000',
      closingCash: '2000',
      externalFlows: []
    });

    snapshot.classifications[0].reconciliation = 'unresolved';

    const result = await createService(snapshot).calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days[0].nav).toMatchObject({
      status: 'available',
      nav: '3000'
    });

    expect(result.days[0].pnl).toEqual({
      status: 'unavailable',
      dailyPnl: null,
      reason: 'unresolved_reconciliation'
    });
  });

  it('converts USD cash and external deposits using the historical FX rate', async () => {
    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(startDate, 110)],
      baselineCash: '1000',
      closingCash: '1100',
      externalFlows: [{ currency: 'USD', amount: '100' }]
    });

    snapshot.cash.accounts[0].currency = 'USD';
    snapshot.fxPairs = ['USDEUR'];

    snapshot.marketData.push(
      ...([
        {
          id: 'fx-baseline',
          createdAt: new Date(`${baselineDate}T12:00:00.000Z`),
          date: new Date(`${baselineDate}T00:00:00.000Z`),
          dataSource: DataSource.YAHOO,
          symbol: 'USDEUR',
          marketPrice: 0.9,
          state: MarketDataState.CLOSE,
          isCarriedForward: false
        },
        {
          id: 'fx-closing',
          createdAt: new Date(`${startDate}T12:00:00.000Z`),
          date: new Date(`${startDate}T00:00:00.000Z`),
          dataSource: DataSource.YAHOO,
          symbol: 'USDEUR',
          marketPrice: 0.9,
          state: MarketDataState.CLOSE,
          isCarriedForward: false
        }
      ] as never[])
    );

    const service = createService(snapshot);

    const result = await service.calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days[0]).toMatchObject({
      date: startDate,
      nav: {
        status: 'available',
        nav: '2090'
      },
      pnl: {
        status: 'available',
        dailyPnl: '100'
      }
    });
  });

  it('does not generate PnL from transfers between included cash accounts', async () => {
    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(startDate, 100)],
      baselineCash: '1000',
      closingCash: '500',
      externalFlows: []
    });

    snapshot.cash.accounts.push({
      accountId: 'account-eur-counterpart',
      currency: 'EUR',
      source: 'managed',
      included: true,
      revision: 1,
      balances: [
        {
          date: baselineDate,
          status: 'available',
          balance: '1000'
        },
        {
          date: startDate,
          status: 'available',
          balance: '1500'
        }
      ]
    });

    const service = createService(snapshot);

    const result = await service.calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days[0]).toMatchObject({
      date: startDate,
      nav: {
        status: 'available',
        nav: '3000'
      },
      pnl: {
        status: 'available',
        dailyPnl: '0'
      }
    });
  });

  it('recognizes currency movements as PnL without external cash flows', async () => {
    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(startDate, 100)],
      baselineCash: '1000',
      closingCash: '1000',
      externalFlows: []
    });

    snapshot.cash.accounts[0].currency = 'USD';
    snapshot.fxPairs = ['USDEUR'];

    snapshot.marketData.push(
      {
        id: 'fx-baseline',
        createdAt: new Date(`${baselineDate}T12:00:00.000Z`),
        date: new Date(`${baselineDate}T00:00:00.000Z`),
        dataSource: DataSource.YAHOO,
        symbol: 'USDEUR',
        marketPrice: 0.9,
        state: MarketDataState.CLOSE,
        isCarriedForward: false
      },
      {
        id: 'fx-closing',
        createdAt: new Date(`${startDate}T12:00:00.000Z`),
        date: new Date(`${startDate}T00:00:00.000Z`),
        dataSource: DataSource.YAHOO,
        symbol: 'USDEUR',
        marketPrice: 0.8,
        state: MarketDataState.CLOSE,
        isCarriedForward: false
      }
    );

    const result = await createService(snapshot).calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days[0]).toMatchObject({
      nav: {
        status: 'available',
        nav: '1800'
      },
      pnl: {
        status: 'available',
        dailyPnl: '-100'
      }
    });
  });

  it('marks NAV unavailable when an included cash balance is unavailable', async () => {
    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(startDate, 100)],
      baselineCash: '2000',
      closingCash: '2000',
      externalFlows: []
    });

    snapshot.cash.accounts[0].balances[1] = {
      date: startDate,
      status: 'unavailable',
      balance: null,
      reason: 'no_opening_balance'
    };

    const result = await createService(snapshot).calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate,
      baseCurrency: 'EUR'
    });

    expect(result.days[0].nav).toEqual({
      date: startDate,
      status: 'unavailable',
      nav: null,
      reason: 'missing_cash_balance'
    });

    expect(result.days[0].pnl).toEqual({
      status: 'unavailable',
      dailyPnl: null,
      reason: 'missing_valuation'
    });
  });

  it('does not calculate PnL after an unavailable intermediate NAV', async () => {
    const secondDate = '2026-10-03';

    const snapshot = createSnapshot({
      marketData: [close(baselineDate, 100), close(secondDate, 100)],
      baselineCash: '2000',
      closingCash: '2000',
      externalFlows: []
    });

    snapshot.maxAgeDays = 0;
    snapshot.endDate = secondDate;
    snapshot.cash.endDate = secondDate;

    snapshot.cash.accounts[0].balances.push({
      date: secondDate,
      status: 'available',
      balance: '2000'
    });

    snapshot.classifications.push({
      date: secondDate,
      externalFlows: [],
      classification: 'complete',
      coverage: 'verified',
      reconciliation: 'none',
      items: []
    });

    const result = await createService(snapshot).calculateDailyPerformance({
      userId: 'user-id',
      startDate,
      endDate: secondDate,
      baseCurrency: 'EUR',
      maxAgeDays: 0
    });

    expect(result.days).toHaveLength(2);

    expect(result.days[0].nav).toMatchObject({
      status: 'unavailable',
      reason: 'missing_securities_valuation'
    });

    expect(result.days[0].pnl).toMatchObject({
      status: 'unavailable',
      reason: 'missing_valuation'
    });

    expect(result.days[1].nav).toMatchObject({
      status: 'available',
      nav: '3000'
    });

    expect(result.days[1].pnl).toEqual({
      status: 'unavailable',
      dailyPnl: null,
      reason: 'missing_valuation'
    });
  });
});
