import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EtfCompositionDiscovery } from './etf-composition.discovery';

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));

const funds = [
  { issuer: 'ISHARES', isin: 'IE00B4L5Y983', id: '251882' },
  { issuer: 'ISHARES', isin: 'IE00B5BMR087', id: '253743' },
  { issuer: 'ISHARES', isin: 'IE00BKM4GZ66', id: '264659' },
  { issuer: 'VANGUARD', isin: 'IE00BK5BQT80', id: '9679' },
  { issuer: 'VANGUARD', isin: 'IE00B810Q511', id: '9509' },
  { issuer: 'VANGUARD', isin: 'IE00B3XXRP09', id: '9503' },
  {
    issuer: 'XTRACKERS',
    isin: 'IE00BTJRMP35',
    id: 'msci-emerging-markets-ucits-etf-1c'
  },
  {
    issuer: 'XTRACKERS',
    isin: 'IE00BGV5VN51',
    id: 'artificial-intelligence-big-data-ucits-etf-1c'
  },
  { issuer: 'XTRACKERS', isin: 'IE00BJ0KDQ92', id: 'msci-world-ucits-etf-1c' },
  { issuer: 'WISDOMTREE', isin: 'IE00BZ56SW52', id: '' },
  { issuer: 'WISDOMTREE', isin: 'IE00BDVPNG13', id: '' },
  { issuer: 'WISDOMTREE', isin: 'IE00BJGWQN72', id: '' }
] as const;

describe('issuer discovery without fund whitelists', () => {
  it.each(funds)(
    'discovers $issuer $isin for any exchange symbol',
    async ({ issuer, isin, id }) => {
      const fetch = jest.fn(async (url: string) => {
        if (url.includes('search/products'))
          return Response.json({ results: [{ portfolioId: id }] });
        if (url.endsWith('product-sitemap.xml'))
          return new Response(
            '<loc>https://www.ishares.com/uk/individual/en/products/' +
              id +
              '/dynamic-product</loc>'
          );
        if (url.includes('ishares.com'))
          return new Response(
            '{"value":"' +
              isin +
              '","fullName":"fundHeader.fundName.productIsin"}'
          );
        if (url.endsWith('/home'))
          return new Response('"portIds":"9503,9509,9679"');
        if (url.endsWith('/graphql'))
          return Response.json({
            data: {
              funds: funds
                .filter((fund) => fund.issuer === 'VANGUARD')
                .map((fund) => ({
                  profile: {
                    portId: fund.id,
                    identifiers: [{ altId: 'ISIN', altIdValue: fund.isin }]
                  }
                }))
            }
          });
        return new Response(
          '<urlset>' +
            funds
              .filter((fund) => fund.issuer === 'XTRACKERS')
              .map(
                (fund) =>
                  '<url><loc>https://etf.deutsche-am.com/en-gb/' +
                  fund.isin +
                  '-' +
                  fund.id +
                  '/</loc></url>'
              )
              .join('') +
            '</urlset>'
        );
      });
      const discovery = new EtfCompositionDiscovery({ fetch } as any);
      const profile = {
        name: issuer + ' ETF',
        isin,
        dataSource: 'YAHOO' as const
      };
      const result = await discovery.discover(
        issuer,
        profile,
        'UNSEEN.MI',
        1000
      );
      expect(result?.isin).toBe(isin);
      if (issuer === 'VANGUARD' || issuer === 'ISHARES')
        expect(result?.portfolioId).toBe(id);
      if (issuer === 'XTRACKERS')
        expect(result?.holdingsUrl).toContain(isin + '-' + id + '/holdings');
      const requests = fetch.mock.calls.length;
      expect(
        await discovery.discover(issuer, profile, 'DIFFERENT.L', 1000)
      ).toEqual(result);
      expect(fetch).toHaveBeenCalledTimes(requests);
    }
  );

  it('does not probe issuers for unknown or conflicting issuer metadata', async () => {
    const fetch = jest.fn();
    const discovery = new EtfCompositionDiscovery({ fetch });
    for (const name of [
      'Unknown fund',
      'iShares Vanguard fund',
      'WisdomTree ETF'
    ]) {
      expect(
        await discovery.discover(
          'ISHARES',
          { name, isin: funds[0].isin },
          'ANY.MI',
          1000
        )
      ).toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a mismatching active iShares share class even if the requested ISIN occurs elsewhere', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(
        Response.json({ results: [{ portfolioId: '123' }] })
      )
      .mockResolvedValueOnce(
        new Response(
          '<loc>https://www.ishares.com/uk/individual/en/products/123/dynamic-product</loc>'
        )
      )
      .mockResolvedValueOnce(
        new Response(
          funds[0].isin +
            '{"value":"' +
            funds[1].isin +
            '","fullName":"fundHeader.fundName.productIsin"}'
        )
      );
    const discovery = new EtfCompositionDiscovery({ fetch });
    await expect(
      discovery.discover(
        'ISHARES',
        { name: 'iShares ETF', isin: funds[0].isin },
        'ANY.MI',
        1000
      )
    ).rejects.toThrow('ISIN mismatch');
  });

  it.each([
    { results: [] },
    { results: [{ portfolioId: '1' }, { portfolioId: '2' }] },
    { bad: true }
  ])(
    'rejects missing, ambiguous or malformed product searches',
    async (data) => {
      const fetch = jest.fn().mockResolvedValue(Response.json(data));
      await expect(
        new EtfCompositionDiscovery({ fetch }).discover(
          'ISHARES',
          { name: 'iShares ETF', isin: funds[0].isin },
          'ANY.MI',
          1000
        )
      ).rejects.toThrow();
    }
  );

  it('rejects invalid existing ISINs before requesting issuer data', async () => {
    const fetch = jest.fn();
    await expect(
      new EtfCompositionDiscovery({ fetch }).discover(
        'ISHARES',
        { name: 'iShares ETF', isin: 'IE00B4L5Y984' },
        'ANY.MI',
        1000
      )
    ).rejects.toThrow('UNAVAILABLE');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves unavailable resolution without a guessed ISIN', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 503 }));
    await expect(
      new EtfCompositionDiscovery({ fetch }).discover(
        'ISHARES',
        { name: 'iShares ETF', dataSource: 'YAHOO' },
        'ANY.MI',
        1000
      )
    ).rejects.toThrow('UNAVAILABLE');
  });

  it('does not resolve a missing ISIN from an unsupported data source', async () => {
    const fetch = jest.fn();
    await expect(
      new EtfCompositionDiscovery({ fetch }).discover(
        'ISHARES',
        { name: 'iShares ETF', dataSource: 'MANUAL' },
        'ANY',
        1000
      )
    ).rejects.toThrow('NOT_FOUND');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates timeouts without converting them to no matching fund', async () => {
    const fetch = jest
      .fn()
      .mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(
      new EtfCompositionDiscovery({ fetch }).discover(
        'ISHARES',
        { name: 'iShares ETF', isin: funds[0].isin },
        'ANY.MI',
        1000
      )
    ).rejects.toThrow('timeout');
  });
});

