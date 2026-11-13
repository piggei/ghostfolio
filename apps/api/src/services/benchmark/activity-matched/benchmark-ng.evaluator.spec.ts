import { Big } from 'big.js';

import {
  InvestmentProxyFlow,
  simulateBenchmark
} from './activity-matched-benchmark';
import { evaluateNgBenchmarkSeries } from './benchmark-ng-performance-series';
import {
  MwrBenchmarkEvaluator,
  TwrBenchmarkEvaluator
} from './benchmark-ng.evaluator';
import { composeBenchmarkPerformanceSeries } from './benchmark-performance-series.adapter';

const date = (days: number) =>
  new Date(Date.UTC(2025, 0, 1 + days)).toISOString().slice(0, 10);
const flow = (day: number, amount: string): InvestmentProxyFlow => ({
  date: date(day),
  amount
});
function fixture(
  values: [number, string][],
  flows: InvestmentProxyFlow[],
  dates = values.map(([day]) => day)
) {
  const points = simulateBenchmark({
    flows,
    prices: values.map(([day, price]) => ({ date: date(day), price })),
    valuationDates: dates.map(date),
    maxPriceAgeDays: 4000
  });
  const displayValuations = points
    .filter(({ displayOnly }) => displayOnly)
    .map((p) => ({
      date: p.date,
      value: p.value.toString(),
      currency: 'EUR',
      benchmarkPriceSourceDate: p.date,
      fxComponents: [],
      valuationStatus: p.units.gt(0)
        ? ('CARRIED_FORWARD' as const)
        : ('NOT_APPLICABLE' as const)
    }));
  return {
    points,
    displayValuations,
    financialCurrency: 'EUR',
    valuationDates: dates.map(date),
    start: date(dates[0]),
    end: date(dates.at(-1))
  };
}

