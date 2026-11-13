import { performance } from 'node:perf_hooks';

import { simulateBenchmark } from './activity-matched-benchmark';
import { createBenchmarkDisplayValuations } from './benchmark-display-valuation.adapter';
import { composeBenchmarkPerformanceSeries } from './benchmark-performance-series.adapter';

const date = (day: number) =>
  new Date(Date.UTC(2000, 0, day + 1)).toISOString().slice(0, 10);

(process.env.NG_BENCHMARK_PERFORMANCE ? describe : describe.skip)(
  'NG benchmark performance series profiling',
  () => {
    it('profiles daily financial valuations with monthly contributions', () => {
      const rows = [];
      for (const count of [365, 1825, 3650]) {
        const valuationDates = Array.from({ length: count }, (_, i) => date(i));
        const prices = valuationDates.map((date) => ({
          date,
          price: String(
            100 *
              Math.pow(
                1.04,
                (Date.parse(date) - Date.parse(valuationDates[0])) /
                  86400000 /
                  365
              )
          )
        }));
        const points = simulateBenchmark({
          flows: valuationDates
            .filter((_, i) => i % 30 === 0)
            .map((date) => ({ date, amount: '100' })),
          prices,
          valuationDates
        });
        const displayValuations = createBenchmarkDisplayValuations({
          points,
          prices,
          fxQuotes: [],
          currencyFrom: 'EUR',
          currencyTo: 'EUR'
        });
        for (const method of ['TWR', 'MWR'] as const) {
          const execute = () => {
            const start = performance.now();
            const result = composeBenchmarkPerformanceSeries({
              points,
              displayValuations,
              valuationDates,
              financialCurrency: 'EUR',
              start: valuationDates[0],
              end: valuationDates[count - 1],
              method
            });
            return { elapsed: performance.now() - start, result };
          };
          execute();
          const samples = Array.from({ length: 7 }, execute);
          for (const { result } of samples) {
            expect(result.map(({ date }) => date)).toEqual(valuationDates);
            expect(result.every(({ value }) => Number.isFinite(value))).toBe(
              true
            );
            expect(result.at(-1).value).toBeCloseTo(
              (method === 'MWR'
                ? 0.04
                : Math.pow(1.04, (count - 1) / 365) - 1) * 100,
              7
            );
          }
          const sorted = samples
            .map(({ elapsed }) => elapsed)
            .sort((a, b) => a - b);
          rows.push({
            dates: count,
            method,
            median: Number(sorted[3].toFixed(2)),
            p95: Number(sorted[6].toFixed(2))
          });
        }
      }
      console.log(
        JSON.stringify({ units: 'ms', warmups: 1, repetitions: 7, rows })
      );
    });
  }
);