describe('missing ISIN through production discovery wiring', () => {
  it('verifies the exchange listing before discovering the official issuer product', async () => {
    const fixture = (name: string) =>
      readFileSync(
        join(
          __dirname,
          '../../isin-resolver/providers/justetf/__fixtures__',
          name
        ),
        'utf8'
      );
    const homepage =
      'Wicket.Ajax.ajax({"u":"/it/?0-mainSearchPanel-searchForm-query","e":"focus"}); Wicket.Ajax.ajax({"u":"/it/?1-mainSearchPanel-searchForm-query","e":"keyup"});';
    const fetch = jest.fn(async (url: string) => {
      if (url === 'https://www.justetf.com/it/') return new Response(homepage);
      if (url.includes('?0-main')) return new Response('<ajax-response/>');
      if (url.includes('?1-main'))
        return new Response(fixture('xaix-search.xml'));
      if (url.includes('etf-profile.html'))
        return new Response(fixture('xaix-profile.html'));
      return new Response(
        '<loc>https://etf.deutsche-am.com/en-gb/IE00BGV5VN51-artificial-intelligence-big-data-ucits-etf-1c/</loc>'
      );
    });
    const fund = await new EtfCompositionDiscovery({ fetch }).discover(
      'XTRACKERS',
      { name: 'Xtrackers ETF', dataSource: 'YAHOO' },
      'XAIX.MI',
      1000
    );
    expect(fund?.isin).toBe('IE00BGV5VN51');
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls[4][0]).toBe(
      'https://etf.deutsche-am.com/en-gb/sitemap.xml'
    );
  });
});
