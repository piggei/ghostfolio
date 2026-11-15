import { Big } from 'big.js';

import { simulateBenchmark } from './activity-matched-benchmark';
import { TwrBenchmarkEvaluator } from './benchmark-twr.evaluator';

describe('Incremental benchmark TWR', () => {
  it('chains closing factors, preserves liquidation gains and anchors reinvestment', () => {
    const points = simulateBenchmark({
      flows: [
        { date: '2025-01-01', amount: '100' },
        { date: '2025-01-02', kind: 'liquidate' },
        { date: '2025-01-04', amount: '100' }
      ],
      prices: ['100', '110', '90', '100', '110'].map((price, i) => ({
        date: `2025-01-0${i + 1}`,
        price
      })),
      valuationDates: []
    });
    points.forEach(Object.freeze);
    const evaluator = new TwrBenchmarkEvaluator(points[0]);
    const results = points
      .slice(1)
      .map((point) => evaluator.addFinancialPoint(point));
    expect(
      results.map(({ returnFraction }) => returnFraction.toNumber())
    ).toEqual([0.1, 0.1, 0.1, 0.21]);
    const before = JSON.stringify(evaluator);
    expect(
      evaluator
        .projectDisplayPoint('2025-01-06', new Big(121))
        .returnFraction.toNumber()
    ).toBeCloseTo(0.331, 12);
    expect(JSON.stringify(evaluator)).toBe(before);
  });

  it('preserves compound growth across 1500 daily observations and monthly contributions', () => {
    const saved = { DP: Big.DP, RM: Big.RM };
    const date = (i: number) =>
      new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10);
    const points = simulateBenchmark({
      prices: Array.from({ length: 1500 }, (_, i) => ({
        date: date(i),
        price: String(100 * Math.pow(1.04, i / 365))
      })),
      flows: Array.from({ length: 50 }, (_, i) => ({
        date: date(i * 30),
        amount: '100'
      })),
      valuationDates: []
    });
    const evaluator = new TwrBenchmarkEvaluator(points[0]);
    let result;
    for (const point of points.slice(1))
      result = evaluator.addFinancialPoint(point);
    expect(result.returnFraction.toNumber()).toBeCloseTo(
      Math.pow(1.04, 1499 / 365) - 1,
      12
    );
    expect({ DP: Big.DP, RM: Big.RM }).toEqual(saved);
  });
});
