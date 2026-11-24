import { parseXtrackersHoldings } from './xtrackers.parser';

describe('Xtrackers live validation', () => {
  it('matches the official XMME composition', async () => {
    const url =
      'https://etf.deutsche-am.com/api/pdp/en-gb/etf/' +
      'IE00BTJRMP35-msci-emerging-markets-ucits-etf-1c/holdings';

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000)
    });

    expect(response.ok).toBe(true);

    const data = await response.json();
    const result = parseXtrackersHoldings(data);

    console.log('=== XTRACKERS LIVE RESULT ===');
    console.log('Country coverage:', result.countryCoverage);
    console.log('Unclassified country:', result.unclassifiedCountryWeight);
    console.log('Missing country:', result.missingCountryWeight);
    console.log('Sector coverage:', result.sectorCoverage);
    console.log('Countries:', result.countries.length);
    console.log('Sectors:', result.sectors.length);

    console.log('\n=== TOP COUNTRIES ===');

    for (const country of [...result.countries]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12)) {
      console.log(country.code, country.weight);
    }

    expect(result.countries.length).toBeGreaterThan(0);
    expect(result.sectors.length).toBeGreaterThan(0);

    expect(result.countryCoverage).toBeGreaterThan(0.95);
    expect(result.sectorCoverage).toBeGreaterThan(0.95);

    expect(
      result.countryCoverage +
        result.unclassifiedCountryWeight +
        result.missingCountryWeight
    ).toBeCloseTo(1, 4);
  }, 45000);
});
