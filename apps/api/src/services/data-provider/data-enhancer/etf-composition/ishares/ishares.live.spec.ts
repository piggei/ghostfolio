import { aggregateIsharesHoldings } from './ishares.aggregator';
import { fetchIsharesHoldings } from './ishares.client';

const FUND = {
  portfolioId: '251882',
  pageUrl:
    'https://www.ishares.com/uk/individual/en/products/251882/ishares-core-msci-world-ucits-etf-swda'
};

describe('iShares live holdings validation', () => {
  it('retrieves and aggregates the official SWDA composition', async () => {
    const document = await fetchIsharesHoldings({
      fetch: globalThis.fetch,
      pageUrl: FUND.pageUrl,
      portfolioId: FUND.portfolioId,
      requestTimeout: 30000
    });

    const result = aggregateIsharesHoldings(document.holdings);

    const { composition, reconciliation } = result;

    console.log('=== ISHARES LIVE ===');
    console.log('Date:', document.asOfDate);
    console.log('Holdings:', document.holdings.length);
    console.log('Total market value:', reconciliation.totalMarketValue);
    console.log('Equity weight:', reconciliation.equityWeight);
    console.log('Non-equity weight:', reconciliation.nonEquityWeight);
    console.log('Country coverage:', composition.countryCoverage);
    console.log('Sector coverage:', composition.sectorCoverage);
    console.log(
      'Classified sector coverage:',
      composition.classifiedSectorCoverage
    );

    expect(document.holdings.length).toBeGreaterThan(1000);

    expect(reconciliation.equityWeight).toBeGreaterThan(0.95);

    expect(
      reconciliation.equityWeight + reconciliation.nonEquityWeight
    ).toBeCloseTo(1, 10);

    expect(composition.countryCoverage).toBeGreaterThan(0.95);
    expect(composition.classifiedSectorCoverage).toBeGreaterThan(0.95);

    expect(reconciliation.maximumPublishedWeightDifference).toBeLessThanOrEqual(
      0.0051
    );
  }, 90000);
});
