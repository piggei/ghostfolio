import { aggregateVanguardHoldings } from './vanguard.aggregator';
import { VanguardHolding } from './vanguard.parser';

function holding(
  weight: number,
  country?: string,
  sector?: string,
  securityType = 'EQ.STOCK'
): VanguardHolding {
  return { weight, country, sector, securityType };
}

describe('Vanguard holdings aggregator', () => {
  it('preserves valid sectors when country exposure exceeds 100 percent', () => {
    const result = aggregateVanguardHoldings([
      holding(0.9, 'US', 'Information Technology'),
      holding(0.105, 'JP', undefined, 'CRNY'),
      holding(-0.005, undefined, undefined, 'CT.FOREX')
    ]);

    expect(result.reconciliation.netWeight).toBe(1);

    expect(result.composition.countries).toEqual([]);

    expect(result.composition.sectors).toEqual([
      { name: 'Technology', weight: 0.9 }
    ]);

    expect(result.reconciliation.classifiedCountryWeight).toBe(1.005);
    expect(result.reconciliation.unclassifiedCountryNetWeight).toBe(-0.005);
  });

  it('reconciles negative unclassified holdings', () => {
    const result = aggregateVanguardHoldings([
      holding(0.7, 'US', 'Information Technology'),
      holding(0.3, 'JP', 'Financials'),
      holding(0.005, undefined, undefined, 'CRNY'),
      holding(-0.005, undefined, undefined, 'CT.FOREX')
    ]);

    expect(result.reconciliation.positiveWeight).toBe(1.005);
    expect(result.reconciliation.negativeWeight).toBe(-0.005);
    expect(result.reconciliation.netWeight).toBe(1);
    expect(result.reconciliation.unclassifiedCountryNetWeight).toBe(0);
    expect(result.reconciliation.unclassifiedSectorNetWeight).toBe(0);

    expect(result.composition.countries).toEqual([
      { code: 'US', weight: 0.7 },
      { code: 'JP', weight: 0.3 }
    ]);
  });

  it('aggregates country and sector exposures', () => {
    const result = aggregateVanguardHoldings([
      holding(0.6, 'US', 'Information Technology'),
      holding(0.4, 'JP', 'Financials')
    ]);

    expect(result.composition.countries).toEqual([
      { code: 'US', weight: 0.6 },
      { code: 'JP', weight: 0.4 }
    ]);

    expect(result.composition.sectors).toEqual([
      { name: 'Technology', weight: 0.6 },
      { name: 'Financial Services', weight: 0.4 }
    ]);

    expect(result.reconciliation.netWeight).toBe(1);
  });

  it('omits both distributions when neither is representable', () => {
    const result = aggregateVanguardHoldings([
      holding(1.005, 'US', 'Information Technology'),
      holding(-0.005, undefined, undefined, 'CT.FOREX')
    ]);

    expect(result.reconciliation.netWeight).toBe(1);
    expect(result.reconciliation.classifiedCountryWeight).toBe(1.005);
    expect(result.reconciliation.classifiedSectorWeight).toBe(1.005);

    expect(result.composition.countries).toEqual([]);
    expect(result.composition.sectors).toEqual([]);
  });

  it('preserves valid countries when sector exposure exceeds 100 percent', () => {
    const result = aggregateVanguardHoldings([
      holding(0.9, 'US', 'Information Technology'),
      holding(0.105, undefined, 'Financials', 'CRNY'),
      holding(-0.005, undefined, undefined, 'CT.FOREX')
    ]);

    expect(result.reconciliation.netWeight).toBe(1);

    expect(result.composition.countries).toEqual([{ code: 'US', weight: 0.9 }]);

    expect(result.composition.sectors).toEqual([]);

    expect(result.reconciliation.classifiedSectorWeight).toBe(1.005);
    expect(result.reconciliation.unclassifiedSectorNetWeight).toBe(-0.005);
  });

  it('preserves unclassified sector exposure', () => {
    const result = aggregateVanguardHoldings([
      holding(0.9, 'US', 'Information Technology'),
      holding(0.1, 'US', undefined, 'CRNY')
    ]);

    expect(result.composition.countries).toEqual([{ code: 'US', weight: 1 }]);

    expect(result.reconciliation.unclassifiedSectorNetWeight).toBe(0.1);
  });

  it('rejects classified negative holdings', () => {
    expect(() =>
      aggregateVanguardHoldings([
        holding(1.01, 'US', 'Information Technology'),
        holding(-0.01, 'US', undefined, 'CT.FOREX')
      ])
    ).toThrow('Classified negative Vanguard holding');
  });

  it('rejects invalid net weight', () => {
    expect(() =>
      aggregateVanguardHoldings([holding(0.8, 'US', 'Information Technology')])
    ).toThrow('Invalid Vanguard net holdings weight');
  });

  it('rejects invalid holdings', () => {
    expect(() => aggregateVanguardHoldings([])).toThrow(
      'Empty Vanguard holdings'
    );

    expect(() =>
      aggregateVanguardHoldings([
        holding(Number.NaN, 'US', 'Information Technology')
      ])
    ).toThrow('Invalid Vanguard holding');
  });

  it('accepts rounding near 100 percent', () => {
    const result = aggregateVanguardHoldings([
      holding(1.0000001, 'US', 'Information Technology')
    ]);

    expect(result.reconciliation.netWeight).toBe(1.0000001);
  });
});
