import { PortfolioCalculator } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator';
import { AccumulatedValues } from '@ghostfolio/api/app/portfolio/interfaces/accumulated-values.interface';
import { HoldingPerformance } from '@ghostfolio/api/app/portfolio/interfaces/holding-performance.interface';
import { PortfolioCalculatorActivity } from '@ghostfolio/api/app/portfolio/interfaces/portfolio-calculator-activity.interface';
import { PortfolioCalculatorHolding } from '@ghostfolio/api/app/portfolio/interfaces/portfolio-calculator-holding.interface';
import { PerformancePercentages } from '@ghostfolio/api/app/portfolio/types/performance-percentages.type';
import {
  getAssetProfileIdentifier,
  parseDate
} from '@ghostfolio/common/helper';
import {
  AssetProfileIdentifier,
  HistoricalDataItem
} from '@ghostfolio/common/interfaces';
import { PortfolioSnapshot } from '@ghostfolio/common/models';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { AssetSubClass } from '@prisma/client';
import { Big } from 'big.js';
import { differenceInCalendarDays } from 'date-fns';

import { calculateXirr } from '../xirr';

interface DatedCashFlow {
  date: string;
  value: Big;
}

/**
 * Money-Weighted Rate of Return (MWR): the annualized internal rate of return
 * of the dated investor cash flows and the terminal portfolio value.
 */
export class MwrPortfolioCalculator extends PortfolioCalculator {
  declare private parsedDates: Map<string, Date> | undefined;

  private getParsedDate(date: string): Date {
    this.parsedDates ??= new Map<string, Date>();

    let parsedDate = this.parsedDates.get(date);

    if (!parsedDate) {
      parsedDate = parseDate(date);
      this.parsedDates.set(date, parsedDate);
    }

    return parsedDate;
  }

  protected calculateOverallPerformance({
    accumulatedValuesByDate,
    positions
  }: {
    accumulatedValuesByDate: { [date: string]: AccumulatedValues };
    positions: PortfolioCalculatorHolding[];
  }): PortfolioSnapshot {
    const latestAccumulatedValues = Object.values(accumulatedValuesByDate).at(
      -1
    );

    return this.getOverallPerformance({
      investedCapital:
        latestAccumulatedValues?.totalInvestmentValue ?? new Big(0),
      investedCapitalWithCurrencyEffect:
        latestAccumulatedValues?.totalInvestmentValueWithCurrencyEffect ??
        new Big(0),
      positions
    });
  }

  protected calculatePerformancePercentages({
    accumulatedValuesByDate
  }: {
    accumulatedValuesByDate: { [date: string]: AccumulatedValues };
  }): { [date: string]: PerformancePercentages } {
    const performancePercentagesByDate: {
      [date: string]: PerformancePercentages;
    } = {};

    for (const [date, accumulatedValues] of Object.entries(
      accumulatedValuesByDate
    )) {
      const netPerformanceInPercentageWithCurrencyEffect =
        this.getMoneyWeightedReturn({
          date,
          terminalValue: accumulatedValues.totalCurrentValueWithCurrencyEffect,
          withCurrencyEffect: true
        });

      const netPerformanceInPercentageWithoutDividendsWithCurrencyEffect =
        this.getMoneyWeightedReturn({
          date,
          includeDividends: false,
          terminalValue: accumulatedValues.totalCurrentValueWithCurrencyEffect,
          withCurrencyEffect: true
        });

      performancePercentagesByDate[date] = {
        dividendInPercentageWithCurrencyEffect:
          netPerformanceInPercentageWithCurrencyEffect -
          netPerformanceInPercentageWithoutDividendsWithCurrencyEffect,
        netPerformanceInPercentage: this.getMoneyWeightedReturn({
          date,
          terminalValue: accumulatedValues.totalCurrentValue,
          withCurrencyEffect: false
        }),
        netPerformanceInPercentageWithCurrencyEffect
      };
    }

    return performancePercentagesByDate;
  }

