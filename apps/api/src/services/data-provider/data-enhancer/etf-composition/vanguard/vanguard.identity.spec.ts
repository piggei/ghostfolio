import { IsinResolverService } from '@ghostfolio/api/services/data-provider/isin-resolver/isin-resolver.service';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EtfCompositionDiscovery } from '../etf-composition.discovery';
import { VanguardDataEnhancerService } from './vanguard.service';

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));

const recordedCatalogue = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/official-listings.json'), 'utf8')
);
const incompleteProfile = readFileSync(
  join(__dirname, '__fixtures__/vusa-justetf-profile.html'),
  'utf8'
);
const profile = {
  name: 'Vanguard S&P 500 UCITS ETF',
  dataSource: 'YAHOO' as const,
  assetClass: 'EQUITY' as const,
  assetSubClass: 'ETF' as const
};
const isin = 'IE00B3XXRP09';

function createHttp(
  catalogue = structuredClone(recordedCatalogue),
  reproduceJustEtf = false
) {
  const fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://www.justetf.com')) {
        if (!reproduceJustEtf) return new Response('', { status: 503 });
        if (url === 'https://www.justetf.com/it/')
          return new Response(
            'Wicket.Ajax.ajax({"u":"/it/?0-mainSearchPanel-searchForm-query","e":"focus"});' +
              'Wicket.Ajax.ajax({"u":"/it/?1-mainSearchPanel-searchForm-query","e":"keyup"});'
          );
        if (url.includes('?0-main')) return new Response('<ajax-response/>');
        if (url.includes('?1-main'))
          return new Response(
            '<?xml version="1.0"?><ajax-response><component><![CDATA[<table data-testid="quick-search-etfs-table"><tr data-testid="quick-search-result-etf-' +
              isin +
              '"><td><a href="/it/etf-profile.html?isin=' +
              isin +
              '">ETF</a></td><td>' +
              isin +
              '</td></tr></table>]]></component></ajax-response>'
          );
        return new Response(incompleteProfile);
      }
      if (url.endsWith('/home'))
        return new Response('"portIds":"9503,9509,9679,"');
      const body = JSON.parse(String(init?.body));
      if (body.query.includes('FundsHoldingsQuery'))
        return Response.json({
          data: {
            borHoldings: [
              {
                holdings: {
                  totalHoldings: 1,
                  lastItemKey: null,
                  items: [
                    {
                      effectiveDate: new Date().toISOString().slice(0, 10),
                      sedol1: 'TEST',
                      securityType: 'EQ.STOCK',
                      bloombergIsoCountry: 'US',
                      gicsSectorDescription: 'Information Technology',
                      marketValuePercentage: 100
                    }
                  ]
                }
              }
            ]
          }
        });
      return Response.json(catalogue);
    }
  );
  return { fetch, discovery: new EtfCompositionDiscovery({ fetch }) };
}

afterEach(() => jest.restoreAllMocks());

