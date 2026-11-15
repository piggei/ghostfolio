import {
  DailyCashClassification,
  CashClassificationInput,
  classifyCashEvents
} from '@ghostfolio/api/app/account-balance/cash-event-classifier';
import { DailyCashClassificationReader } from '@ghostfolio/api/app/account-balance/daily-cash-classification-reader.service';
import {
  DailyCashPersistedReader,
  DailyCashPersistedResult
} from '@ghostfolio/api/app/account-balance/daily-cash-persisted-reader.service';
import { ActivitiesService } from '@ghostfolio/api/services/activities/activities.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable } from '@nestjs/common';
import { DataSource, MarketData, Prisma } from '@prisma/client';
import { Big } from 'big.js';

import { adaptDailyHoldingsActivities } from './daily-holdings-activity-adapter';
import { projectDailyHoldings } from './daily-holdings-projector';
import { composeDailyNav, DailyNavResult } from './daily-nav-composer';
import { calculateDailyPnl, DailyPnlResult } from './daily-pnl-calculator';
import { convertDailySecuritiesValues } from './daily-securities-currency-converter';
import { selectDailySecuritiesHoldings } from './daily-securities-holdings';
import {
  calculateDailySecuritiesValuation,
  SecuritiesValuationItem
} from './daily-securities-valuation';
import { HistoricalCloseObservation } from './historical-close-resolver';
import { resolveHistoricalFx } from './historical-fx-resolver';
import { getHistoricalFxMarketPairs } from './historical-fx-resolver';
import type { HoldingBalancesAtDate } from './interfaces/holding-balances-at-date.interface';
import type { PortfolioCalculatorActivity } from './interfaces/portfolio-calculator-activity.interface';

export interface DailyNavRequest {
  userId: string;
  startDate: string;
  endDate: string;
  baseCurrency: string;
  maxAgeDays?: number;
}

export interface DailyNavAcquisitionSnapshot {
  userId: string;
  startDate: string;
  endDate: string;
  baselineDate: string;
  baseCurrency: string;
  maxAgeDays: number;
  activities: PortfolioCalculatorActivity[];
  holdingsHistory: HoldingBalancesAtDate[];
  classificationInput: CashClassificationInput;
  classifications: DailyCashClassification[];
  cash: DailyCashPersistedResult;
  marketData: MarketData[];
  fxPairs: string[];
  exchangeRateDataSource: DataSource;
}

export interface DailyNavPerformanceDay {
  date: string;
  nav: DailyNavResult;
  pnl: DailyPnlResult;
}

export interface DailyNavPerformanceResult {
  userId: string;
  baseCurrency: string;
  startDate: string;
  endDate: string;
  maxAgeDays: number;
  days: DailyNavPerformanceDay[];
}

const DEFAULT_MAX_AGE_DAYS = 7;

function addCivilDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function validateCivilDate(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${name} must use YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError(`${name} must be a valid calendar date`);
  }
}

