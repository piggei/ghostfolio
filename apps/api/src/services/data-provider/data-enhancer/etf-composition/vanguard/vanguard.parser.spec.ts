import { parseVanguardHoldingsPage } from './vanguard.parser';

function response(
  items: unknown[],
  totalHoldings = items.length,
  lastItemKey: string | null = null
) {
  return {
    data: {
      borHoldings: [
        {
          holdings: {
            items,
            totalHoldings,
            lastItemKey
          }
        }
      ]
    }
  };
}

describe('Vanguard holdings page parser', () => {
  it('parses a valid GraphQL page', () => {
    const result = parseVanguardHoldingsPage(
      response(
        [
          {
            bloombergIsoCountry: 'US',
            gicsSectorDescription: 'Information Technology',
            marketValuePercentage: 4.74363,
            securityType: 'EQ.STOCK'
          }
        ],
        3934,
        'next-page'
      )
    );

    expect(result).toEqual({
      holdings: [
        {
          country: 'US',
          sector: 'Information Technology',
          securityType: 'EQ.STOCK',
          weight: 0.0474363
        }
      ],
      totalHoldings: 3934,
      lastItemKey: 'next-page'
    });
  });

  it('preserves negative weights', () => {
    const result = parseVanguardHoldingsPage(
      response([
        {
          bloombergIsoCountry: null,
          gicsSectorDescription: null,
          marketValuePercentage: -0.00006,
          securityType: 'CT.FOREX'
        }
      ])
    );

    expect(result.holdings[0].weight).toBe(-0.0000006);
  });

  it('rejects malformed GraphQL responses', () => {
    for (const value of [null, {}, [], { data: {} }]) {
      expect(() => parseVanguardHoldingsPage(value)).toThrow();
    }
  });

  it('rejects GraphQL errors', () => {
    expect(() =>
      parseVanguardHoldingsPage({
        ...response([]),
        errors: [{ message: 'Unavailable' }]
      })
    ).toThrow('Vanguard GraphQL returned errors');
  });

  it('rejects invalid holding weights', () => {
    expect(() =>
      parseVanguardHoldingsPage(
        response([
          {
            bloombergIsoCountry: 'US',
            marketValuePercentage: NaN,
            securityType: 'EQ.STOCK'
          }
        ])
      )
    ).toThrow('Invalid Vanguard holding fields');
  });

  it('preserves pagination metadata', () => {
    const result = parseVanguardHoldingsPage(response([], 3934, 'cursor-2'));

    expect(result.totalHoldings).toBe(3934);
    expect(result.lastItemKey).toBe('cursor-2');
  });
});
