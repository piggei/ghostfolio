import { Big } from 'big.js';

import { FinancialPoint } from './activity-matched-benchmark';
import { NgBenchmarkObservation } from './benchmark-ng.types';

/** Daily closing convention: no intraday valuations or actual cash-ledger flows.
 * The caller supplies validated, chronologically ordered financial observations.
 */
export class TwrBenchmarkEvaluator {
  private previous: FinancialPoint;
  private previousValue: Big;
  private factor = new Big(1);
  private invested: boolean;
  private undefinedReturn = false;

  public constructor(point: FinancialPoint, value = point.value) {
    this.previous = point;
    this.previousValue = value;
    this.invested = value.gt(0);
  }

  public addFinancialPoint(point: FinancialPoint): NgBenchmarkObservation {
    const flow = point.contributions
      .minus(this.previous.contributions)
      .minus(point.withdrawals.minus(this.previous.withdrawals));
    if (this.previousValue.gt(0)) {
      const factor = point.value.minus(flow).div(this.previousValue);
      if (factor.lt(0)) this.undefinedReturn = true;
      // Bound significant digits to keep chaining cost independent of history.
      // Forty digits exceed the default division and numeric API precision;
      // this applies only to the new benchmark, never portfolio calculations.
      this.factor = this.factor.mul(factor).prec(40, Big.roundHalfEven);
    }
    this.invested ||= point.value.gt(0);
    this.previous = point;
    this.previousValue = point.value;
    return this.observation(point.date, this.factor);
  }

  public projectDisplayPoint(date: string, value: Big): NgBenchmarkObservation {
    const projected = this.previousValue.gt(0)
      ? this.factor.mul(value.div(this.previousValue))
      : this.factor;
    return this.observation(date, projected);
  }

  private observation(date: string, factor: Big): NgBenchmarkObservation {
    if (this.undefinedReturn) return { date, status: 'UNDEFINED' };
    if (!this.invested) return { date, status: 'NO_APPLICABLE_INVESTMENT' };
    return { date, status: 'CALCULATED', returnFraction: factor.minus(1) };
  }
}
