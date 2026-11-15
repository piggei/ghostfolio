import { format } from 'date-fns';

const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_BOUNDARY_MARGIN_MS = 2 * DAY_MS;

function parseCivilDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('Expected YYYY-MM-DD');
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError('Invalid civil date');
  }

  return date;
}

export function getDailyCashReaderBounds({
  startDate,
  endDate
}: {
  startDate: string;
  endDate: string;
}) {
  const start = parseCivilDate(startDate);
  const end = parseCivilDate(endDate);

  if (start > end) {
    throw new RangeError('Reversed classification range');
  }

  const cashUntil = new Date(end.getTime() + DAY_MS);

  return {
    cashFrom: start,
    cashUntil,
    orderFrom: new Date(start.getTime() - ORDER_BOUNDARY_MARGIN_MS),
    orderUntil: new Date(cashUntil.getTime() + ORDER_BOUNDARY_MARGIN_MS)
  };
}

export function orderAccountingDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
