import { parseXtrackersHoldings } from './xtrackers.parser';

const columns = [
  { key: 'column_1', value: '% Weight' },
  { key: 'column_3', value: 'Country' },
  { key: 'column_4', value: 'Industry' },
  { key: 'column_5', value: 'Asset class' }
];

function createResponse(rows: unknown[]) {
  return {
    tables: [
      {
        columns,
        values: rows
      }
    ],
    asOfDate: '20/Nov/2026'
  };
}

function createRow({
  country,
  sector,
  weight,
  assetClass
}: {
  country: string;
  sector: string;
  weight: number;
  assetClass?: string;
}) {
  return {
    column_1: { sortValue: weight },
    column_3: { value: country },
    column_4: { value: sector },
    column_5: { value: assetClass ?? 'Equities' }
  };
}

describe('Xtrackers holdings parser', () => {
  it('parses weights without rounding', () => {
    const result = parseXtrackersHoldings(
      createResponse([
        createRow({
          country: 'Taiwan',
          sector: 'Information Technology',
          weight: 14.51043385
        })
      ])
    );

    expect(result.countries).toEqual([{ code: 'TW', weight: 0.1451043385 }]);

    expect(result.sectors).toEqual([
      { name: 'Technology', weight: 0.1451043385 }
    ]);
  });

  it('maps Korean holdings and unclassified countries', () => {
    const result = parseXtrackersHoldings(
      createResponse([
        createRow({
          country: 'Korea, Republic of',
          sector: 'Information Technology',
          weight: 6.22296146
        }),
        createRow({
          country: '--',
          sector: 'Unknown',
          weight: 0.231839
        })
      ])
    );

    expect(result.countries).toEqual([{ code: 'KR', weight: 0.0622296146 }]);

    expect(result.unclassifiedCountryWeight).toBe(0.00231839);

    expect(result.sectors).toContainEqual({
      name: 'Other',
      weight: 0.00231839
    });
  });

  it('rejects missing required columns', () => {
    expect(() =>
      parseXtrackersHoldings({
        tables: [{ columns: [], values: [{}] }]
      })
    ).toThrow('Missing Xtrackers required columns');
  });

  it('rejects empty holdings', () => {
    expect(() => parseXtrackersHoldings(createResponse([]))).toThrow(
      'Empty Xtrackers holdings'
    );
  });

  it('rejects negative weights', () => {
    expect(() =>
      parseXtrackersHoldings(
        createResponse([
          createRow({
            country: 'Taiwan',
            sector: 'Technology',
            weight: -1
          })
        ])
      )
    ).toThrow('Invalid Xtrackers holding weight');
  });

  it('nets negative cash without altering equity country or sector weights', () => {
    const result = parseXtrackersHoldings(
      createResponse([
        createRow({
          country: 'United States',
          sector: 'Information Technology',
          weight: 99.98078356,
          assetClass: 'Equities'
        }),
        createRow({
          country: '--',
          sector: 'Unknown',
          weight: 0.02435966,
          assetClass: 'Cash'
        }),
        createRow({
          country: '--',
          sector: 'Unknown',
          weight: -0.00013533,
          assetClass: 'Cash'
        }),
        createRow({
          country: 'United States',
          sector: 'Unknown',
          weight: -0.00500841,
          assetClass: 'Cash'
        })
      ])
    );
    expect(result.countries).toEqual([{ code: 'US', weight: 0.9998078356 }]);
    expect(result.unclassifiedCountryWeight).toBe(0.0001921592);
    expect(result.sectors).toContainEqual({
      name: 'Technology',
      weight: 0.9998078356
    });
    expect(result.sectors).toContainEqual({
      name: 'Other',
      weight: 0.0001921592
    });
  });

  it('rejects negative non-cash holdings', () => {
    expect(() =>
      parseXtrackersHoldings(
        createResponse([
          createRow({
            country: 'United States',
            sector: 'Technology',
            weight: 100.01,
            assetClass: 'Equities'
          }),
          createRow({
            country: 'United States',
            sector: 'Technology',
            weight: -0.01,
            assetClass: 'Equities'
          })
        ])
      )
    ).toThrow('Invalid Xtrackers holding weight');
  });

  it('rejects negative net cash', () => {
    expect(() =>
      parseXtrackersHoldings(
        createResponse([
          createRow({
            country: 'United States',
            sector: 'Technology',
            weight: 100.01,
            assetClass: 'Equities'
          }),
          createRow({
            country: '--',
            sector: 'Unknown',
            weight: -0.01,
            assetClass: 'Cash'
          })
        ])
      )
    ).toThrow('Negative Xtrackers net cash balance');
  });

  it('rejects an inconsistent net total with negative cash', () => {
    expect(() =>
      parseXtrackersHoldings(
        createResponse([
          createRow({
            country: 'United States',
            sector: 'Technology',
            weight: 50,
            assetClass: 'Equities'
          }),
          createRow({
            country: '--',
            sector: 'Unknown',
            weight: 1,
            assetClass: 'Cash'
          }),
          createRow({
            country: '--',
            sector: 'Unknown',
            weight: -0.1,
            assetClass: 'Cash'
          })
        ])
      )
    ).toThrow('Invalid Xtrackers net holdings total');
  });

  it('rejects malformed responses', () => {
    for (const value of [null, {}, [], { tables: [] }]) {
      expect(() => parseXtrackersHoldings(value)).toThrow();
    }
  });

  it('rejects holdings exceeding 100%', () => {
    expect(() =>
      parseXtrackersHoldings(
        createResponse([
          createRow({
            country: 'Taiwan',
            sector: 'Technology',
            weight: 60
          }),
          createRow({
            country: 'China',
            sector: 'Financials',
            weight: 50
          })
        ])
      )
    ).toThrow('ETF country weights exceed 100%');
  });
});
