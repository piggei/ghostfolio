import { Big } from 'big.js';

export interface XirrFlow {
  day: number;
  value: Big;
}
export interface XirrResult {
  status: 'CALCULATED' | 'INSUFFICIENT_CASH_FLOWS' | 'UNDEFINED';
  /** Retains the legacy numeric fallback; consumers must inspect status. */
  rate: number;
}

/** Sorted, same-day-aggregated cash flows; terminal is merged without rebuilding
 * or sorting the accumulated dated history. Newton always starts at zero.
 */
export function calculatePreparedXirr(
  flows: readonly XirrFlow[],
  terminal?: XirrFlow
): XirrResult {
  const last = flows.at(-1);
  let combined = terminal;
  let count = flows.length;
  if (terminal) {
    if (last?.day === terminal.day) {
      combined = { day: terminal.day, value: last.value.plus(terminal.value) };
    } else {
      count++;
    }
  }
  const at = (i: number) => (combined && i === count - 1 ? combined : flows[i]);
  let firstDay: number | undefined;
  let lastDay: number | undefined;
  let negatives = false;
  let positives = false;
  let nonzero = 0;
  let scale = new Big(0);
  for (let i = 0; i < count; i++) {
    const { day, value } = at(i);
    if (value.eq(0)) continue;
    firstDay ??= day;
    lastDay = day;
    nonzero++;
    negatives ||= value.lt(0);
    positives ||= value.gt(0);
    scale = value.abs().gt(scale) ? value.abs() : scale;
  }
  if (nonzero < 2 || firstDay === lastDay)
    return { status: 'INSUFFICIENT_CASH_FLOWS', rate: 0 };
  if (!negatives || !positives || scale.eq(0))
    return { status: 'UNDEFINED', rate: 0 };
  const normalizedCashFlows: { exponent: number; value: number }[] = [];
  for (let i = 0; i < count; i++) {
    const flow = at(i);
    if (!flow.value.eq(0))
      normalizedCashFlows.push({
        exponent: (flow.day - firstDay) / 365,
        value: flow.value.div(scale).toNumber()
      });
  }
  const calculated = (rate: number): XirrResult => ({
    status:
      Number.isFinite(rate) && Number.isFinite(calculateXnpv(rate))
        ? 'CALCULATED'
        : 'UNDEFINED',
    rate
  });
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
      return calculated(newtonRate);
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
      return calculated(nextRate);
    }

    newtonRate = nextRate;
  }

  let lowerRate = -0.999999999;
  let upperRate = 1;

  let lowerValue = calculateXnpv(lowerRate);
  let upperValue = calculateXnpv(upperRate);

  if (Math.abs(lowerValue) < 1e-14) {
    return calculated(lowerRate);
  }

  if (Math.abs(upperValue) < 1e-14) {
    return calculated(upperRate);
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
    return { status: 'UNDEFINED', rate: 0 };
  }

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middleRate = (lowerRate + upperRate) / 2;
    const middleValue = calculateXnpv(middleRate);

    if (Math.abs(middleValue) < 1e-14) {
      return calculated(middleRate);
    }

    if (Math.sign(lowerValue) === Math.sign(middleValue)) {
      lowerRate = middleRate;
      lowerValue = middleValue;
    } else {
      upperRate = middleRate;
      upperValue = middleValue;
    }

    if (Math.abs(upperRate - lowerRate) < 1e-14) {
      return calculated((lowerRate + upperRate) / 2);
    }
  }

  return calculated((lowerRate + upperRate) / 2);
}

/** Compatibility preparation, including original same-day aggregation order. */
export function calculateXirr(
  cashFlows: readonly { date: string; value: Big }[],
  difference: (date: string, origin: string) => number = (date, origin) =>
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) /
    86400000
): XirrResult {
  const byDate = new Map<string, Big>();
  for (const { date, value } of cashFlows)
    byDate.set(date, (byDate.get(date) ?? new Big(0)).plus(value));
  const prepared = [...byDate]
    .map(([date, value]) => ({ date, value }))
    .filter(({ value }) => !value.eq(0))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (prepared.length < 2)
    return { status: 'INSUFFICIENT_CASH_FLOWS', rate: 0 };
  return calculatePreparedXirr(
    prepared.map(({ date, value }) => ({
      day: difference(date, prepared[0].date),
      value
    }))
  );
}
