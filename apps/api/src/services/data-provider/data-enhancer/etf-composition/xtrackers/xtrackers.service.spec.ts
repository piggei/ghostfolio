import { getEtfCompositionDiscovery } from '../etf-composition.discovery';
import { XtrackersDataEnhancerService } from './xtrackers.service';

jest.mock('../etf-composition.discovery', () => ({
  getEtfCompositionDiscovery: jest.fn()
}));

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => {
  return {
    FetchService: jest.fn()
  };
});

const columns = [
  { key: 'column_1', value: '% Weight' },
  { key: 'column_3', value: 'Country' },
  { key: 'column_4', value: 'Industry' }
];

function holdings(weight = 100) {
  return {
    tables: [
      {
        disclaimers: [
          {
            text:
              'Source: DWS ' +
              new Date()
                .toISOString()
                .slice(0, 10)
                .split('-')
                .reverse()
                .join('/')
          }
        ],
        downloadLinks: [
          {
            href: 'https://etf.deutsche-am.com/etfdata/export/GBR/ENG/excel/product/constituent/IE00BTJRMP35/'
          }
        ],
        columns,
        values: [
          {
            column_1: { sortValue: weight },
            column_3: { value: 'Taiwan' },
            column_4: { value: 'Information Technology' }
          }
        ]
      }
    ]
  };
}

describe('XtrackersDataEnhancerService', () => {
  let fetchService: { fetch: jest.Mock };
  let service: XtrackersDataEnhancerService;

  const profile = {
    assetClass: 'EQUITY' as const,
    assetSubClass: 'ETF' as const,
    dataSource: 'YAHOO' as const,
    isin: 'IE00BTJRMP35'
  };

  beforeEach(() => {
    (getEtfCompositionDiscovery as jest.Mock).mockReturnValue({
      discover: jest.fn().mockImplementation(async (_issuer, response) => ({
        isin: response.isin ?? 'IE00BTJRMP35',
        portfolioId: '',
        pageUrl: 'https://www.ishares.com/uk/individual/en/products//',
        holdingsUrl:
          'https://etf.deutsche-am.com/api/pdp/en-gb/etf/discovered/holdings'
      }))
    });
    fetchService = { fetch: jest.fn() };
    service = new XtrackersDataEnhancerService(
      { get: jest.fn().mockReturnValue(1000) } as any,
      fetchService as any
    );
  });

  it('populates missing countries and sectors', async () => {
    fetchService.fetch.mockResolvedValue(Response.json(holdings()));

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'XMME.MI'
    });

    expect(result.countries).toEqual([{ code: 'TW', weight: 1 }]);
    expect(result.sectors).toEqual([{ name: 'Technology', weight: 1 }]);
    expect(fetchService.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves existing countries', async () => {
    fetchService.fetch.mockResolvedValue(Response.json(holdings()));

    const countries = [{ code: 'IT', weight: 1 }];

    const result = await service.enhance({
      response: { ...profile, countries },
      symbol: 'XMME.MI'
    });

    expect(result.countries).toEqual(countries);
    expect(result.sectors).toHaveLength(1);
  });

  it('skips requests when both distributions exist', async () => {
    const response = {
      ...profile,
      countries: [{ code: 'IT', weight: 1 }],
      sectors: [{ name: 'Technology', weight: 1 }]
    };

    expect(await service.enhance({ response, symbol: 'XMME.MI' })).toEqual(
      response
    );

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it('uses an identity supplied by discovery', async () => {
    fetchService.fetch.mockResolvedValue(Response.json(holdings()));

    const result = await service.enhance({
      response: { ...profile, isin: undefined },
      symbol: 'XMME.MI'
    });

    expect(result.countries).toEqual([{ code: 'TW', weight: 1 }]);
    expect(fetchService.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves data when identity discovery fails', async () => {
    (getEtfCompositionDiscovery as jest.Mock).mockReturnValue({
      discover: jest.fn().mockRejectedValue(new Error('NOT_FOUND'))
    });
    await service.enhance({
      response: {
        ...profile,
        dataSource: 'MANUAL',
        isin: undefined
      },
      symbol: 'XMME.MI'
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it('skips non-ETF assets', async () => {
    await service.enhance({
      response: { ...profile, assetSubClass: 'STOCK' },
      symbol: 'XMME.MI'
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP error', new Response(null, { status: 502 })],
    ['malformed data', Response.json({ tables: [] })],
    ['insufficient coverage', Response.json(holdings(20))]
  ])('preserves data on %s', async (_, response) => {
    fetchService.fetch.mockResolvedValue(response);

    const original = {
      ...profile,
      countries: [{ code: 'IT', weight: 1 }]
    };

    const result = await service.enhance({
      response: original,
      symbol: 'XMME.MI'
    });

    expect(result.countries).toEqual([{ code: 'IT', weight: 1 }]);
    expect(result.sectors).toBeUndefined();
  });

  describe('independent country and sector coverage', () => {
    function composition({
      country,
      sector,
      weight = 100
    }: {
      country: string;
      sector: string;
      weight?: number;
    }) {
      const data = holdings(weight);
      const row = data.tables[0].values[0];

      row.column_3.value = country;
      row.column_4.value = sector;

      return data;
    }

    it('preserves valid countries without saving an entirely unknown sector distribution', async () => {
      fetchService.fetch.mockResolvedValue(
        Response.json(
          composition({
            country: 'Taiwan',
            sector: 'Unknown'
          })
        )
      );

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'XMME.MI'
      });

      expect(result.countries).toEqual([{ code: 'TW', weight: 1 }]);
      expect(result.sectors).toBeUndefined();
    });

    it('updates sectors when countries are insufficient', async () => {
      fetchService.fetch.mockResolvedValue(
        Response.json(
          composition({
            country: 'Taiwan',
            sector: 'Information Technology',
            weight: 90
          })
        )
      );

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'XMME.MI'
      });

      expect(result.countries).toBeUndefined();
      expect(result.sectors).toBeUndefined();
    });

    it('preserves both fields when coverage is insufficient', async () => {
      fetchService.fetch.mockResolvedValue(
        Response.json(
          composition({
            country: '',
            sector: '',
            weight: 20
          })
        )
      );

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'XMME.MI'
      });

      expect(result.countries).toBeUndefined();
      expect(result.sectors).toBeUndefined();
    });

    it('keeps unknown country exposure unclassified', async () => {
      fetchService.fetch.mockResolvedValue(
        Response.json(
          composition({
            country: 'Other',
            sector: 'Information Technology'
          })
        )
      );

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'XMME.MI'
      });

      expect(result.countries).toBeUndefined();
      expect(result.sectors).toEqual([{ name: 'Technology', weight: 1 }]);
    });
  });

  it('preserves data on network failure', async () => {
    fetchService.fetch.mockRejectedValue(new Error('Network unavailable'));

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'XMME.MI'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });
});