describe('official Vanguard identity fallback', () => {
  it('recovers missing ISIN and countries when the recorded justETF Milan RIC is empty', async () => {
    const http = createHttp(undefined, true);
    const sectors = [{ name: 'Energy', weight: 1 }];
    const service = new VanguardDataEnhancerService(
      { get: () => 1000 } as any,
      http as any
    );
    const result = await service.enhance({
      symbol: 'VUSA.MI',
      response: { ...profile, isin: null, countries: null, sectors }
    });
    expect(result.isin).toBe(isin);
    expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);
    expect(result.sectors).toBe(sectors);
    expect(http.fetch).toHaveBeenCalledTimes(7);
    expect(String(http.fetch.mock.calls[3][0])).toContain(
      'etf-profile.html?isin=' + isin
    );
    expect(
      http.fetch.mock.calls.filter(([url]) => String(url).endsWith('/graphql'))
    ).toHaveLength(2);
    const metadata = JSON.parse(
      String(
        http.fetch.mock.calls.find(([url]) =>
          String(url).endsWith('/graphql')
        )![1]!.body
      )
    );
    expect(metadata.query).toContain('stockExchangeMarketIdentifierCode');
    expect(metadata.query).toContain('RIC');
    expect(metadata.variables.portIds).toEqual(['9503', '9509', '9679']);
  });

  it.each([
    ['VUSA.MI', 'IE00B3XXRP09', '9503'],
    ['VUKE.MI', 'IE00B810Q511', '9509'],
    ['VWCE.MI', 'IE00BK5BQT80', '9679'],
    ['VUSA.DE', 'IE00B3XXRP09', '9503'],
    ['VWCE.AS', 'IE00BK5BQT80', '9679'],
    ['VWRP.L', 'IE00BK5BQT80', '9679']
  ])(
    'uses official RIC and market for %s without a fund whitelist',
    async (symbol, expectedIsin, portfolioId) => {
      const { discovery } = createHttp();
      await expect(
        discovery.discover('VANGUARD', profile, symbol, 1000)
      ).resolves.toEqual({ isin: expectedIsin, portfolioId });
    }
  );

  it('does not look up justETF when an existing valid ISIN is available', async () => {
    const { fetch, discovery } = createHttp();
    await expect(
      discovery.discover('VANGUARD', { ...profile, isin }, 'VUSA.MI', 1000)
    ).resolves.toEqual({ isin, portfolioId: '9503' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.some(([url]) => String(url).includes('justetf'))
    ).toBe(false);
  });

  it('does not replace an invalid existing ISIN', async () => {
    const { fetch, discovery } = createHttp();
    await expect(
      discovery.discover(
        'VANGUARD',
        { ...profile, isin: 'IE00B3XXRP00' },
        'VUSA.MI',
        1000
      )
    ).rejects.toThrow('UNAVAILABLE');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves an ambiguous primary resolution instead of selecting an issuer candidate', async () => {
    jest
      .spyOn(IsinResolverService.prototype, 'resolve')
      .mockResolvedValueOnce({ status: 'AMBIGUOUS' });
    const { fetch, discovery } = createHttp();
    await expect(
      discovery.discover('VANGUARD', profile, 'VUSA.MI', 1000)
    ).rejects.toThrow('AMBIGUOUS');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not infer Yahoo symbols for unsupported data sources', async () => {
    const { fetch, discovery } = createHttp();
    await expect(
      discovery.discover(
        'VANGUARD',
        { ...profile, dataSource: 'MANUAL' },
        'VUSA.MI',
        1000
      )
    ).rejects.toThrow('NOT_FOUND');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not probe unsupported listing markets', async () => {
    const { fetch, discovery } = createHttp();
    await expect(
      discovery.discover('VANGUARD', profile, 'VUSA.UNKNOWN', 1000)
    ).rejects.toThrow('Unsupported Vanguard listing market');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    'wrong market',
    'different exchange suffix',
    'invalid checksum',
    'ambiguous fund',
    'duplicate listing',
    'ambiguous ISIN',
    'not an ETF',
    'not equity'
  ])('rejects %s', async (scenario) => {
    const catalogue = structuredClone(recordedCatalogue);
    const fund = catalogue.data.funds.find(
      (item) => item.profile.portId === '9503'
    ).profile;
    const listing = fund.listings.find(
      (item) => item.stockExchangeMarketIdentifierCode === 'ETFP'
    );
    if (scenario === 'wrong market')
      listing.stockExchangeMarketIdentifierCode = 'XLON';
    if (scenario === 'different exchange suffix')
      listing.identifiers[0].altIdValue = 'VUSA.AS';
    if (scenario === 'invalid checksum')
      fund.identifiers[0].altIdValue = 'IE00B3XXRP00';
    if (scenario === 'ambiguous fund') {
      const other = structuredClone(
        catalogue.data.funds.find((item) => item.profile.portId === '9679')
      );
      other.profile.listings = [structuredClone(listing)];
      catalogue.data.funds.push(other);
    }
    if (scenario === 'duplicate listing')
      fund.listings.push(structuredClone(listing));
    if (scenario === 'ambiguous ISIN')
      fund.identifiers.push({ altId: 'ISIN', altIdValue: 'IE00BK5BQT80' });
    if (scenario === 'not an ETF') fund.polarisPdtTypeIndicator = 'FUND';
    if (scenario === 'not equity')
      fund.assetClassificationLevel1 = 'Fixed Income';
    const { discovery } = createHttp(catalogue);
    await expect(
      discovery.discover('VANGUARD', profile, 'VUSA.MI', 1000)
    ).rejects.toThrow();
  });

  it('keeps identity caches separate for the same ticker on different markets', async () => {
    const catalogue = structuredClone(recordedCatalogue);
    const first = catalogue.data.funds.find(
      (item) => item.profile.portId === '9503'
    ).profile;
    const second = catalogue.data.funds.find(
      (item) => item.profile.portId === '9679'
    ).profile;
    first.listings = [
      {
        stockExchangeMarketIdentifierCode: 'ETFP',
        identifiers: [{ altId: 'RIC', altIdValue: 'SHARED.MI' }]
      }
    ];
    second.listings = [
      {
        stockExchangeMarketIdentifierCode: 'XETR',
        identifiers: [{ altId: 'RIC', altIdValue: 'SHARED.DE' }]
      }
    ];
    const { discovery, fetch } = createHttp(catalogue);
    expect(
      (await discovery.discover('VANGUARD', profile, 'SHARED.MI', 1000))?.isin
    ).toBe(isin);
    expect(
      (await discovery.discover('VANGUARD', profile, 'SHARED.DE', 1000))?.isin
    ).toBe('IE00BK5BQT80');
    expect(
      fetch.mock.calls.filter(([url]) => String(url).endsWith('/home'))
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(([url]) => String(url).endsWith('/graphql'))
    ).toHaveLength(1);
  });

  it('preserves the profile on an unavailable official catalogue', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 503 }));
    const response = { ...profile, isin: null, countries: null };
    const service = new VanguardDataEnhancerService(
      { get: () => 1000 } as any,
      { fetch } as any
    );
    expect(await service.enhance({ symbol: 'VUSA.MI', response })).toEqual(
      response
    );
  });
});
