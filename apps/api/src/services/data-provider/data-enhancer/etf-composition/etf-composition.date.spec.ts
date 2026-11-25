import { assertFreshEtfDate } from './etf-composition.date';

describe('issuer document freshness', () => {
  beforeEach(() =>
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T12:00:00Z'))
  );
  afterEach(() => jest.useRealTimers());
  it('accepts recent official dates', () => {
    expect(() => assertFreshEtfDate('2026-11-23')).not.toThrow();
  });
  it.each([undefined, 'bad', '2026-02-31', '2026-11-26', '2025-11-25'])(
    'rejects %s',
    (value) => {
      expect(() => assertFreshEtfDate(value)).toThrow();
    }
  );
});
