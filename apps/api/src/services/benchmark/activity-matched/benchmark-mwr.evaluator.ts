import {
  calculatePreparedXirr,
  XirrFlow
} from '@ghostfolio/api/app/portfolio/calculator/xirr';

import { Big } from 'big.js';

import { FinancialPoint } from './activity-matched-benchmark';
import { NgBenchmarkObservation } from './benchmark-ng.types';

/** Investor signs are the inverse of the synthetic contribution convention.
 * Store each dated proxy once; terminal valuations never enter permanent state.
 * Multiple roots retain the legacy root selected from Newton's zero guess.
 */
export class MwrBenchmarkEvaluator {
  private readonly flows: XirrFlow[] = [];
  private previous: FinancialPoint;

  public constructor(point: FinancialPoint, day: number, value = point.value) {
    this.previous = point;
    if (value.gt(0)) this.flows.push({ day, value: value.neg() });
  }

  public addFinancialPoint(
    point: FinancialPoint,
    day: number
  ): NgBenchmarkObservation {
    const value = point.withdrawals
      .minus(this.previous.withdrawals)
      .minus(point.contributions.minus(this.previous.contributions));
    if (!value.eq(0)) this.flows.push({ day, value });
    this.previous = point;
    return this.projectDisplayPoint(point.date, point.value, day);
  }

  public projectDisplayPoint(
    date: string,
    value: Big,
    day: number
  ): NgBenchmarkObservation {
    if (value.lt(0)) return { date, status: 'UNDEFINED' };
    if (this.flows.length === 0 && value.eq(0))
      return { date, status: 'NO_APPLICABLE_INVESTMENT' };
    const result = calculatePreparedXirr(this.flows, { day, value });
    if (result.status !== 'CALCULATED' || !Number.isFinite(result.rate))
      return {
        date,
        status: result.status === 'CALCULATED' ? 'UNDEFINED' : result.status
      };
    return { date, status: 'CALCULATED', returnFraction: new Big(result.rate) };
  }
}
