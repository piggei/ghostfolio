import { IsharesDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/etf-composition/ishares/ishares.service';
import { XtrackersDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/etf-composition/xtrackers/xtrackers.service';
import {
  DATA_GATHERING_QUEUE_PRIORITY_HIGH,
  GATHER_HISTORICAL_MARKET_DATA_COOLDOWN_IN_MS
} from '@ghostfolio/common/config';
import { parseDate } from '@ghostfolio/common/helper';

import { DataGatheringService } from './data-gathering.service';

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));

describe('DataGatheringService', () => {
  let dataGatheringQueue: { addBulk: jest.Mock; clean: jest.Mock };
  let dataGatheringService: DataGatheringService;
  let dataProviderService: {
    getAssetProfiles: jest.Mock;
    getHistoricalRaw: jest.Mock;
  };
  let prismaService: {
    marketData: { groupBy: jest.Mock; upsert: jest.Mock };
    symbolProfile: { upsert: jest.Mock };
  };
  let symbolProfileService: { getSymbolProfiles: jest.Mock };

  beforeEach(() => {
    dataGatheringQueue = {
      addBulk: jest.fn().mockResolvedValue([]),
      clean: jest.fn().mockResolvedValue([])
    };
    dataProviderService = {
      getAssetProfiles: jest.fn(),
      getHistoricalRaw: jest.fn()
    };
    prismaService = {
      marketData: {
        groupBy: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({})
      },
      symbolProfile: {
        upsert: jest.fn().mockResolvedValue({})
      }
    };
    symbolProfileService = {
      getSymbolProfiles: jest.fn().mockResolvedValue([])
    };

    dataGatheringService = new DataGatheringService(
      [],
      dataGatheringQueue as any,
      dataProviderService as any,
      null,
      null,
      prismaService as any,
      null,
      symbolProfileService as any
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('gatherAssetProfiles', () => {
    const assetProfileIdentifier = { dataSource: 'YAHOO', symbol: 'VWCE.DE' };

    it('retains non-ETF identifier update behavior', async () => {
      const identifier = { dataSource: 'YAHOO' as const, symbol: 'AAPL' };
      symbolProfileService.getSymbolProfiles.mockResolvedValue([
        { ...identifier, assetSubClass: 'STOCK', isin: 'US0378331005' }
      ]);
      dataProviderService.getAssetProfiles.mockResolvedValue({
        AAPL: {
          ...identifier,
          assetSubClass: 'STOCK',
          isin: 'INCOMING',
          name: 'Incoming name'
        }
      });
      await dataGatheringService.gatherAssetProfiles([identifier]);
      expect(
        prismaService.symbolProfile.upsert.mock.calls[0][0].update.isin
      ).toBe('INCOMING');
    });

    it('keeps the stored lists if the lists of the asset profile are empty', async () => {
      dataProviderService.getAssetProfiles.mockResolvedValue({
        'VWCE.DE': {
          ...assetProfileIdentifier,
          countries: [],
          holdings: [],
          sectors: []
        }
      });

      await dataGatheringService.gatherAssetProfiles([
        assetProfileIdentifier as any
      ]);

      const { create, update } =
        prismaService.symbolProfile.upsert.mock.calls[0][0];

      expect(create.holdings).toEqual([]);
      expect(update.countries).toBeUndefined();
      expect(update.holdings).toBeUndefined();
      expect(update.sectors).toBeUndefined();
    });

    it('updates the stored lists if the lists of the asset profile have items', async () => {
      const countries = [{ code: 'US', weight: 1 }];
      const holdings = [{ name: 'NVIDIA Corp.', weight: 0.05 }];
      const sectors = [{ name: 'Technology', weight: 1 }];

      dataProviderService.getAssetProfiles.mockResolvedValue({
        'VWCE.DE': {
          ...assetProfileIdentifier,
          countries,
          holdings,
          sectors
        }
      });

      await dataGatheringService.gatherAssetProfiles([
        assetProfileIdentifier as any
      ]);

      const { update } = prismaService.symbolProfile.upsert.mock.calls[0][0];

      expect(update).toEqual(
        expect.objectContaining({ countries, holdings, sectors })
      );
    });
  });

  describe('ETF enhancer integration', () => {
    const identifier = {
      dataSource: 'YAHOO' as const,
      symbol: 'XMME.MI'
    };

    const countries = [{ code: 'TW', weight: 0.25237036 }];
    const sectors = [{ name: 'Technology', weight: 0.36779921 }];

    beforeEach(() => {
      dataProviderService.getAssetProfiles.mockResolvedValue({
        'XMME.MI': {
          ...identifier,
          assetClass: 'EQUITY',
          assetSubClass: 'ETF'
        }
      });
    });

    it('persists ETF distributions supplied by an enhancer', async () => {
      const enhance = jest.fn().mockImplementation(async ({ response }) => ({
        ...response,
        countries,
        sectors
      }));

      const service = new DataGatheringService(
        [{ enhance, getName: () => 'XTRACKERS' }] as any,
        dataGatheringQueue as any,
        dataProviderService as any,
        null,
        null,
        prismaService as any,
        null,
        symbolProfileService as any
      );

      await service.gatherAssetProfiles([identifier]);

      expect(enhance).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'XMME.MI',
          response: expect.objectContaining(identifier)
        })
      );

      expect(prismaService.symbolProfile.upsert).toHaveBeenCalledTimes(1);

      const { update } = prismaService.symbolProfile.upsert.mock.calls[0][0];

      expect(update.countries).toEqual(countries);
      expect(update.sectors).toEqual(sectors);
    });

    it('preserves original profile data when an enhancer fails', async () => {
      const enhance = jest.fn().mockRejectedValue(new Error('DWS unavailable'));

      const service = new DataGatheringService(
        [{ enhance, getName: () => 'XTRACKERS' }] as any,
        dataGatheringQueue as any,
        dataProviderService as any,
        null,
        null,
        prismaService as any,
        null,
        symbolProfileService as any
      );

      await service.gatherAssetProfiles([identifier]);

      expect(enhance).toHaveBeenCalledTimes(1);
      expect(prismaService.symbolProfile.upsert).toHaveBeenCalledTimes(1);

      const { update } = prismaService.symbolProfile.upsert.mock.calls[0][0];

      expect(update.countries).toBeUndefined();
      expect(update.sectors).toBeUndefined();
    });
  });

  describe('ETF stored profile protection', () => {
    it.each([0.5, 1])(
      'preserves saved identity and complete sectors across earlier enhancer mutations (%s coverage)',
      async (incomingWeight) => {
        const identifier = { dataSource: 'YAHOO' as const, symbol: 'ANY.MI' };
        const sectors = [{ name: 'Technology', weight: 0.99 }];
        symbolProfileService.getSymbolProfiles.mockResolvedValue([
          {
            ...identifier,
            isin: 'IE00B4L5Y983',
            assetClass: 'EQUITY',
            assetSubClass: 'ETF',
            sectors
          }
        ]);
        dataProviderService.getAssetProfiles.mockResolvedValue({
          asset: {
            ...identifier,
            name: 'iShares ETF',
            sectors: [{ name: 'Energy', weight: 0.4 }]
          }
        });
        const enhancer = {
          getName: () => 'YAHOO',
          enhance: jest.fn(async ({ response }) => {
            response.isin = 'IE00BTJRMP35';
            response.sectors = [{ name: 'Energy', weight: incomingWeight }];
            return response;
          })
        };
        const service = new DataGatheringService(
          [enhancer] as any,
          dataGatheringQueue as any,
          dataProviderService as any,
          null,
          null,
          prismaService as any,
          null,
          symbolProfileService as any
        );
        await service.gatherAssetProfiles([identifier]);
        const { update } = prismaService.symbolProfile.upsert.mock.calls[0][0];
        expect(update.isin).toBe('IE00B4L5Y983');
        expect(update.sectors).toEqual(sectors);
      }
    );
  });

  it.each(['INVESCO', 'AMUNDI'])(
    'retains verified identity from the %s issuer enhancer',
    async (issuer) => {
      const identifier = { dataSource: 'YAHOO' as const, symbol: 'ANY.MI' };
      const sectors = [{ name: 'Technology', weight: 1 }];
      symbolProfileService.getSymbolProfiles.mockResolvedValue([
        { ...identifier, assetClass: 'EQUITY', assetSubClass: 'ETF', sectors }
      ]);
      dataProviderService.getAssetProfiles.mockResolvedValue({
        asset: { ...identifier, name: issuer + ' ETF' }
      });
      const enhancer = {
        getName: () => issuer,
        enhance: async ({ response }) => ({
          ...response,
          isin: 'IE00B3YCGJ38',
          countries: [{ code: 'US', weight: 1 }]
        })
      };
      const service = new DataGatheringService(
        [enhancer] as any,
        dataGatheringQueue as any,
        dataProviderService as any,
        null,
        null,
        prismaService as any,
        null,
        symbolProfileService as any
      );
      await service.gatherAssetProfiles([identifier]);
      const { update } = prismaService.symbolProfile.upsert.mock.calls[0][0];
      expect(update.isin).toBe('IE00B3YCGJ38');
      expect(update.sectors).toEqual(sectors);
      expect(update.countries).toEqual([{ code: 'US', weight: 1 }]);
    }
  );

  describe('Xtrackers real enhancer integration', () => {
    it('processes real Xtrackers enhancer through data gathering', async () => {
      const fetchService = {
        fetch: jest.fn().mockResolvedValue(
          Response.json({
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
                columns: [
                  { key: 'column_1', value: '% Weight' },
                  { key: 'column_3', value: 'Country' },
                  { key: 'column_4', value: 'Industry' }
                ],
                values: [
                  {
                    column_1: { sortValue: 70 },
                    column_3: { value: 'Taiwan' },
                    column_4: { value: 'Information Technology' }
                  },
                  {
                    column_1: { sortValue: 30 },
                    column_3: { value: 'Korea, Republic of' },
                    column_4: { value: 'Financials' }
                  }
                ]
              }
            ]
          })
        )
      };

      const enhancer = new XtrackersDataEnhancerService(
        { get: jest.fn().mockReturnValue(1000) } as any,
        fetchService as any
      );

      const service = new DataGatheringService(
        [enhancer],
        dataGatheringQueue as any,
        dataProviderService as any,
        null,
        null,
        prismaService as any,
        null,
        symbolProfileService as any
      );

      const identifier = {
        dataSource: 'YAHOO' as const,
        symbol: 'XMME.MI'
      };

      dataProviderService.getAssetProfiles.mockResolvedValue({
        'XMME.MI': {
          ...identifier,
          assetClass: 'EQUITY',
          assetSubClass: 'ETF',
          name: 'Xtrackers ETF',
          isin: 'IE00BTJRMP35'
        }
      });

      fetchService.fetch.mockResolvedValueOnce(
        new Response(
          '<loc>https://etf.deutsche-am.com/en-gb/IE00BTJRMP35-msci-emerging-markets-ucits-etf-1c/</loc>'
        )
      );
      await service.gatherAssetProfiles([identifier]);

      expect(fetchService.fetch).toHaveBeenCalledTimes(2);
      expect(fetchService.fetch.mock.calls[0][0]).toBe(
        'https://etf.deutsche-am.com/en-gb/sitemap.xml'
      );
      expect(fetchService.fetch.mock.calls[1][0]).toContain('IE00BTJRMP35');

      expect(prismaService.symbolProfile.upsert).toHaveBeenCalledTimes(1);

      const { create, update } =
        prismaService.symbolProfile.upsert.mock.calls[0][0];

      const expectedCountries = [
        { code: 'TW', weight: 0.7 },
        { code: 'KR', weight: 0.3 }
      ];

      const expectedSectors = [
        { name: 'Technology', weight: 0.7 },
        { name: 'Financial Services', weight: 0.3 }
      ];

      expect(create.countries).toEqual(expectedCountries);
      expect(update.countries).toEqual(expectedCountries);
      expect(update.sectors).toEqual(expectedSectors);
    });
  });

  describe('iShares real enhancer integration', () => {
    beforeEach(() =>
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse('2026-11-25T12:00:00Z'))
    );
    afterEach(() => jest.restoreAllMocks());
    const identifier = {
      dataSource: 'YAHOO' as const,
      symbol: 'SWDA.MI'
    };

    const page =
      '<div webqc-datapoint="holdings-as-of-dates" data-as-of-dates="{&quot;all&quot;:20261120}"></div>';

    const csv = [
      'Fund Holdings as of,"20/Nov/2026"',
      '',
      'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Location,Market Currency',
      '"AAPL","APPLE","Information Technology","Equity","600.00","60.00","600.00","United States","USD"',
      '"ASML","ASML HOLDING","Information Technology","Equity","390.00","39.00","390.00","Netherlands","EUR"',
      '"USD","USD CASH","Cash and/or Derivatives","Cash","10.00","1.00","10.00","United States","USD"'
    ].join('\n');

    function createService(fetch: jest.Mock) {
      const enhancer = new IsharesDataEnhancerService(
        { get: jest.fn().mockReturnValue(30000) } as any,
        { fetch } as any
      );

      return new DataGatheringService(
        [enhancer],
        dataGatheringQueue as any,
        dataProviderService as any,
        null,
        null,
        prismaService as any,
        null,
        symbolProfileService as any
      );
    }

    beforeEach(() => {
      dataProviderService.getAssetProfiles.mockResolvedValue({
        'SWDA.MI': {
          ...identifier,
          assetClass: 'EQUITY',
          assetSubClass: 'ETF',
          name: 'iShares ETF',
          isin: 'IE00B4L5Y983'
        }
      });
    });

    it('persists iShares allocations without equity renormalization', async () => {
      const fetch = jest
        .fn()
        .mockResolvedValueOnce(
          Response.json({ results: [{ portfolioId: '251882' }] })
        )
        .mockResolvedValueOnce(
          new Response(
            '<loc>https://www.ishares.com/uk/individual/en/products/251882/dynamic-product</loc>'
          )
        )
        .mockResolvedValueOnce(
          new Response(
            '{&quot;value&quot;:&quot;IE00B4L5Y983&quot;,&quot;fullName&quot;:&quot;fundHeader.fundName.productIsin&quot;}'
          )
        )
        .mockResolvedValueOnce(new Response(page))
        .mockResolvedValueOnce(
          new Response(csv, {
            headers: { 'Content-Type': 'text/csv' }
          })
        );

      const service = createService(fetch);

      await service.gatherAssetProfiles([identifier]);

      expect(fetch).toHaveBeenCalledTimes(5);

      const documentUrl = new URL(fetch.mock.calls[4][0]);

      expect(documentUrl.searchParams.get('portfolioId')).toBe('251882');
      expect(documentUrl.searchParams.get('asOfDate')).toBe('20261120');

      expect(prismaService.symbolProfile.upsert).toHaveBeenCalledTimes(1);

      const { create, update } =
        prismaService.symbolProfile.upsert.mock.calls[0][0];

      const expectedCountries = [
        { code: 'US', weight: 0.6 },
        { code: 'NL', weight: 0.39 }
      ];

      const expectedSectors = [{ name: 'Technology', weight: 0.99 }];

      expect(create.countries).toEqual(expectedCountries);
      expect(create.sectors).toEqual(expectedSectors);
      expect(update.countries).toEqual(expectedCountries);
      expect(update.sectors).toEqual(expectedSectors);
    });

    it('preserves existing countries and fills missing sectors', async () => {
      const existingCountries = [{ code: 'DE', weight: 1 }];

      dataProviderService.getAssetProfiles.mockResolvedValue({
        'SWDA.MI': {
          ...identifier,
          assetClass: 'EQUITY',
          assetSubClass: 'ETF',
          name: 'iShares ETF',
          isin: 'IE00B4L5Y983',
          countries: existingCountries
        }
      });

      const fetch = jest
        .fn()
        .mockResolvedValueOnce(
          Response.json({ results: [{ portfolioId: '251882' }] })
        )
        .mockResolvedValueOnce(
          new Response(
            '<loc>https://www.ishares.com/uk/individual/en/products/251882/dynamic-product</loc>'
          )
        )
        .mockResolvedValueOnce(
          new Response(
            '{&quot;value&quot;:&quot;IE00B4L5Y983&quot;,&quot;fullName&quot;:&quot;fundHeader.fundName.productIsin&quot;}'
          )
        )
        .mockResolvedValueOnce(new Response(page))
        .mockResolvedValueOnce(
          new Response(csv, {
            headers: { 'Content-Type': 'text/csv' }
          })
        );

      await createService(fetch).gatherAssetProfiles([identifier]);

      const { update } = prismaService.symbolProfile.upsert.mock.calls[0][0];

      expect(update.countries).toEqual(existingCountries);
      expect(update.sectors).toEqual([{ name: 'Technology', weight: 0.99 }]);
    });

    it('does not persist partial allocations after a document failure', async () => {
      const fetch = jest
        .fn()
        .mockResolvedValueOnce(
          Response.json({ results: [{ portfolioId: '251882' }] })
        )
        .mockResolvedValueOnce(
          new Response(
            '<loc>https://www.ishares.com/uk/individual/en/products/251882/dynamic-product</loc>'
          )
        )
        .mockResolvedValueOnce(
          new Response(
            '{&quot;value&quot;:&quot;IE00B4L5Y983&quot;,&quot;fullName&quot;:&quot;fundHeader.fundName.productIsin&quot;}'
          )
        )
        .mockResolvedValueOnce(new Response(page))
        .mockRejectedValueOnce(new Error('BlackRock unavailable'));

      await createService(fetch).gatherAssetProfiles([identifier]);

      expect(fetch).toHaveBeenCalledTimes(5);
      expect(prismaService.symbolProfile.upsert).toHaveBeenCalledTimes(1);

      const { create, update } =
        prismaService.symbolProfile.upsert.mock.calls[0][0];

      expect(create.countries).toBeUndefined();
      expect(create.sectors).toBeUndefined();
      expect(update.countries).toBeUndefined();
      expect(update.sectors).toBeUndefined();
    });

    describe('symbol mapping', () => {
      const mappedIdentifier = {
        dataSource: 'YAHOO' as const,
        symbol: 'CUSTOM.MI'
      };

      function mockMappedProfile(isin?: string) {
        dataProviderService.getAssetProfiles.mockResolvedValue({
          'CUSTOM.MI': {
            ...mappedIdentifier,
            assetClass: 'EQUITY',
            assetSubClass: 'ETF',
            name: 'iShares ETF',
            isin
          }
        });

        symbolProfileService.getSymbolProfiles.mockResolvedValue([
          {
            ...mappedIdentifier,
            symbolMapping: {
              ISHARES: 'SWDA.MI'
            }
          }
        ]);
      }

      function mockDocument() {
        return jest
          .fn()
          .mockResolvedValueOnce(
            Response.json({ results: [{ portfolioId: '251882' }] })
          )
          .mockResolvedValueOnce(
            new Response(
              '<loc>https://www.ishares.com/uk/individual/en/products/251882/dynamic-product</loc>'
            )
          )
          .mockResolvedValueOnce(
            new Response(
              '{&quot;value&quot;:&quot;IE00B4L5Y983&quot;,&quot;fullName&quot;:&quot;fundHeader.fundName.productIsin&quot;}'
            )
          )
          .mockResolvedValueOnce(new Response(page))
          .mockResolvedValueOnce(
            new Response(csv, {
              headers: { 'Content-Type': 'text/csv' }
            })
          );
      }

      it('uses the mapped iShares symbol while persisting the original symbol', async () => {
        mockMappedProfile('IE00B4L5Y983');

        const fetch = mockDocument();

        await createService(fetch).gatherAssetProfiles([mappedIdentifier]);

        expect(fetch).toHaveBeenCalledTimes(5);

        const { create, update, where } =
          prismaService.symbolProfile.upsert.mock.calls[0][0];

        expect(create.symbol).toBe('CUSTOM.MI');
        expect(where).toEqual(
          expect.objectContaining({
            dataSource_symbol: expect.objectContaining({
              symbol: 'CUSTOM.MI'
            })
          })
        );

        expect(create.countries).toEqual([
          { code: 'US', weight: 0.6 },
          { code: 'NL', weight: 0.39 }
        ]);

        expect(update.sectors).toEqual([{ name: 'Technology', weight: 0.99 }]);
      });

      it('preserves a mapped profile when no official issuer product matches its ISIN', async () => {
        mockMappedProfile('IE00BTJRMP35');

        const fetch = jest
          .fn()
          .mockResolvedValue(Response.json({ results: [] }));

        await createService(fetch).gatherAssetProfiles([mappedIdentifier]);

        expect(fetch).toHaveBeenCalledTimes(1);

        const { create, update } =
          prismaService.symbolProfile.upsert.mock.calls[0][0];

        expect(create.symbol).toBe('CUSTOM.MI');
        expect(create.countries).toBeUndefined();
        expect(create.sectors).toBeUndefined();
        expect(update.countries).toBeUndefined();
        expect(update.sectors).toBeUndefined();
      });

      it('preserves a mapped profile if missing ISIN cannot be verified', async () => {
        mockMappedProfile();
        const fetch = jest
          .fn()
          .mockResolvedValue(new Response('<html>No search callback</html>'));
        await createService(fetch).gatherAssetProfiles([mappedIdentifier]);
        expect(fetch).toHaveBeenCalledTimes(1);
        const { create } = prismaService.symbolProfile.upsert.mock.calls[0][0];
        expect(create.symbol).toBe('CUSTOM.MI');
        expect(create.countries).toBeUndefined();
        expect(create.isin).toBeUndefined();
      });
    });
  });

  describe('getAssetProfileIdentifiersWithRecentMarketData', () => {
    it('queries real market prices since the start of yesterday (UTC)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-24T14:00:00.000Z'));

      await dataGatheringService[
        'getAssetProfileIdentifiersWithRecentMarketData'
      ]();

      expect(prismaService.marketData.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            date: { gte: new Date('2026-08-23T00:00:00.000Z') },
            isCarriedForward: false,
            state: 'CLOSE'
          }
        })
      );
    });

    it('includes the Friday close when it runs on Saturday', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-22T14:00:00.000Z'));

      await dataGatheringService[
        'getAssetProfileIdentifiersWithRecentMarketData'
      ]();

      expect(prismaService.marketData.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: { gte: new Date('2026-08-21T00:00:00.000Z') }
          })
        })
      );
    });

    it('excludes the Friday close when it runs on Sunday', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-23T14:00:00.000Z'));

      await dataGatheringService[
        'getAssetProfileIdentifiersWithRecentMarketData'
      ]();

      expect(prismaService.marketData.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: { gte: new Date('2026-08-22T00:00:00.000Z') }
          })
        })
      );
    });

    it('maps the query result to asset profile identifiers', async () => {
      prismaService.marketData.groupBy.mockResolvedValue([
        { dataSource: 'COINGECKO', symbol: 'bitcoin' },
        { dataSource: 'YAHOO', symbol: 'AAPL' }
      ]);

      const assetProfileIdentifiers =
        await dataGatheringService[
          'getAssetProfileIdentifiersWithRecentMarketData'
        ]();

      expect(assetProfileIdentifiers).toEqual([
        { dataSource: 'COINGECKO', symbol: 'bitcoin' },
        { dataSource: 'YAHOO', symbol: 'AAPL' }
      ]);
    });
  });

  describe('gatherRecentMarketData', () => {
    it('queries the asset profiles with recent market data once and reuses them', async () => {
      const assetProfileIdentifiersWithRecentMarketData = [
        { dataSource: 'COINGECKO', symbol: 'bitcoin' }
      ];

      prismaService.marketData.groupBy.mockResolvedValue(
        assetProfileIdentifiersWithRecentMarketData
      );

      const getCurrencies7D = jest
        .spyOn(dataGatheringService as any, 'getCurrencies7D')
        .mockReturnValue([]);
      const getSymbols7D = jest
        .spyOn(dataGatheringService as any, 'getSymbols7D')
        .mockResolvedValue([]);

      await dataGatheringService.gatherRecentMarketData();

      expect(prismaService.marketData.groupBy).toHaveBeenCalledTimes(1);

      expect(getCurrencies7D).toHaveBeenCalledWith({
        assetProfileIdentifiersWithRecentMarketData
      });

      expect(getSymbols7D).toHaveBeenCalledWith({
        assetProfileIdentifiersWithRecentMarketData,
        withUserSubscription: true
      });

      expect(getSymbols7D).toHaveBeenCalledWith({
        assetProfileIdentifiersWithRecentMarketData,
        withUserSubscription: false
      });
    });

    it('expires completed jobs which are older than the cooldown', async () => {
      jest
        .spyOn(dataGatheringService as any, 'getCurrencies7D')
        .mockReturnValue([]);
      jest
        .spyOn(dataGatheringService as any, 'getSymbols7D')
        .mockResolvedValue([]);

      await dataGatheringService.gatherRecentMarketData();

      expect(dataGatheringQueue.clean).toHaveBeenCalledWith(
        GATHER_HISTORICAL_MARKET_DATA_COOLDOWN_IN_MS,
        'completed'
      );
    });

    it('retains its completed jobs for the duration of the cooldown', async () => {
      jest
        .spyOn(dataGatheringService as any, 'getCurrencies7D')
        .mockReturnValue([
          {
            dataSource: 'YAHOO',
            date: parseDate('2026-08-01'),
            symbol: 'AAPL'
          }
        ]);
      jest
        .spyOn(dataGatheringService as any, 'getSymbols7D')
        .mockResolvedValue([]);

      await dataGatheringService.gatherRecentMarketData();

      const [jobs] = dataGatheringQueue.addBulk.mock.calls[0];

      expect(jobs[0].opts.removeOnComplete).toEqual({
        age: GATHER_HISTORICAL_MARKET_DATA_COOLDOWN_IN_MS / 1000
      });
    });
  });

  describe('gatherSymbol', () => {
    beforeEach(() => {
      jest
        .spyOn(dataGatheringService as any, 'getSymbolsMax')
        .mockResolvedValue([
          {
            dataSource: 'YAHOO',
            date: parseDate('2026-08-01'),
            symbol: 'USDEUR'
          }
        ]);
    });

    it('does not apply the cooldown by default', async () => {
      await dataGatheringService.gatherSymbol({
        dataSource: 'YAHOO',
        symbol: 'USDEUR'
      });

      const [jobs] = dataGatheringQueue.addBulk.mock.calls[0];

      expect(jobs[0].opts.removeOnComplete).toBe(true);
    });

    it('retains its completed jobs for the duration of a given cooldown', async () => {
      await dataGatheringService.gatherSymbol({
        dataSource: 'YAHOO',
        removeOnComplete: {
          age: GATHER_HISTORICAL_MARKET_DATA_COOLDOWN_IN_MS / 1000
        },
        symbol: 'USDEUR'
      });

      const [jobs] = dataGatheringQueue.addBulk.mock.calls[0];

      expect(jobs[0].opts.removeOnComplete).toEqual({
        age: GATHER_HISTORICAL_MARKET_DATA_COOLDOWN_IN_MS / 1000
      });
    });
  });

  describe('gatherSymbols', () => {
    it('does not apply the cooldown to a manually triggered gathering', async () => {
      await dataGatheringService.gatherSymbols({
        dataGatheringItems: [
          {
            dataSource: 'YAHOO',
            date: parseDate('2026-08-01'),
            symbol: 'AAPL'
          }
        ],
        priority: DATA_GATHERING_QUEUE_PRIORITY_HIGH
      });

      const [jobs] = dataGatheringQueue.addBulk.mock.calls[0];

      expect(jobs[0].opts.removeOnComplete).toBe(true);
    });
  });

  describe('gatherSymbolForDate', () => {
    it('resets isCarriedForward on a previously carried forward market price', async () => {
      dataProviderService.getHistoricalRaw.mockResolvedValue({
        'YAHOO-AAPL': {
          '2026-08-22': { marketPrice: 100 }
        }
      });

      await dataGatheringService.gatherSymbolForDate({
        dataSource: 'YAHOO',
        date: parseDate('2026-08-22'),
        symbol: 'AAPL'
      });

      expect(prismaService.marketData.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ isCarriedForward: false }),
          update: { isCarriedForward: false, marketPrice: 100, state: 'CLOSE' }
        })
      );
    });

    it('sets the state to INTRADAY for today', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-22T14:00:00.000Z'));

      dataProviderService.getHistoricalRaw.mockResolvedValue({
        'YAHOO-AAPL': {
          '2026-08-22': { marketPrice: 100 }
        }
      });

      await dataGatheringService.gatherSymbolForDate({
        dataSource: 'YAHOO',
        date: parseDate('2026-08-22'),
        symbol: 'AAPL'
      });

      expect(prismaService.marketData.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ state: 'INTRADAY' })
        })
      );
    });

    it('returns the upserted market data', async () => {
      dataProviderService.getHistoricalRaw.mockResolvedValue({
        'YAHOO-AAPL': {
          '2026-08-22': { marketPrice: 100 }
        }
      });
      prismaService.marketData.upsert.mockResolvedValue({ marketPrice: 100 });

      const marketData = await dataGatheringService.gatherSymbolForDate({
        dataSource: 'YAHOO',
        date: parseDate('2026-08-22'),
        symbol: 'AAPL'
      });

      expect(marketData).toEqual({ marketPrice: 100 });
    });

    it('returns undefined if the data provider has no market price', async () => {
      dataProviderService.getHistoricalRaw.mockResolvedValue({});

      const marketData = await dataGatheringService.gatherSymbolForDate({
        dataSource: 'YAHOO',
        date: parseDate('2026-08-22'),
        symbol: 'AAPL'
      });

      expect(marketData).toBeUndefined();
    });
  });
});
