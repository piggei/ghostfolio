import { parseDate } from '@ghostfolio/common/helper';

import { Big } from 'big.js';
import { differenceInCalendarDays } from 'date-fns';

import { calculateXirr } from './xirr';

// Frozen numerical oracle from 6ca7cd8ac. Keep independent of the extracted solver.
function legacyXirr(cashFlows: { date: string; value: Big }[]): number {
  const getParsedDate = parseDate;
  const cashFlowsByDate = new Map<string, Big>();

  for (const { date, value } of cashFlows) {
    cashFlowsByDate.set(
      date,
      (cashFlowsByDate.get(date) ?? new Big(0)).plus(value)
    );
  }

  const aggregatedCashFlows = Array.from(cashFlowsByDate.entries())
    .map(([date, value]) => ({ date, value }))
    .filter(({ value }) => !value.eq(0))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (aggregatedCashFlows.length < 2) {
    return 0;
  }

  if (
    !aggregatedCashFlows.some(({ value }) => value.lt(0)) ||
    !aggregatedCashFlows.some(({ value }) => value.gt(0))
  ) {
    return 0;
  }

  const firstDate = getParsedDate(aggregatedCashFlows[0].date);
  const lastDate = getParsedDate(aggregatedCashFlows.at(-1).date);

  if (differenceInCalendarDays(lastDate, firstDate) === 0) {
    return 0;
  }

  const scale = aggregatedCashFlows.reduce((maximum, { value }) => {
    return value.abs().gt(maximum) ? value.abs() : maximum;
  }, new Big(0));

  if (scale.eq(0)) {
    return 0;
  }

  const normalizedCashFlows = aggregatedCashFlows.map(({ date, value }) => ({
    exponent: differenceInCalendarDays(getParsedDate(date), firstDate) / 365,
    value: value.div(scale).toNumber()
  }));

  const calculateXnpv = (rate: number) => {
    if (rate <= -1) {
      return Number.POSITIVE_INFINITY;
    }

    return normalizedCashFlows.reduce((xnpv, cashFlow) => {
      return xnpv + cashFlow.value / Math.pow(1 + rate, cashFlow.exponent);
    }, 0);
  };

  // Start Newton's method at zero. In common multiple-IRR cases this
  // deterministically favors the root reached from that initial estimate.
  let newtonRate = 0;

  for (let iteration = 0; iteration < 50; iteration += 1) {
    const xnpv = calculateXnpv(newtonRate);

    if (Math.abs(xnpv) < 1e-14) {
      return newtonRate;
    }

    const derivative = normalizedCashFlows.reduce((value, cashFlow) => {
      const exponent = cashFlow.exponent;

      if (exponent === 0) {
        return value;
      }

      return (
        value -
        (exponent * cashFlow.value) / Math.pow(1 + newtonRate, exponent + 1)
      );
    }, 0);

    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-14) {
      break;
    }

    const nextRate = newtonRate - xnpv / derivative;

    if (!Number.isFinite(nextRate) || nextRate <= -1) {
      break;
    }

    if (Math.abs(nextRate - newtonRate) < 1e-14) {
      return nextRate;
    }

    newtonRate = nextRate;
  }

  let lowerRate = -0.999999999;
  let upperRate = 1;

  let lowerValue = calculateXnpv(lowerRate);
  let upperValue = calculateXnpv(upperRate);

  if (Math.abs(lowerValue) < 1e-14) {
    return lowerRate;
  }

  if (Math.abs(upperValue) < 1e-14) {
    return upperRate;
  }

  while (
    Math.sign(lowerValue) === Math.sign(upperValue) &&
    upperRate < 1_000_000
  ) {
    upperRate = upperRate * 2 + 1;
    upperValue = calculateXnpv(upperRate);
  }

  if (
    !Number.isFinite(lowerValue) ||
    !Number.isFinite(upperValue) ||
    Math.sign(lowerValue) === Math.sign(upperValue)
  ) {
    return 0;
  }

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middleRate = (lowerRate + upperRate) / 2;
    const middleValue = calculateXnpv(middleRate);

    if (Math.abs(middleValue) < 1e-14) {
      return middleRate;
    }

    if (Math.sign(lowerValue) === Math.sign(middleValue)) {
      lowerRate = middleRate;
      lowerValue = middleValue;
    } else {
      upperRate = middleRate;
      upperValue = middleValue;
    }

    if (Math.abs(upperRate - lowerRate) < 1e-14) {
      return (lowerRate + upperRate) / 2;
    }
  }

  return (lowerRate + upperRate) / 2;
}

describe('Legacy XIRR exact numerical compatibility', () => {
  const date = (days: number) =>
    new Date(Date.UTC(2025, 0, 1 + days)).toISOString().slice(0, 10);
  const fixtures = [
    [],
    [-100],
    [-100, 110],
    [-100, 90],
    [-100, 0],
    [-100, 100],
    [-100, 230, -132],
    [-100, 50, -100],
    [-100, 240, -155, 13.2],
    [-100, 110, -100, 110]
  ];
  it.each([2, 20, 40])(
    'preserves exact IEEE results at Big.DP=%i',
    (precision) => {
      const saved = { DP: Big.DP, RM: Big.RM };
      try {
        Big.DP = precision;
        for (const rounding of [0, 1, 2, 3] as const) {
          Big.RM = rounding;
          for (const values of fixtures) {
            const flows = values.map((value, i) => ({
              date: date(i * 365),
              value: new Big(value)
            }));
            expect(calculateXirr(flows).rate).toBe(legacyXirr(flows));
            expect(calculateXirr([...flows].reverse()).rate).toBe(
              legacyXirr([...flows].reverse())
            );
          }
          for (let i = 1; i <= 50; i++) {
            const flows = [
              { date: date(0), value: new Big(-100 * i) },
              { date: date(100), value: new Big(-i) },
              { date: date(365), value: new Big(80 * i + i * i) }
            ];
            flows.push({ date: date(100), value: new Big(i / 2) });
            expect(calculateXirr(flows).rate).toBe(legacyXirr(flows));
          }
        }
      } finally {
        Big.DP = saved.DP;
        Big.RM = saved.RM;
      }
    }
  );

  it('distinguishes genuine zero, insufficient data and no-root fallback', () => {
    const flows = (values: number[]) =>
      values.map((value, i) => ({
        date: date(i * 365),
        value: new Big(value)
      }));
    expect(calculateXirr(flows([-100, 100]))).toMatchObject({
      status: 'CALCULATED',
      rate: 0
    });
    expect(calculateXirr(flows([-100]))).toMatchObject({
      status: 'INSUFFICIENT_CASH_FLOWS',
      rate: 0
    });
    expect(calculateXirr(flows([-100, 50, -100]))).toMatchObject({
      status: 'UNDEFINED',
      rate: 0
    });
    expect(calculateXirr(flows([-100, 240, -155, 13.2])).rate).toBeCloseTo(
      0.1,
      12
    );
  });
});
