import { Big } from 'big.js';

import { FinancialPoint } from './activity-matched-benchmark';
import { BenchmarkDisplayValuation } from './benchmark-display-valuation.adapter';
import {
  MwrBenchmarkEvaluator,
  NgBenchmarkMethod,
  NgBenchmarkObservation,
  TwrBenchmarkEvaluator
} from './benchmark-ng.evaluator';

function day(date: string): number {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== date
  )
    throw new Error(`Invalid benchmark date: ${date}`);
  return time / 86400000;
}

/** One merge over canonical financial points and requested observations. */
export function evaluateNgBenchmarkSeries({
  points,
  financialCurrency,
  displayValuations,
  valuationDates,
  start,
  end,
  method
}: {
  points: FinancialPoint[];
  financialCurrency: string;
  displayValuations: BenchmarkDisplayValuation[];
  valuationDates: string[];
  start: string;
  end: string;
  method: NgBenchmarkMethod;
}): NgBenchmarkObservation[] {
  if (day(start) > day(end)) throw new Error('Reversed benchmark range');
  if (!financialCurrency) throw new Error('Missing financial currency');
  const dates = [...new Set(valuationDates)]
    .filter((date) => {
      day(date);
      return date >= start && date <= end;
    })
    .sort();
  if (dates.length === 0) return [];
  const displays = new Map<string, BenchmarkDisplayValuation>();
  for (const display of displayValuations) {
    if (displays.has(display.date))
      throw new Error(`Duplicate display valuation: ${display.date}`);
    displays.set(display.date, display);
  }
  const result: NgBenchmarkObservation[] = [];
  let next = 0;
  let previous: FinancialPoint | undefined;
  let evaluator: MwrBenchmarkEvaluator | TwrBenchmarkEvaluator | undefined;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const currentDay = day(point.date);
    if (i && point.date <= points[i - 1].date)
      throw new Error('Points must be strictly ordered');
    if (dates[next] && dates[next] < point.date)
      throw new Error(`Missing benchmark point: ${dates[next]}`);
    const requested = dates[next] === point.date;
    if (point.date < dates[0] || point.date > dates.at(-1)) {
      if (!point.displayOnly) previous = point;
      continue;
    }
    if (point.displayOnly && !requested) continue;
    let value = point.value;
    if (point.displayOnly) {
      const display = displays.get(point.date);
      if (!display) throw new Error(`Missing display valuation: ${point.date}`);
      if (display.currency !== financialCurrency)
        throw new Error(`Display currency mismatch: ${point.date}`);
      if (display.valuationStatus === 'STALE')
        throw new Error(`Stale display valuation: ${point.date}`);
      try {
        value = new Big(display.value);
      } catch {
        throw new Error(`Invalid display value: ${point.date}`);
      }
      if (value.lt(0)) throw new Error(`Invalid display value: ${point.date}`);
      if (!previous && point.units.gt(0))
        throw new Error(`Missing financial baseline: ${point.date}`);
    } else if (point.valuationStatus === 'STALE')
      throw new Error(`Stale benchmark valuation: ${point.date}`);
    let observation: NgBenchmarkObservation;
    if (!evaluator) {
      const baseline = point.displayOnly ? (previous ?? point) : point;
      evaluator =
        method === 'MWR'
          ? new MwrBenchmarkEvaluator(baseline, currentDay, value)
          : new TwrBenchmarkEvaluator(baseline, value);
      observation = {
        date: point.date,
        status: 'BASELINE',
        returnFraction: new Big(0)
      };
    } else {
      observation = point.displayOnly
        ? evaluator.projectDisplayPoint(point.date, value, currentDay)
        : evaluator.addFinancialPoint(point, currentDay);
    }
    if (requested) {
      result.push(observation);
      next++;
    }
    if (!point.displayOnly) previous = point;
  }
  if (next < dates.length)
    throw new Error(`Missing benchmark point: ${dates[next]}`);
  return result;
}
