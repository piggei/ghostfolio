import {
  buildIsharesHoldingsUrl,
  fetchIsharesHoldings,
  parseIsharesHoldingsDate
} from './ishares.client';

const PAGE =
  '<div webqc-datapoint="holdings-as-of-dates" data-as-of-dates="{&quot;all&quot;:20261120}"></div>';

const CSV = [
  'Fund Holdings as of,"20/Nov/2026"',
  '',
  'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Location,Market Currency',
  '"AAPL","APPLE","Information Technology","Equity","100.00","100.00","100.00","United States","USD"'
].join('\n');

beforeEach(() =>
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-25T12:00:00Z'))
);
afterEach(() => jest.restoreAllMocks());

describe('iShares holdings client', () => {
  it('extracts the holdings date from the official component', () => {
    expect(parseIsharesHoldingsDate(PAGE)).toBe('20261120');
  });

  it('ignores unrelated dates', () => {
    const html = '<div asOfDate="20260101"></div>' + PAGE;

    expect(parseIsharesHoldingsDate(html)).toBe('20261120');
  });

  it('rejects missing date metadata', () => {
    expect(() => parseIsharesHoldingsDate('<html></html>')).toThrow(
      'Ambiguous or missing iShares holdings date'
    );
  });

  it('rejects ambiguous holdings components', () => {
    expect(() => parseIsharesHoldingsDate(PAGE + PAGE)).toThrow(
      'Ambiguous or missing iShares holdings date'
    );
  });

  it('rejects invalid calendar dates', () => {
    expect(() =>
      parseIsharesHoldingsDate(PAGE.replace('20261120', '20260230'))
    ).toThrow('Invalid iShares holdings date');
  });

  it('builds the official document URL', () => {
    const url = new URL(
      buildIsharesHoldingsUrl({
        asOfDate: '20261120',
        portfolioId: '251882'
      })
    );

    expect(url.searchParams.get('portfolioId')).toBe('251882');
    expect(url.searchParams.get('asOfDate')).toBe('20261120');
    expect(url.searchParams.get('component')).toBe('holdings');
    expect(url.searchParams.get('targetSite')).toBe('ishares-uk');
  });

  it('fetches and validates the holdings document', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(PAGE, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(CSV, {
          status: 200,
          headers: { 'Content-Type': 'text/csv' }
        })
      );

    const result = await fetchIsharesHoldings({
      fetch,
      pageUrl: 'https://example.com/fund',
      portfolioId: '251882'
    });

    expect(result.asOfDate).toBe('20/Nov/2026');
    expect(result.holdings).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects mismatched document dates', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(PAGE))
      .mockResolvedValueOnce(
        new Response(CSV.replace('20/Nov/2026', '19/Nov/2026'), {
          headers: { 'Content-Type': 'text/csv' }
        })
      );

    await expect(
      fetchIsharesHoldings({
        fetch,
        pageUrl: 'https://example.com/fund',
        portfolioId: '251882'
      })
    ).rejects.toThrow('iShares holdings date mismatch');
  });

  it('rejects HTTP failures', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      fetchIsharesHoldings({
        fetch,
        pageUrl: 'https://example.com/fund',
        portfolioId: '251882'
      })
    ).rejects.toThrow('iShares page HTTP status 503');
  });

  it('rejects invalid document content types', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(PAGE))
      .mockResolvedValueOnce(
        new Response('<html></html>', {
          headers: { 'Content-Type': 'text/html' }
        })
      );

    await expect(
      fetchIsharesHoldings({
        fetch,
        pageUrl: 'https://example.com/fund',
        portfolioId: '251882'
      })
    ).rejects.toThrow('Unexpected iShares document content type');
  });

  it('rejects invalid request timeouts', async () => {
    await expect(
      fetchIsharesHoldings({
        fetch: jest.fn(),
        pageUrl: 'https://example.com/fund',
        portfolioId: '251882',
        requestTimeout: 0
      })
    ).rejects.toThrow('Invalid iShares request timeout');
  });
});
