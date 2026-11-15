export interface HistoricalCloseObservation {
  date: string;
  marketPrice: number;
  state: 'CLOSE' | 'INTRADAY';
  isCarriedForward: boolean;
}

export interface HistoricalCloseInput {
  date: string;
  observations: readonly HistoricalCloseObservation[];
  maxAgeDays: number;
}

export type HistoricalCloseResult =
  | {
      status: 'available';
      price: string;
      sourceDate: string;
    }
  | {
      status: 'unavailable';
      price: null;
      reason:
        | 'missing_price'
        | 'missing_original_close'
        | 'stale_price'
        | 'invalid_price';
    };

function parseCivilDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Historical close dates must use YYYY-MM-DD');
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError('Invalid historical close date');
  }

  return timestamp;
}

/**
 * Resolves the latest genuine CLOSE at or before a requested civil date.
 *
 * Carried-forward rows can indicate that an earlier price was propagated,
 * but cannot establish a new original closing date.
 *
 * The caller must supply sufficient historical lookback to locate the
 * genuine close. The function never fetches or synthesizes market data.
 */
export function resolveHistoricalClose({
  date,
  observations,
  maxAgeDays
}: HistoricalCloseInput): HistoricalCloseResult {
  const requestedTimestamp = parseCivilDate(date);

  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) {
    throw new RangeError('maxAgeDays must be a non-negative integer');
  }

  let latestOriginal: HistoricalCloseObservation | undefined;
  let latestOriginalTimestamp = Number.NEGATIVE_INFINITY;
  let hasCarriedForward = false;

  for (const observation of observations) {
    const observationTimestamp = parseCivilDate(observation.date);

    if (
      observationTimestamp > requestedTimestamp ||
      observation.state !== 'CLOSE'
    ) {
      continue;
    }

    if (observation.isCarriedForward) {
      hasCarriedForward = true;
      continue;
    }

    if (observationTimestamp >= latestOriginalTimestamp) {
      latestOriginal = observation;
      latestOriginalTimestamp = observationTimestamp;
    }
  }

  if (!latestOriginal) {
    return {
      status: 'unavailable',
      price: null,
      reason: hasCarriedForward ? 'missing_original_close' : 'missing_price'
    };
  }

  if (
    !Number.isFinite(latestOriginal.marketPrice) ||
    latestOriginal.marketPrice <= 0
  ) {
    return {
      status: 'unavailable',
      price: null,
      reason: 'invalid_price'
    };
  }

  const ageDays = (requestedTimestamp - latestOriginalTimestamp) / 86400000;

  if (ageDays > maxAgeDays) {
    return {
      status: 'unavailable',
      price: null,
      reason: 'stale_price'
    };
  }

  return {
    status: 'available',
    price: latestOriginal.marketPrice.toString(),
    sourceDate: latestOriginal.date
  };
}
