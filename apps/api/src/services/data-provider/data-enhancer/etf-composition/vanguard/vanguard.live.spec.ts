import { Big } from 'big.js';

import { aggregateVanguardHoldings } from './vanguard.aggregator';
import { fetchVanguardHoldings } from './vanguard.client';

const GRAPHQL_URL = 'https://www.ie.vanguard/gpx/graphql';

const QUERY = `
  query FundsHoldingsQuery(
    $portIds: [String!]
    $limit: Float
    $lastItemKey: String
  ) {
    borHoldings(portIds: $portIds) {
      holdings(limit: $limit, lastItemKey: $lastItemKey) {
        totalHoldings
        lastItemKey
        items {
          issuerName
          ticker
          securityLongDescription
          securityType
          bloombergIsoCountry
          gicsSectorDescription
          marketValuePercentage
        }
      }
    }
  }
`;

describe('Vanguard live holdings validation', () => {
  it('retrieves the complete fund composition', async () => {
    let requests = 0;

    const holdings = await fetchVanguardHoldings({
      portId: '9679',
      fetchPage: async ({ portId, limit, lastItemKey }) => {
        requests++;

        const response = await fetch(GRAPHQL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-consumer-id': 'ie0'
          },
          body: JSON.stringify({
            query: QUERY,
            variables: {
              portIds: [portId],
              limit,
              lastItemKey
            }
          }),
          signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
          throw new Error(`Vanguard GraphQL HTTP ${response.status}`);
        }

        const data = await response.json();

        console.log(
          `Page ${requests}: HTTP ${response.status}, ` + `limit ${limit}`
        );

        return data;
      }
    });

    const totalWeight = holdings.reduce(
      (sum, holding) => sum.plus(holding.weight),
      new Big(0)
    );

    const negative = holdings.filter((holding) => holding.weight < 0);

    const securityTypes = new Map<
      string,
      {
        count: number;
        weight: Big;
      }
    >();

    for (const holding of holdings) {
      const current = securityTypes.get(holding.securityType) ?? {
        count: 0,
        weight: new Big(0)
      };

      current.count++;
      current.weight = current.weight.plus(holding.weight);

      securityTypes.set(holding.securityType, current);
    }

    console.log('\n=== VANGUARD LIVE RESULTS ===');
    console.log('Requests:', requests);
    console.log('Holdings:', holdings.length);
    console.log('Total weight:', totalWeight.toString());
    console.log('Negative positions:', negative.length);

    console.log('\n=== SECURITY TYPES ===');

    for (const [type, value] of [...securityTypes].sort((a, b) =>
      b[1].weight.cmp(a[1].weight)
    )) {
      console.log(
        type,
        '| count:',
        value.count,
        '| weight:',
        value.weight.toString()
      );
    }

    expect(holdings.length).toBeGreaterThan(0);

    expect(totalWeight.minus(1).abs().lte(0.001)).toBe(true);

    expect(requests).toBeGreaterThan(0);

    const result = aggregateVanguardHoldings(holdings);

    console.log('\n=== AGGREGATED COMPOSITION ===');
    console.log('Countries:', result.composition.countries.length);
    console.log('Sectors:', result.composition.sectors.length);
    console.log('Country coverage:', result.composition.countryCoverage);
    console.log('Sector coverage:', result.composition.sectorCoverage);
    console.log('Missing country:', result.composition.missingCountryWeight);

    console.log('\n=== RECONCILIATION ===');
    console.log(result.reconciliation);

    expect(result.composition.countries.length).toBeGreaterThan(0);
    expect(result.composition.sectors.length).toBeGreaterThan(0);

    expect(result.reconciliation.netWeight).toBeCloseTo(1, 4);

    expect(
      result.reconciliation.classifiedCountryWeight +
        result.reconciliation.unclassifiedCountryNetWeight
    ).toBeCloseTo(result.reconciliation.netWeight, 8);

    expect(
      result.reconciliation.classifiedSectorWeight +
        result.reconciliation.unclassifiedSectorNetWeight
    ).toBeCloseTo(result.reconciliation.netWeight, 8);
  }, 150000);
});
