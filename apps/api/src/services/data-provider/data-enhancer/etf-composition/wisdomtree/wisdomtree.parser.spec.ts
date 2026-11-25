import {
  parseWisdomtreeFactsheet,
  WisdomtreeTextItem
} from './wisdomtree.parser';

function fixture(): WisdomtreeTextItem[] {
  const items: WisdomtreeTextItem[] = [];
  const add = (str: string, x: number, y: number) => {
    items.push({ str, transform: [1, 0, 0, 1, x, y] });
  };
  add('Top 10 Holdings (% Weight)', 68, 684);
  add('Fund Sector Exposure (% Weight)', 219, 684);
  add('Top 10 Countries (% Weight)', 387, 684);
  add(
    'NB: Sources for all tables/charts on these pages: WisdomTree UK, Bloomberg. All data as of 30/10/2026',
    37,
    516
  );
  add('GGRA.MI', 257, 421);
  add('IE00BZ56SW52', 350, 421);
  const sectors: [string, string][] = [
    ['Health Care', '20.70%'],
    ['Information…', '19.52%'],
    ['Industrials', '19.45%'],
    ['Consumer…', '13.25%'],
    ['Financials', '8.53%'],
    ['Consumer Staples', '7.93%'],
    ['Communication…', '3.72%'],
    ['Materials', '3.62%'],
    ['Energy', '2.50%'],
    ['Utilities', '0.75%']
  ];
  const countries: [string, string][] = [
    ['United States', '58.91%'],
    ['Switzerland', '6.54%'],
    ['United Kingdom', '6.16%'],
    ['France', '6.07%'],
    ['Japan', '5.48%'],
    ['Germany', '3.00%'],
    ['Sweden', '2.27%'],
    ['Canada', '2.17%'],
    ['Spain', '1.44%'],
    ['Netherlands', '1.19%']
  ];
  sectors.forEach(([name, weight], i) => {
    const y = 654 - i * 11.65;
    add(name, 239, y + 0.5);
    add(weight, 310, y);
  });
  countries.forEach(([name, weight], i) => {
    const y = 654 - i * 11.65;
    add(name, 401, y + 0.5);
    add(weight, 450, y);
  });
  return items;
}

describe('WisdomTree GGRA factsheet parser', () => {
  it('extracts top ten exposures without rescaling the missing country weight', () => {
    const result = parseWisdomtreeFactsheet(fixture());
    expect(result.isin).toBe('IE00BZ56SW52');
    expect(result.asOfDate).toBe('2026-10-30');
    expect(result.countries).toHaveLength(10);
    expect(result.sectors).toHaveLength(10);
    expect(result.countryCoverage).toBeCloseTo(0.9323, 6);
    expect(result.sectorCoverage).toBeCloseTo(0.9997, 6);
    expect(result.missingCountryWeight).toBeCloseTo(0.0677, 6);
    expect(
      result.countries.find((item) => item.code === 'US')?.weight
    ).toBeCloseTo(0.5891);
    expect(
      result.sectors.find((item) => item.name === 'Technology')?.weight
    ).toBeCloseTo(0.1952);
  });

  it('rejects unknown abbreviated sector labels', () => {
    const items = fixture();
    items.find((item) => item.str === 'Consumer…')!.str = 'Unknown…';
    expect(() => parseWisdomtreeFactsheet(items)).toThrow(
      'Unknown WisdomTree sector'
    );
  });

  it('rejects incorrect fund identity', () => {
    const items = fixture().filter((item) => item.str !== 'IE00BZ56SW52');
    expect(() => parseWisdomtreeFactsheet(items)).toThrow(
      'fund identity mismatch'
    );
  });

  it('rejects missing allocation rows', () => {
    const items = fixture().filter((item) => item.str !== 'Netherlands');
    expect(() => parseWisdomtreeFactsheet(items)).toThrow(
      'allocation table structure'
    );
  });

  it('rejects invalid allocation dates', () => {
    const items = fixture();
    const source = items.find((item) => item.str.includes('All data as of'))!;
    source.str = source.str.replace('30/10/2026', '31/02/2026');
    expect(() => parseWisdomtreeFactsheet(items)).toThrow('Invalid or future');
  });
});
