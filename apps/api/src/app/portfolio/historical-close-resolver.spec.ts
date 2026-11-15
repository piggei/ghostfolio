import { resolveHistoricalClose } from './historical-close-resolver';

describe('Historical close resolver', () => {
  const close = (
    date: string,
    marketPrice: number,
    isCarriedForward = false
  ) => ({
    date,
    marketPrice,
    state: 'CLOSE' as const,
    isCarriedForward
  });

  it('accepts an original closing price on the requested date', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-02',
        observations: [close('2026-10-02', 125.5)],
        maxAgeDays: 7
      })
    ).toEqual({
      status: 'available',
      price: '125.5',
      sourceDate: '2026-10-02'
    });
  });

  it('accepts the last genuine close across a weekend', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-04',
        observations: [
          close('2026-10-02', 125.5),
          close('2026-10-03', 125.5, true),
          close('2026-10-04', 125.5, true)
        ],
        maxAgeDays: 7
      })
    ).toEqual({
      status: 'available',
      price: '125.5',
      sourceDate: '2026-10-02'
    });
  });

  it('rejects a stale original closing price', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-15',
        observations: [close('2026-10-02', 125.5)],
        maxAgeDays: 7
      })
    ).toMatchObject({
      status: 'unavailable',
      price: null,
      reason: 'stale_price'
    });
  });

  it('does not treat carried-forward prices as new original closes', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-15',
        observations: [
          close('2026-10-02', 125.5),
          close('2026-10-14', 125.5, true),
          close('2026-10-15', 125.5, true)
        ],
        maxAgeDays: 7
      })
    ).toMatchObject({
      status: 'unavailable',
      price: null,
      reason: 'stale_price'
    });
  });

  it('ignores future observations', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-02',
        observations: [close('2026-10-03', 130)],
        maxAgeDays: 7
      })
    ).toMatchObject({
      status: 'unavailable',
      price: null,
      reason: 'missing_price'
    });
  });

  it('does not accept an intraday quote as a closing price', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-02',
        observations: [
          {
            ...close('2026-10-02', 125.5),
            state: 'INTRADAY' as const
          }
        ],
        maxAgeDays: 7
      })
    ).toMatchObject({
      status: 'unavailable',
      price: null,
      reason: 'missing_price'
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid closing price: %s',
    (marketPrice) => {
      expect(
        resolveHistoricalClose({
          date: '2026-10-02',
          observations: [close('2026-10-02', marketPrice)],
          maxAgeDays: 7
        })
      ).toMatchObject({
        status: 'unavailable',
        price: null,
        reason: 'invalid_price'
      });
    }
  );

  it('requires a genuine close to establish price provenance', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-04',
        observations: [close('2026-10-04', 125.5, true)],
        maxAgeDays: 7
      })
    ).toMatchObject({
      status: 'unavailable',
      price: null,
      reason: 'missing_original_close'
    });
  });
});

describe('Historical close resolver edge cases', () => {
  const close = (date: string, marketPrice: number) => ({
    date,
    marketPrice,
    state: 'CLOSE' as const,
    isCarriedForward: false
  });

  it('rejects impossible calendar dates', () => {
    expect(() =>
      resolveHistoricalClose({
        date: '2026-02-30',
        observations: [],
        maxAgeDays: 7
      })
    ).toThrow(RangeError);
  });

  it('rejects malformed observation dates', () => {
    expect(() =>
      resolveHistoricalClose({
        date: '2026-10-02',
        observations: [close('2026-13-01', 100)],
        maxAgeDays: 7
      })
    ).toThrow(RangeError);
  });

  it.each([-1, 1.5])('rejects invalid maximum price age: %s', (maxAgeDays) => {
    expect(() =>
      resolveHistoricalClose({
        date: '2026-10-02',
        observations: [],
        maxAgeDays
      })
    ).toThrow(RangeError);
  });

  it('accepts an original close exactly at the age limit', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-09',
        observations: [close('2026-10-02', 125)],
        maxAgeDays: 7
      })
    ).toEqual({
      status: 'available',
      price: '125',
      sourceDate: '2026-10-02'
    });
  });

  it('selects the latest original close regardless of input order', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-04',
        observations: [
          close('2026-10-02', 120),
          close('2026-10-03', 125),
          close('2026-10-01', 110)
        ],
        maxAgeDays: 7
      })
    ).toEqual({
      status: 'available',
      price: '125',
      sourceDate: '2026-10-03'
    });
  });

  it('rejects carried-forward history without an original close', () => {
    expect(
      resolveHistoricalClose({
        date: '2026-10-04',
        observations: [
          {
            ...close('2026-10-03', 125),
            isCarriedForward: true
          },
          {
            ...close('2026-10-04', 125),
            isCarriedForward: true
          }
        ],
        maxAgeDays: 7
      })
    ).toMatchObject({
      status: 'unavailable',
      price: null,
      reason: 'missing_original_close'
    });
  });
});
