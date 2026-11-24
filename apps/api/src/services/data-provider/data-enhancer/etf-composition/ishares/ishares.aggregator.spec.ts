import { aggregateIsharesHoldings } from './ishares.aggregator';
import { IsharesHolding } from './ishares.parser';

function holding({
  marketValue,
  publishedWeight,
  assetClass = 'Equity',
  location = 'United States',
  sector = 'Information Technology'
}: {
  marketValue: string;
  publishedWeight: string;
  assetClass?: string;
  location?: string;
  sector?: string;
}): IsharesHolding {
  return {
    ticker: 'TEST',
    name: 'Test Holding',
    sector,
    assetClass,
    location,
    marketCurrency: 'USD',
    marketValue,
    notionalValue: marketValue,
    publishedWeight
  };
}

describe('iShares holdings aggregator', () => {
  it('preserves equity and cash allocations', () => {
    const result = aggregateIsharesHoldings([
      holding({ marketValue: '900', publishedWeight: '90' }),
      holding({
        marketValue: '100',
        publishedWeight: '10',
        assetClass: 'Cash'
      })
    ]);

    expect(result.composition.countries).toEqual([{ code: 'US', weight: 0.9 }]);

    expect(result.composition.sectors).toEqual([
      { name: 'Technology', weight: 0.9 }
    ]);

    expect(result.reconciliation.equityWeight).toBe(0.9);
    expect(result.reconciliation.nonEquityWeight).toBe(0.1);
  });

  it('reconciles negative cash positions', () => {
    const result = aggregateIsharesHoldings([
      holding({ marketValue: '990', publishedWeight: '99' }),
      holding({
        marketValue: '20',
        publishedWeight: '2',
        assetClass: 'Cash'
      }),
      holding({
        marketValue: '-10',
        publishedWeight: '-1',
        assetClass: 'Cash'
      })
    ]);

    expect(result.reconciliation.totalMarketValue).toBe('1000');
    expect(result.reconciliation.negativeMarketValue).toBe('-10');
    expect(result.reconciliation.equityWeight).toBe(0.99);
  });

  it('ignores futures notional value', () => {
    const future = holding({
      marketValue: '0',
      publishedWeight: '0',
      assetClass: 'Futures'
    });

    future.notionalValue = '1000000';

    const result = aggregateIsharesHoldings([
      holding({ marketValue: '1000', publishedWeight: '100' }),
      future
    ]);

    expect(result.reconciliation.totalMarketValue).toBe('1000');
    expect(result.reconciliation.equityWeight).toBe(1);
  });

  it('uses market values instead of rounded published weights', () => {
    const result = aggregateIsharesHoldings([
      holding({ marketValue: '6001', publishedWeight: '60.01' }),
      holding({
        marketValue: '3999',
        publishedWeight: '39.99',
        location: 'Japan',
        sector: 'Financials'
      })
    ]);

    expect(result.composition.countries).toEqual([
      { code: 'US', weight: 0.6001 },
      { code: 'JP', weight: 0.3999 }
    ]);
  });

  it('rejects inconsistent published weights', () => {
    expect(() =>
      aggregateIsharesHoldings([
        holding({ marketValue: '900', publishedWeight: '80' }),
        holding({
          marketValue: '100',
          publishedWeight: '20',
          assetClass: 'Cash'
        })
      ])
    ).toThrow('Inconsistent iShares published weight');
  });

  it('rejects zero or negative total market value', () => {
    expect(() =>
      aggregateIsharesHoldings([
        holding({ marketValue: '0', publishedWeight: '0' })
      ])
    ).toThrow('Invalid iShares total market value');
  });

  it('rejects negative equity market values', () => {
    expect(() =>
      aggregateIsharesHoldings([
        holding({ marketValue: '-10', publishedWeight: '-10' }),
        holding({
          marketValue: '110',
          publishedWeight: '110',
          assetClass: 'Cash'
        })
      ])
    ).toThrow('Negative iShares equity market value');
  });

  it('preserves unknown equity classifications', () => {
    const result = aggregateIsharesHoldings([
      holding({
        marketValue: '900',
        publishedWeight: '90',
        location: '-',
        sector: '-'
      }),
      holding({
        marketValue: '100',
        publishedWeight: '10',
        location: 'United States',
        sector: 'Financials'
      })
    ]);

    expect(result.composition.countries).toEqual([{ code: 'US', weight: 0.1 }]);

    expect(result.composition.sectors).toEqual([
      { name: 'Financial Services', weight: 0.1 }
    ]);
  });

  it('rejects allocations exceeding the normalizer limits', () => {
    expect(() =>
      aggregateIsharesHoldings([
        holding({
          marketValue: '1010',
          publishedWeight: '101',
          location: 'United States'
        }),
        holding({
          marketValue: '-10',
          publishedWeight: '-1',
          assetClass: 'Cash'
        })
      ])
    ).toThrow('Invalid ETF exposure weight');
  });

  it('rejects empty holdings', () => {
    expect(() => aggregateIsharesHoldings([])).toThrow(
      'Empty iShares holdings'
    );
  });
});
