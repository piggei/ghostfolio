import { parseIsharesHoldings } from './ishares.parser';

const HEADER =
  'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Location,Market Currency';

function document(rows: string[]): string {
  return ['Fund Holdings as of,"20/Nov/2026"', '', HEADER, ...rows].join('\n');
}

const APPLE =
  '"AAPL","APPLE","Information Technology","Equity","8,368,157,077.76","6.09","8,368,157,077.76","United States","USD"';

describe('iShares holdings CSV parser', () => {
  it('parses the official CSV structure', () => {
    const result = parseIsharesHoldings(document([APPLE]));

    expect(result.asOfDate).toBe('20/Nov/2026');
    expect(result.holdings).toEqual([
      {
        ticker: 'AAPL',
        name: 'APPLE',
        sector: 'Information Technology',
        assetClass: 'Equity',
        location: 'United States',
        marketCurrency: 'USD',
        marketValue: '8368157077.76',
        notionalValue: '8368157077.76',
        publishedWeight: '6.09'
      }
    ]);
  });

  it('preserves negative and zero values', () => {
    const result = parseIsharesHoldings(
      document([
        '"CAD","CAD CASH","Cash and/or Derivatives","Cash","-16,570,331.53","-0.01","-16,570,331.53","Canada","CAD"',
        '"ESZ6","FUTURE","Cash and/or Derivatives","Futures","0.00","0.00","488,917,500.00","-","USD"'
      ])
    );

    expect(result.holdings[0].marketValue).toBe('-16570331.53');
    expect(result.holdings[1].marketValue).toBe('0');
    expect(result.holdings[1].notionalValue).toBe('488917500');
  });

  it('supports quoted commas and escaped quotes', () => {
    const result = parseIsharesHoldings(
      document([
        '"ABC","ACME, ""GLOBAL""","Financials","Equity","100.00","100.00","100.00","United States","USD"'
      ])
    );

    expect(result.holdings[0].name).toBe('ACME, "GLOBAL"');
  });

  it('supports CRLF and UTF-8 BOM', () => {
    const result = parseIsharesHoldings(
      '\uFEFF' + document([APPLE]).replace(/\n/g, '\r\n')
    );

    expect(result.holdings).toHaveLength(1);
  });

  it('rejects malformed CSV quoting', () => {
    expect(() =>
      parseIsharesHoldings(
        document(['"AAPL","Unterminated,Technology,Equity,100,100,100,US,USD'])
      )
    ).toThrow();
  });

  it('rejects missing columns', () => {
    expect(() =>
      parseIsharesHoldings(
        'Fund Holdings as of,"20/Nov/2026"\n\nTicker,Name\nAAPL,APPLE'
      )
    ).toThrow('Missing iShares holdings columns');
  });

  it('rejects invalid numeric values', () => {
    expect(() =>
      parseIsharesHoldings(document([APPLE.replace('"6.09"', '"N/A"')]))
    ).toThrow('Invalid iShares published weight');
  });

  it('rejects malformed row lengths', () => {
    expect(() => parseIsharesHoldings(document(['AAPL,APPLE']))).toThrow(
      'Invalid iShares holdings row'
    );
  });

  it('rejects empty holdings', () => {
    expect(() => parseIsharesHoldings(document([]))).toThrow(
      'Empty iShares holdings'
    );
  });

  it('rejects invalid dates', () => {
    expect(() =>
      parseIsharesHoldings(
        document([APPLE]).replace('20/Nov/2026', '32/Nov/2026')
      )
    ).toThrow('Invalid iShares holdings date');
  });
});