  protected calculatePerformancePercentagesForDateRange({
    historicalDataItems
  }: {
    historicalDataItems: HistoricalDataItem[];
  }): { [date: string]: PerformancePercentages } {
    const performancePercentagesByDate: {
      [date: string]: PerformancePercentages;
    } = {};

    const firstHistoricalDataItem = historicalDataItems[0];

    if (!firstHistoricalDataItem) {
      return performancePercentagesByDate;
    }

    const openingDate = firstHistoricalDataItem.date;
    const openingValue = new Big(firstHistoricalDataItem.value ?? 0);
    const openingValueWithCurrencyEffect = new Big(
      firstHistoricalDataItem.valueWithCurrencyEffect ?? 0
    );

    for (const historicalDataItem of historicalDataItems) {
      const cashFlows = [
        {
          date: openingDate,
          value: openingValue.mul(-1)
        },
        ...this.getActivityCashFlows({
          endDate: historicalDataItem.date,
          startDate: openingDate,
          withCurrencyEffect: false
        }),
        {
          date: historicalDataItem.date,
          value: new Big(historicalDataItem.value ?? 0)
        }
      ];

      const cashFlowsWithCurrencyEffect = [
        {
          date: openingDate,
          value: openingValueWithCurrencyEffect.mul(-1)
        },
        ...this.getActivityCashFlows({
          endDate: historicalDataItem.date,
          startDate: openingDate,
          withCurrencyEffect: true
        }),
        {
          date: historicalDataItem.date,
          value: new Big(historicalDataItem.valueWithCurrencyEffect ?? 0)
        }
      ];

      const cashFlowsWithoutDividendsWithCurrencyEffect = [
        {
          date: openingDate,
          value: openingValueWithCurrencyEffect.mul(-1)
        },
        ...this.getActivityCashFlows({
          endDate: historicalDataItem.date,
          includeDividends: false,
          startDate: openingDate,
          withCurrencyEffect: true
        }),
        {
          date: historicalDataItem.date,
          value: new Big(historicalDataItem.valueWithCurrencyEffect ?? 0)
        }
      ];

      const netPerformanceInPercentageWithCurrencyEffect = this.calculateXirr(
        cashFlowsWithCurrencyEffect
      );

      const netPerformanceInPercentageWithoutDividendsWithCurrencyEffect =
        this.calculateXirr(cashFlowsWithoutDividendsWithCurrencyEffect);

      performancePercentagesByDate[historicalDataItem.date] = {
        dividendInPercentageWithCurrencyEffect:
          netPerformanceInPercentageWithCurrencyEffect -
          netPerformanceInPercentageWithoutDividendsWithCurrencyEffect,
        netPerformanceInPercentage: this.calculateXirr(cashFlows),
        netPerformanceInPercentageWithCurrencyEffect
      };
    }

    return performancePercentagesByDate;
  }

  protected getHoldingPerformance({
    chartDates,
    dataSource,
    end,
    exchangeRates,
    marketSymbolMap,
    start,
    symbol
  }: {
    chartDates: string[];
    end: Date;
    exchangeRates: { [dateString: string]: number };
    marketSymbolMap: {
      [date: string]: { [assetProfileIdentifier: string]: Big };
    };
    start: Date;
  } & AssetProfileIdentifier): HoldingPerformance {
    const { holdingPerformance, valuation } =
      this.getMethodIndependentHoldingPerformance({
        chartDates,
        dataSource,
        end,
        exchangeRates,
        marketSymbolMap,
        start,
        symbol
      });

    if (!valuation) {
      return holdingPerformance;
    }

    const assetProfileIdentifier = getAssetProfileIdentifier({
      dataSource,
      symbol
    });

    const activities =
      this.activitiesByAssetProfileIdentifier[assetProfileIdentifier] ?? [];

    const endDate = chartDates.at(-1);

    if (!endDate) {
      return holdingPerformance;
    }

    const terminalValue = valuation.currentValues[endDate] ?? new Big(0);
    const terminalValueWithCurrencyEffect =
      valuation.currentValuesWithCurrencyEffect[endDate] ?? new Big(0);

    const grossPerformancePercentage = this.calculateXirr([
      ...this.getActivityCashFlows({
        activities,
        endDate,
        includeFees: false,
        withCurrencyEffect: false
      }),
      {
        date: endDate,
        value: terminalValue
      }
    ]);

    const grossPerformancePercentageWithCurrencyEffect = this.calculateXirr([
      ...this.getActivityCashFlows({
        activities,
        endDate,
        includeFees: false,
        withCurrencyEffect: true
      }),
      {
        date: endDate,
        value: terminalValueWithCurrencyEffect
      }
    ]);

    const netPerformancePercentage = this.calculateXirr([
      ...this.getActivityCashFlows({
        activities,
        endDate,
        includeFees: true,
        withCurrencyEffect: false
      }),
      {
        date: endDate,
        value: terminalValue
      }
    ]);

    const netPerformancePercentageWithCurrencyEffect = this.calculateXirr([
      ...this.getActivityCashFlows({
        activities,
        endDate,
        includeFees: true,
        withCurrencyEffect: true
      }),
      {
        date: endDate,
        value: terminalValueWithCurrencyEffect
      }
    ]);

    const netPerformancePercentageWithCurrencyEffectMap: HoldingPerformance['netPerformancePercentageWithCurrencyEffectMap'] =
      {
        ...holdingPerformance.netPerformancePercentageWithCurrencyEffectMap,
        max: new Big(netPerformancePercentageWithCurrencyEffect)
      };

    for (const {
      dateRange,
      endDateString: rangeEndDateString,
      startDateString: rangeStartDateString
    } of valuation.dateRanges) {
      if (dateRange === 'max') {
        continue;
      }

      const openingValueWithCurrencyEffect =
        valuation.currentValuesWithCurrencyEffect[rangeStartDateString] ??
        new Big(0);

      const terminalValueOfRangeWithCurrencyEffect =
        valuation.currentValuesWithCurrencyEffect[rangeEndDateString] ??
        new Big(0);

      const rangeReturnWithCurrencyEffect = this.calculateXirr([
        {
          date: rangeStartDateString,
          value: openingValueWithCurrencyEffect.mul(-1)
        },
        ...this.getActivityCashFlows({
          activities,
          endDate: rangeEndDateString,
          includeFees: true,
          startDate: rangeStartDateString,
          withCurrencyEffect: true
        }),
        {
          date: rangeEndDateString,
          value: terminalValueOfRangeWithCurrencyEffect
        }
      ]);

      netPerformancePercentageWithCurrencyEffectMap[dateRange] = new Big(
        rangeReturnWithCurrencyEffect
      );
    }

    return {
      ...holdingPerformance,
      grossPerformancePercentage: new Big(grossPerformancePercentage),
      grossPerformancePercentageWithCurrencyEffect: new Big(
        grossPerformancePercentageWithCurrencyEffect
      ),
      netPerformancePercentage: new Big(netPerformancePercentage),
      netPerformancePercentageWithCurrencyEffectMap
    };
  }

