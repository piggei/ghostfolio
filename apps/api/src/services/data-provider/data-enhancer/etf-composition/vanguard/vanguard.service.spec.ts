import { getEtfCompositionDiscovery } from '../etf-composition.discovery';
import { VanguardDataEnhancerService } from './vanguard.service';

jest.mock('../etf-composition.discovery', () => ({
  getEtfCompositionDiscovery: jest.fn()
}));

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));

const FUND_ISIN = 'IE00BK5BQT80';

function holding({
  country = 'US',
  sector = 'Information Technology',
  weight = 100
}: {
  country?: string;
  sector?: string;
  weight?: number;
} = {}) {
  return {
    effectiveDate: new Date().toISOString().slice(0, 10),
    bloombergIsoCountry: country,
    gicsSectorDescription: sector,
    marketValuePercentage: weight,
    securityType: 'EQ.STOCK'
  };
}

function graphqlResponse({
  items = [holding()],
  totalHoldings = items.length,
  lastItemKey = null
}: {
  items?: unknown[];
  totalHoldings?: number;
  lastItemKey?: string | null;
} = {}) {
  return {
    data: {
      borHoldings: [
        {
          holdings: {
            items,
            totalHoldings,
            lastItemKey
          }
        }
      ]
    }
  };
}

describe('VanguardDataEnhancerService', () => {
  const fetchService = {
    fetch: jest.fn()
  };

  const configurationService = {
    get: jest.fn().mockReturnValue(30000)
  };

  const service = new VanguardDataEnhancerService(
    configurationService as any,
    fetchService as any
  );

  const profile = {
    assetClass: 'EQUITY' as const,
    assetSubClass: 'ETF' as const,
    dataSource: 'YAHOO' as const,
    isin: FUND_ISIN
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getEtfCompositionDiscovery as jest.Mock).mockReturnValue({
      discover: jest.fn().mockImplementation(async (_issuer, response) => ({
        isin: response.isin ?? 'IE00BK5BQT80',
        portfolioId: '9679',
        pageUrl: 'https://www.ishares.com/uk/individual/en/products/9679/',
        holdingsUrl:
          'https://etf.deutsche-am.com/api/pdp/en-gb/etf/discovered/holdings'
      }))
    });

    fetchService.fetch.mockResolvedValue(Response.json(graphqlResponse()));
  });

  it('populates missing countries and sectors', async () => {
    const result = await service.enhance({
      response: { ...profile },
      symbol: 'VWCE.DE'
    });

    expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);

    expect(result.sectors).toEqual([{ name: 'Technology', weight: 1 }]);

    expect(fetchService.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends the expected GraphQL request', async () => {
    await service.enhance({
      response: { ...profile },
      symbol: 'VWCE.DE'
    });

    const [url, options] = fetchService.fetch.mock.calls[0];

    expect(url).toBe('https://www.ie.vanguard/gpx/graphql');
    expect(options.method).toBe('POST');
    expect(options.headers['x-consumer-id']).toBe('ie0');

    const body = JSON.parse(options.body);

    expect(body.variables).toEqual({
      portIds: ['9679'],
      limit: 1500,
      lastItemKey: null
    });
  });

  it('retrieves multiple pages before updating the profile', async () => {
    fetchService.fetch
      .mockResolvedValueOnce(
        Response.json(
          graphqlResponse({
            items: [holding({ weight: 60 })],
            totalHoldings: 2,
            lastItemKey: 'next'
          })
        )
      )
      .mockResolvedValueOnce(
        Response.json(
          graphqlResponse({
            items: [holding({ weight: 40 })],
            totalHoldings: 2,
            lastItemKey: null
          })
        )
      );

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'VWCE.DE'
    });

    expect(fetchService.fetch).toHaveBeenCalledTimes(2);

    expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);

    const secondBody = JSON.parse(fetchService.fetch.mock.calls[1][1].body);

    expect(secondBody.variables.lastItemKey).toBe('next');
  });

  it('preserves existing countries', async () => {
    const countries = [{ code: 'DE', weight: 1 }];

    const result = await service.enhance({
      response: {
        ...profile,
        countries
      } as any,
      symbol: 'VWCE.DE'
    });

    expect(result.countries).toEqual(countries);
    expect(result.sectors).toEqual([{ name: 'Technology', weight: 1 }]);
  });

  it('skips requests when both distributions exist', async () => {
    const result = await service.enhance({
      response: {
        ...profile,
        countries: [{ code: 'DE', weight: 1 }],
        sectors: [{ name: 'Technology', weight: 1 }]
      } as any,
      symbol: 'VWCE.DE'
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
    expect(result.countries).toHaveLength(1);
  });

  it('uses an identity supplied by discovery', async () => {
    const result = await service.enhance({
      response: {
        ...profile,
        isin: undefined
      },
      symbol: 'VWCE.MI'
    });

    expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);
  });

  it('rejects non-ETF assets', async () => {
    await service.enhance({
      response: {
        ...profile,
        assetSubClass: 'STOCK'
      } as any,
      symbol: 'VWCE.DE'
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it('preserves data on HTTP errors', async () => {
    fetchService.fetch.mockResolvedValue(new Response(null, { status: 503 }));

    const response = { ...profile };

    const result = await service.enhance({
      response,
      symbol: 'VWCE.DE'
    });

    expect(result).toEqual(response);
    expect(result.countries).toBeUndefined();
  });

  it('preserves data on GraphQL errors', async () => {
    fetchService.fetch.mockResolvedValue(
      Response.json({
        errors: [{ message: 'Unavailable' }],
        data: null
      })
    );

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'VWCE.DE'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });

  it('preserves data when pagination fails', async () => {
    fetchService.fetch.mockResolvedValue(
      Response.json(
        graphqlResponse({
          items: [holding({ weight: 50 })],
          totalHoldings: 2,
          lastItemKey: null
        })
      )
    );

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'VWCE.DE'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });

  it('preserves valid countries when sector coverage is insufficient', async () => {
    fetchService.fetch.mockResolvedValue(
      Response.json(
        graphqlResponse({
          items: [
            holding({
              country: 'US',
              sector: '',
              weight: 100
            })
          ]
        })
      )
    );

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'VWCE.DE'
    });

    expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);
    expect(result.sectors).toBeUndefined();
  });

  describe('independent country and sector coverage', () => {
    it('updates countries when sectors are insufficient', async () => {
      fetchService.fetch.mockResolvedValue(
        Response.json(
          graphqlResponse({
            items: [holding({ country: 'US', sector: '', weight: 100 })]
          })
        )
      );

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'VWCE.DE'
      });

      expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);
      expect(result.sectors).toBeUndefined();
    });

    it('updates sectors when countries are insufficient', async () => {
      fetchService.fetch.mockResolvedValue(
        Response.json(
          graphqlResponse({
            items: [holding({ country: '', sector: 'Information Technology' })]
          })
        )
      );

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'VWCE.DE'
      });

      expect(result.countries).toBeUndefined();
      expect(result.sectors).toEqual([{ name: 'Technology', weight: 1 }]);
    });

    it('preserves both fields when coverage is insufficient', async () => {
      fetchService.fetch.mockResolvedValue(
        Response.json(
          graphqlResponse({
            items: [holding({ country: '', sector: '' })]
          })
        )
      );

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'VWCE.DE'
      });

      expect(result.countries).toBeUndefined();
      expect(result.sectors).toBeUndefined();
    });

    it('does not invent countries for unclassified exposure', async () => {
      fetchService.fetch.mockResolvedValue(
        Response.json(
          graphqlResponse({
            items: [holding({ country: '', sector: 'Information Technology' })]
          })
        )
      );

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'VWCE.DE'
      });

      expect(result.countries).toBeUndefined();
      expect(result.sectors).toEqual([{ name: 'Technology', weight: 1 }]);
    });
  });

  describe('independent representability of country and sector exposures', () => {
    function mockHoldings(items: unknown[]) {
      fetchService.fetch.mockResolvedValue(
        Response.json(graphqlResponse({ items }))
      );
    }

    it('preserves sectors when countries exceed 100 percent', async () => {
      mockHoldings([
        holding({
          country: 'US',
          sector: 'Information Technology',
          weight: 99
        }),
        holding({
          country: 'JP',
          sector: '',
          weight: 1.5
        }),
        holding({
          country: '',
          sector: '',
          weight: -0.5
        })
      ]);

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'VWCE.DE'
      });

      expect(result.countries).toBeUndefined();
      expect(result.sectors).toEqual([{ name: 'Technology', weight: 0.99 }]);
      expect(fetchService.fetch).toHaveBeenCalledTimes(1);
    });

    it('preserves countries when sectors exceed 100 percent', async () => {
      mockHoldings([
        holding({
          country: 'US',
          sector: 'Information Technology',
          weight: 99
        }),
        holding({
          country: '',
          sector: 'Financials',
          weight: 1.5
        }),
        holding({
          country: '',
          sector: '',
          weight: -0.5
        })
      ]);

      const result = await service.enhance({
        response: { ...profile },
        symbol: 'VWCE.DE'
      });

      expect(result.countries).toEqual([{ code: 'US', weight: 0.99 }]);
      expect(result.sectors).toBeUndefined();
      expect(fetchService.fetch).toHaveBeenCalledTimes(1);
    });

    it('preserves the profile when both distributions exceed 100 percent', async () => {
      mockHoldings([
        holding({
          country: 'US',
          sector: 'Information Technology',
          weight: 100.5
        }),
        holding({
          country: '',
          sector: '',
          weight: -0.5
        })
      ]);

      const response = { ...profile };

      const result = await service.enhance({
        response,
        symbol: 'VWCE.DE'
      });

      expect(result).toEqual(response);
      expect(result.countries).toBeUndefined();
      expect(result.sectors).toBeUndefined();
      expect(fetchService.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('preserves data on network failure', async () => {
    fetchService.fetch.mockRejectedValue(new Error('Network unavailable'));

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'VWCE.DE'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });
});