@Injectable()
export class DailyNavOrchestratorService {
  public constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly classificationReader: DailyCashClassificationReader,
    private readonly dataProviderService: DataProviderService,
    private readonly marketDataService: MarketDataService,
    private readonly persistedCashReader: DailyCashPersistedReader,
    private readonly prismaService: PrismaService
  ) {}

  /**
   * Acquires all historical inputs from one PostgreSQL RepeatableRead snapshot.
   *
   * Financial calculations are deliberately performed after the transaction
   * has completed. No external data provider is called by this method.
   */
  public async acquireSnapshot({
    userId,
    startDate,
    endDate,
    baseCurrency,
    maxAgeDays = DEFAULT_MAX_AGE_DAYS
  }: DailyNavRequest): Promise<DailyNavAcquisitionSnapshot> {
    validateCivilDate(startDate, 'startDate');
    validateCivilDate(endDate, 'endDate');

    if (startDate > endDate) {
      throw new RangeError('startDate must not follow endDate');
    }

    if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) {
      throw new RangeError('maxAgeDays must be a non-negative integer');
    }

    if (!userId || !baseCurrency) {
      throw new TypeError('userId and baseCurrency are required');
    }

    const baselineDate = addCivilDays(startDate, -1);
    const marketStartDate = addCivilDays(baselineDate, -maxAgeDays);
    const marketEndDate = addCivilDays(endDate, 1);

    const snapshot = await this.prismaService.$transaction(
      async (transaction) => {
        const [activityResponse, classificationInput, cash] = await Promise.all(
          [
            this.activitiesService.getActivitiesForSecuritiesPortfolioCalculator(
              {
                userId,
                userCurrency: baseCurrency,
                transaction
              }
            ),
            this.classificationReader.read({
              userId,
              startDate,
              endDate,
              transaction
            }),
            this.persistedCashReader.read({
              userId,
              startDate: baselineDate,
              endDate,
              baseCurrency,
              transaction
            })
          ]
        );

        const rawActivities = activityResponse.activities;

        const securitiesIdentifiers = new Map<
          string,
          { dataSource: DataSource; symbol: string }
        >();

        const currencies = new Set<string>([baseCurrency]);

        for (const activity of rawActivities) {
          const { assetProfile } = activity;

          securitiesIdentifiers.set(
            `${assetProfile.dataSource}:${assetProfile.symbol}`,
            {
              dataSource: assetProfile.dataSource,
              symbol: assetProfile.symbol
            }
          );

          currencies.add(assetProfile.currency);
        }

        for (const account of cash.accounts) {
          if (account.included) {
            currencies.add(account.currency);
          }
        }

        const addCurrency = (currency: string | null | undefined) => {
          if (currency) {
            currencies.add(currency);
          }
        };

        for (const account of classificationInput.accounts) {
          addCurrency(account.currency);
          addCurrency(account.cashState?.currency);
        }

        for (const order of classificationInput.orders) {
          addCurrency(order.currency);
          addCurrency(order.symbolCurrency);
        }

        for (const event of classificationInput.events) {
          addCurrency(event.transferCounterpartyCurrency);
        }

        const exchangeRateDataSource =
          this.dataProviderService.getDataSourceForExchangeRates();

        const fxPairs = getHistoricalFxMarketPairs({
          currencies: [...currencies],
          baseCurrency
        });

        const marketIdentifiers = new Map<
          string,
          { dataSource: DataSource; symbol: string }
        >();

        for (const identifier of securitiesIdentifiers.values()) {
          marketIdentifiers.set(
            `${identifier.dataSource}:${identifier.symbol}`,
            identifier
          );
        }

        for (const symbol of fxPairs) {
          marketIdentifiers.set(`${exchangeRateDataSource}:${symbol}`, {
            dataSource: exchangeRateDataSource,
            symbol
          });
        }

        const identifiers = [...marketIdentifiers.values()];

        const marketData =
          identifiers.length > 0
            ? await this.marketDataService.getRange({
                assetProfileIdentifiers: identifiers,
                dateQuery: {
                  gte: new Date(`${marketStartDate}T00:00:00.000Z`),
                  lt: new Date(`${marketEndDate}T00:00:00.000Z`)
                },
                transaction
              })
            : [];

        return {
          rawActivities,
          classificationInput,
          cash,
          marketData,
          fxPairs,
          exchangeRateDataSource
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5000,
        timeout: 15000
      }
    );

    const { rawActivities: acquiredActivities, ...acquiredSnapshot } = snapshot;

    // CPU-only calculations run after the PostgreSQL snapshot is closed.
    const activities = adaptDailyHoldingsActivities(acquiredActivities);
    const holdingsHistory = projectDailyHoldings(activities);

    const classifications = classifyCashEvents(
      acquiredSnapshot.classificationInput
    );

    return {
      userId,
      startDate,
      endDate,
      baselineDate,
      baseCurrency,
      maxAgeDays,
      ...acquiredSnapshot,
      activities,
      holdingsHistory,
      classifications
    };
  }

  /**
   * Calculates historical daily NAV and PnL from a coherent database snapshot.
   * The preceding civil day is used internally as the opening NAV baseline.
   */
  public async calculateDailyPerformance(
    request: DailyNavRequest
  ): Promise<DailyNavPerformanceResult> {
    const snapshot = await this.acquireSnapshot(request);

    const {
      startDate,
      endDate,
      baselineDate,
      baseCurrency,
      maxAgeDays,
      holdingsHistory,
      cash,
      classifications,
      marketData,
      fxPairs,
      exchangeRateDataSource
    } = snapshot;

    const fxIdentifierKeys = new Set(
      fxPairs.map((symbol) => `${exchangeRateDataSource}:${symbol}`)
    );

    const observationsByPair: Record<string, HistoricalCloseObservation[]> = {};

    const securitiesObservations = new Map<
      string,
      HistoricalCloseObservation[]
    >();

    for (const item of marketData) {
      const observation: HistoricalCloseObservation = {
        date: item.date.toISOString().slice(0, 10),
        marketPrice: item.marketPrice,
        state: item.state,
        isCarriedForward: item.isCarriedForward
      };

      const key = `${item.dataSource}:${item.symbol}`;

      if (fxIdentifierKeys.has(key)) {
        (observationsByPair[item.symbol] ??= []).push(observation);
      } else {
        const observations = securitiesObservations.get(key) ?? [];
        observations.push(observation);
        securitiesObservations.set(key, observations);
      }
    }

    const cashAccounts = cash.accounts
      .filter(({ included }) => included)
      .map((account) => ({
        accountId: account.accountId,
        currency: account.currency,
        included: true,
        balances: new Map(
          account.balances.map((balance) => [balance.date, balance])
        )
      }));

    const classificationByDate = new Map(
      classifications.map((classification) => [
        classification.date,
        classification
      ])
    );

    const allDates: string[] = [];

    for (
      let date = baselineDate;
      date <= endDate;
      date = addCivilDays(date, 1)
    ) {
      allDates.push(date);
    }

    const calculateNav = (date: string): DailyNavResult => {
      const selected = selectDailySecuritiesHoldings({
        date,
        history: holdingsHistory
      });

      // No activity before the first snapshot means no historical
      // securities position. This is different from a missing close.
      const holdings =
        selected.status === 'available'
          ? selected.holdings
          : holdingsHistory.some((item) => item.date <= date)
            ? null
            : [];

      const valuationItems: SecuritiesValuationItem[] =
        holdings?.map((holding) => ({
          holding,
          observations:
            securitiesObservations.get(
              `${holding.dataSource}:${holding.symbol}`
            ) ?? []
        })) ?? [];

      const valuation =
        holdings === null
          ? {
              date,
              status: 'unavailable' as const,
              reason: 'missing_price' as const,
              dataSource: 'MANUAL' as DataSource,
              symbol: '',
              currency: baseCurrency,
              valuesByCurrency: null
            }
          : calculateDailySecuritiesValuation({
              date,
              items: valuationItems,
              maxAgeDays
            });

      const conversion = convertDailySecuritiesValues({
        date,
        valuation,
        baseCurrency,
        observationsByPair,
        maxAgeDays
      });

      const cashBalances = cashAccounts.map((account) => {
        const balance = account.balances.get(date);

        return {
          accountId: account.accountId,
          currency: account.currency,
          included: true,
          balance: balance?.status === 'available' ? balance.balance : null
        };
      });

      const exchangeRates: Record<string, string | null> = {};

      for (const account of cashAccounts) {
        if (account.currency === baseCurrency) {
          exchangeRates[account.currency] = '1';
          continue;
        }

        if (exchangeRates[account.currency] !== undefined) {
          continue;
        }

        const resolved = resolveHistoricalFx({
          date,
          fromCurrency: account.currency,
          toCurrency: baseCurrency,
          maxAgeDays,
          observationsByPair
        });

        exchangeRates[account.currency] =
          resolved.status === 'available' ? resolved.factor : null;
      }

      const nav = composeDailyNav({
        date,
        securitiesValue:
          conversion.status === 'available' ? conversion.securitiesValue : null,
        cashAccounts: cashBalances,
        baseCurrency,
        exchangeRates
      });

      return nav;
    };

    let previousNav = calculateNav(baselineDate);

    const days: DailyNavPerformanceDay[] = [];

    for (const date of allDates.slice(1)) {
      const nav = calculateNav(date);
      const classification = classificationByDate.get(date);

      let externalNetFlows: string | null = null;

      if (classification?.externalFlows !== null && classification) {
        try {
          const totalsByCurrency = new Map<string, Big>();

          for (const flow of classification.externalFlows) {
            const amount = new Big(flow.amount);

            totalsByCurrency.set(
              flow.currency,
              (totalsByCurrency.get(flow.currency) ?? new Big(0)).plus(amount)
            );
          }

          let total = new Big(0);

          for (const [currency, amount] of totalsByCurrency) {
            if (amount.eq(0)) {
              continue;
            }

            if (currency === baseCurrency) {
              total = total.plus(amount);
              continue;
            }

            const resolved = resolveHistoricalFx({
              date,
              fromCurrency: currency,
              toCurrency: baseCurrency,
              maxAgeDays,
              observationsByPair
            });

            if (resolved.status === 'unavailable') {
              throw new Error('Missing historical FX for external flow');
            }

            total = total.plus(amount.times(new Big(resolved.factor)));
          }

          externalNetFlows = total.toFixed();
        } catch {
          externalNetFlows = null;
        }
      }

      const pnl = calculateDailyPnl({
        openingNav: previousNav.status === 'available' ? previousNav.nav : null,
        closingNav: nav.status === 'available' ? nav.nav : null,
        externalNetFlows,
        movementClassification:
          classification?.classification === 'complete' &&
          classification.coverage === 'verified'
            ? 'complete'
            : 'unclassified',
        reconciliation: classification?.reconciliation ?? 'unresolved'
      });

      days.push({ date, nav, pnl });
      previousNav = nav;
    }

    return {
      userId: snapshot.userId,
      baseCurrency,
      startDate,
      endDate,
      maxAgeDays,
      days
    };
  }
}
