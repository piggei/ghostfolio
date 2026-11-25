export function assertFreshEtfDate(value: unknown): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    throw new Error('Missing or unsupported ETF composition date');
  }
  const day = value.slice(0, 10);
  const timestamp = Date.parse(day + 'T00:00:00Z');
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== day ||
    timestamp > Date.now() ||
    Date.now() - timestamp > 75 * 86400000
  ) {
    throw new Error('Stale or invalid ETF composition date');
  }
}