describe('Ghostfolio-NG benchmark financial evaluators', () => {
  it.each([
    {
      name: 'initial investment',
      values: [
        [0, '100'],
        [365, '110']
      ],
      flows: [flow(0, '100')],
      mwr: 0.1,
      twr: 0.1
    },
    {
      name: 'contributions',
      values: [
        [0, '100'],
        [365, '110'],
        [730, '121']
      ],
      flows: [flow(0, '100'), flow(365, '110')],
      mwr: 0.1,
      twr: 0.21
    },
    {
      name: 'partial withdrawal',
      values: [
        [0, '100'],
        [365, '110'],
        [730, '121']
      ],
      flows: [flow(0, '100'), flow(365, '-55')],
      mwr: 0.1,
      twr: 0.21
    },
    {
      name: 'full liquidation',
      values: [
        [0, '100'],
        [365, '110'],
        [730, '121']
      ],
      flows: [flow(0, '100'), { date: date(365), kind: 'liquidate' }],
      mwr: 0.1,
      twr: 0.1
    },
    {
      name: 'reinvestment',
      values: [
        [0, '100'],
        [365, '110'],
        [730, '100'],
        [1095, '110']
      ],
      flows: [
        flow(0, '100'),
        { date: date(365), kind: 'liquidate' },
        flow(730, '100')
      ],
      mwr: 0.1,
      twr: 0.21
    },
    {
      name: 'same-day validated sell and buy',
      values: [
        [0, '100'],
        [365, '110'],
        [730, '121']
      ],
      flows: [flow(0, '100'), flow(365, '-110'), flow(365, '110')],
      mwr: 0.1,
      twr: 0.21
    },
    {
      name: 'negative return',
      values: [
        [0, '100'],
        [365, '90']
      ],
      flows: [flow(0, '100')],
      mwr: -0.1,
      twr: -0.1
    },
    {
      name: 'genuine zero return',
      values: [
        [0, '100'],
        [365, '100']
      ],
      flows: [flow(0, '100')],
      mwr: 0,
      twr: 0
    },
    {
      name: 'partial-year annualization',
      values: [
        [0, '100'],
        [182, '110']
      ],
      flows: [flow(0, '100')],
      mwr: Math.pow(1.1, 365 / 182) - 1,
      twr: 0.1
    },
    {
      name: 'legacy multiple-root selection',
      values: [
        [0, '100'],
        [365, '240'],
        [730, '155'],
        [1095, '13.2']
      ],
      flows: [
        flow(0, '100'),
        { date: date(365), kind: 'liquidate' },
        flow(730, '155')
      ],
      mwr: 0.1,
      twr: (2.4 * 13.2) / 155 - 1
    }
  ] as {
    name: string;
    values: [number, string][];
    flows: InvestmentProxyFlow[];
    mwr: number;
    twr: number;
  }[])(
    '$name has independent annualized MWR and cumulative TWR expectations',
    ({ values, flows, mwr, twr }) => {
      const input = fixture(values, flows);
      const before = JSON.stringify(input);
      input.points.forEach(Object.freeze);
      Object.freeze(input.points);
      for (const method of ['MWR', 'TWR'] as const) {
        const results = evaluateNgBenchmarkSeries({ ...input, method });
        expect(results[0]).toMatchObject({
          status: 'BASELINE',
          returnFraction: new Big(0)
        });
        expect(results.at(-1)?.status).toBe('CALCULATED');
        expect(results.at(-1)?.returnFraction.toNumber()).toBeCloseTo(
          method === 'MWR' ? mwr : twr,
          12
        );
        expect(evaluateNgBenchmarkSeries({ ...input, method })).toEqual(
          results
        );
      }
      expect(JSON.stringify(input)).toBe(before);
    }
  );

  it.each(['MWR', 'TWR'] as const)(
    'excludes baseline-date BUY and pre-range positions from %s cash flows',
    (method) => {
      const input = fixture(
        [
          [0, '100'],
          [365, '110'],
          [730, '121']
        ],
        [flow(0, '100'), flow(365, '110')],
        [365, 730]
      );
      expect(
        evaluateNgBenchmarkSeries({ ...input, method })
          .at(-1)
          ?.returnFraction.toNumber()
      ).toBeCloseTo(0.1, 12);
    }
  );

  it.each(['MWR', 'TWR'] as const)(
    'does not manufacture %s performance during an uninvested interval',
    (method) => {
      const input = fixture(
        [
          [0, '100'],
          [365, '110']
        ],
        [flow(0, '100'), { date: date(365), kind: 'liquidate' }],
        [366, 367]
      );
      expect(evaluateNgBenchmarkSeries({ ...input, method })[1]).toEqual({
        date: date(367),
        status: 'NO_APPLICABLE_INVESTMENT'
      });
    }
  );

  it.each(['MWR', 'TWR'] as const)(
    'projects consecutive display observations without changing %s financial returns',
    (method) => {
      const input = fixture(
        [
          [0, '100'],
          [5, '110'],
          [10, '121']
        ],
        [flow(0, '100'), flow(5, '110')],
        [0, 2, 3, 5, 7, 10]
      );
      input.displayValuations.forEach((valuation) => {
        valuation.value = new Big(valuation.value).mul('1.03').toString();
      });
      const dense = evaluateNgBenchmarkSeries({ ...input, method });
      const sparse = evaluateNgBenchmarkSeries({
        ...input,
        method,
        valuationDates: [date(0), date(5), date(10)]
      });
      expect(
        dense.filter(({ date: d }) => [date(0), date(5), date(10)].includes(d))
      ).toEqual(sparse);
      const baseline = input.points[0];
      const evaluator =
        method === 'MWR'
          ? new MwrBenchmarkEvaluator(baseline, 0)
          : new TwrBenchmarkEvaluator(baseline);
      const before = JSON.stringify(evaluator);
      Object.freeze(evaluator);
      evaluator.projectDisplayPoint(date(1), new Big(101), 1);
      evaluator.projectDisplayPoint(date(2), new Big(102), 2);
      expect(JSON.stringify(evaluator)).toBe(before);
    }
  );

  it('distinguishes same-day insufficient cash flows from a genuine zero MWR', () => {
    const input = fixture(
      [
        [0, '100'],
        [5, '100'],
        [10, '100']
      ],
      [flow(5, '100')],
      [0, 5, 10]
    );
    const result = evaluateNgBenchmarkSeries({ ...input, method: 'MWR' });
    expect(result[1].status).toBe('INSUFFICIENT_CASH_FLOWS');
    expect(result[2]).toMatchObject({
      status: 'CALCULATED',
      returnFraction: new Big(0)
    });
  });

  it.each(['MWR', 'TWR'] as const)(
    'rejects unavailable %s observations instead of emitting a numeric zero',
    (method) => {
      const input = fixture(
        [
          [0, '100'],
          [5, '110']
        ],
        [],
        [0, 5]
      );
      expect(() =>
        composeBenchmarkPerformanceSeries({ ...input, method })
      ).toThrow('NO_APPLICABLE_INVESTMENT');
    }
  );

  it.each(['MWR', 'TWR'] as const)(
    'keeps every %s historical endpoint equal to its independently truncated series',
    (method) => {
      const input = fixture(
        [
          [0, '100'],
          [30, '101'],
          [60, '102']
        ],
        [flow(0, '100'), flow(30, '50')],
        [0, 15, 30, 45, 60]
      );
      const full = evaluateNgBenchmarkSeries({ ...input, method });
      for (let i = 1; i < full.length; i++) {
        const end = full[i].date;
        const truncated = evaluateNgBenchmarkSeries({
          ...input,
          method,
          points: input.points.filter((p) => p.date <= end),
          valuationDates: input.valuationDates.slice(0, i + 1),
          end
        });
        expect(truncated.at(-1)).toEqual(full[i]);
      }
    }
  );

  it('rejects missing, stale and currency-incompatible display valuations', () => {
    const input = fixture(
      [
        [0, '100'],
        [5, '110']
      ],
      [flow(0, '100')],
      [0, 2, 5]
    );
    expect(() =>
      evaluateNgBenchmarkSeries({
        ...input,
        method: 'TWR',
        displayValuations: []
      })
    ).toThrow('Missing display valuation');
    expect(() =>
      evaluateNgBenchmarkSeries({
        ...input,
        method: 'TWR',
        displayValuations: input.displayValuations.map((v) => ({
          ...v,
          valuationStatus: 'STALE'
        }))
      })
    ).toThrow('Stale display valuation');
    expect(() =>
      evaluateNgBenchmarkSeries({
        ...input,
        method: 'MWR',
        financialCurrency: 'USD'
      })
    ).toThrow('Display currency mismatch');
  });
});
