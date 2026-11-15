import {
  getDailyCashReaderBounds,
  orderAccountingDate
} from './daily-cash-reader-dates';

describe('Daily cash reader date bounds', () => {
  it('uses a half-open UTC interval for cash events', () => {
    const bounds = getDailyCashReaderBounds({
      startDate: '2026-03-28',
      endDate: '2026-03-30'
    });

    expect(bounds.cashFrom.toISOString()).toBe('2026-03-28T00:00:00.000Z');
    expect(bounds.cashUntil.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('expands order query bounds without changing cash bounds', () => {
    const bounds = getDailyCashReaderBounds({
      startDate: '2026-10-24',
      endDate: '2026-10-26'
    });

    expect(bounds.orderFrom.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(bounds.orderUntil.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(bounds.cashFrom.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(bounds.cashUntil.toISOString()).toBe('2026-10-27T00:00:00.000Z');
  });

  it('handles leap days and year boundaries', () => {
    expect(
      getDailyCashReaderBounds({
        startDate: '2024-02-29',
        endDate: '2024-02-29'
      }).cashUntil.toISOString()
    ).toBe('2024-03-01T00:00:00.000Z');

    expect(
      getDailyCashReaderBounds({
        startDate: '2026-12-31',
        endDate: '2026-12-31'
      }).cashUntil.toISOString()
    ).toBe('2027-01-01T00:00:00.000Z');
  });

  it.each([
    ['2026-02-30', '2026-03-01'],
    ['2026-13-01', '2026-13-01'],
    ['not-a-date', '2026-03-01'],
    ['2026-03-02', '2026-03-01']
  ])('rejects invalid range %s to %s', (startDate, endDate) => {
    expect(() => getDailyCashReaderBounds({ startDate, endDate })).toThrow();
  });

  it('preserves the Ghostfolio order accounting date convention', () => {
    const timestamp = new Date('2026-03-29T00:30:00.000Z');

    const expectedByTimezone: Record<string, string> = {
      UTC: '2026-03-29',
      'Europe/Rome': '2026-03-29',
      'America/New_York': '2026-03-28'
    };

    const timezone = process.env.TZ ?? 'UTC';
    const expected = expectedByTimezone[timezone];

    if (!expected) {
      throw new Error(`Unexpected test timezone: ${timezone}`);
    }

    expect(orderAccountingDate(timestamp)).toBe(expected);
  });

  it('keeps the order query wide enough across accounting dates', () => {
    const bounds = getDailyCashReaderBounds({
      startDate: '2026-03-28',
      endDate: '2026-03-29'
    });

    const timestamp = new Date('2026-03-29T00:30:00.000Z');

    expect(timestamp.getTime()).toBeGreaterThanOrEqual(
      bounds.orderFrom.getTime()
    );
    expect(timestamp.getTime()).toBeLessThan(bounds.orderUntil.getTime());
  });
});