  protected getPerformanceCalculationType() {
    return PerformanceCalculationType.MWR;
  }

  private calculateXirr(cashFlows: DatedCashFlow[]): number {
    return calculateXirr(cashFlows, (date, origin) =>
      differenceInCalendarDays(
        this.getParsedDate(date),
        this.getParsedDate(origin)
      )
    ).rate;
  }

  private getActivityCashFlows({
    activities = this.activities,
    endDate,
    includeDividends = true,
    includeFees = true,
    startDate,
    withCurrencyEffect
  }: {
    activities?: PortfolioCalculatorActivity[];
    endDate: string;
    includeDividends?: boolean;
    includeFees?: boolean;
    startDate?: string;
    withCurrencyEffect: boolean;
  }): DatedCashFlow[] {
    const cashFlows: DatedCashFlow[] = [];
    const exchangeRatesByCurrency = this.getExchangeRatesByCurrency();

    for (const activity of activities) {
      const isCashInBaseCurrency =
        activity.assetProfile.assetSubClass === AssetSubClass.CASH &&
        activity.assetProfile.currency === this.getBaseCurrency() &&
        activity.assetProfile.symbol === this.getBaseCurrency();

      if (
        isCashInBaseCurrency ||
        activity.date > endDate ||
        (startDate !== undefined && activity.date <= startDate)
      ) {
        continue;
      }

      const currencyPair =
        activity.assetProfile.currency + this.getBaseCurrency();

      const exchangeRates = exchangeRatesByCurrency[currencyPair];

      const exchangeRate = withCurrencyEffect
        ? (exchangeRates?.[activity.date] ?? 1)
        : (exchangeRates?.[endDate] ?? 1);

      if (includeFees && !activity.fee.eq(0)) {
        cashFlows.push({
          date: activity.date,
          value: activity.fee.mul(exchangeRate).mul(-1)
        });
      }

      if (['BUY', 'SELL'].includes(activity.type)) {
        const transactionValue = activity.quantity
          .mul(activity.unitPrice)
          .mul(exchangeRate);

        cashFlows.push({
          date: activity.date,
          value:
            activity.type === 'BUY'
              ? transactionValue.mul(-1)
              : transactionValue
        });

        continue;
      }

      if (
        activity.type === 'INTEREST' ||
        (includeDividends && activity.type === 'DIVIDEND')
      ) {
        cashFlows.push({
          date: activity.date,
          value: activity.quantity.mul(activity.unitPrice).mul(exchangeRate)
        });
      }
    }

    return cashFlows;
  }

  private getMoneyWeightedReturn({
    date,
    includeDividends = true,
    terminalValue,
    withCurrencyEffect
  }: {
    date: string;
    includeDividends?: boolean;
    terminalValue: Big;
    withCurrencyEffect: boolean;
  }): number {
    return this.calculateXirr([
      ...this.getActivityCashFlows({
        endDate: date,
        includeDividends,
        withCurrencyEffect
      }),
      {
        date,
        value: terminalValue
      }
    ]);
  }
}
