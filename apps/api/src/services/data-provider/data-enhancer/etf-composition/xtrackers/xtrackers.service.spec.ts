import { XtrackersDataEnhancerService } from './xtrackers.service';

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

  it.each([
    ['another symbol', 'VWCE.MI', 'IE00BTJRMP35'],
    ['wrong ISIN', 'XMME.MI', 'IE00B4L5Y983'],
    ['unverified alias', 'XMME', undefined]
  ])('skips %s', async (_, symbol, isin) => {
    await service.enhance({
      response: { ...profile, isin },
      symbol
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it('accepts verified Yahoo symbol without ISIN', async () => {
    fetchService.fetch.mockResolvedValue(Response.json(holdings()));

    const result = await service.enhance({
      response: { ...profile, isin: undefined },
      symbol: 'XMME.MI'
    });

    expect(result.countries).toEqual([{ code: 'TW', weight: 1 }]);
    expect(fetchService.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an unverified data source without ISIN', async () => {
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

  it('rejects a conflicting ISIN for Yahoo', async () => {
    await service.enhance({
      response: {
        ...profile,
        isin: 'IE00B4L5Y983'
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
