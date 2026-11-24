import { IsharesDataEnhancerService } from './ishares.service';

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));

const PAGE =
  '<div webqc-datapoint="holdings-as-of-dates" data-as-of-dates="{&quot;all&quot;:20261120}"></div>';

const HEADER =
  'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Location,Market Currency';

function csv({
  country = 'United States',
  sector = 'Information Technology',
  equityValue = '100',
  cashValue = '0'
}: {
  country?: string;
  sector?: string;
  equityValue?: string;
  cashValue?: string;
} = {}): string {
  const equity = Number(equityValue);
  const cash = Number(cashValue);
  const total = equity + cash;

  return [
    'Fund Holdings as of,"20/Nov/2026"',
    '',
    HEADER,
    [
      'TEST',
      'Test Equity',
      sector,
      'Equity',
      equityValue,
      ((equity / total) * 100).toFixed(2),
      equityValue,
      country,
      'USD'
    ]
      .map((value) => `"${value}"`)
      .join(','),
    [
      'USD',
      'Cash',
      'Cash and/or Derivatives',
      'Cash',
      cashValue,
      ((cash / total) * 100).toFixed(2),
      cashValue,
      'United States',
      'USD'
    ]
      .map((value) => `"${value}"`)
      .join(',')
  ].join('\n');
}

describe('IsharesDataEnhancerService', () => {
  const fetchService = {
    fetch: jest.fn()
  };

  const configurationService = {
    get: jest.fn().mockReturnValue(30000)
  };

  const service = new IsharesDataEnhancerService(
    configurationService as any,
    fetchService as any
  );

  const profile = {
    assetClass: 'EQUITY' as const,
    assetSubClass: 'ETF' as const,
    dataSource: 'YAHOO' as const,
    isin: 'IE00B4L5Y983'
  };

  function mockResponses(document = csv()) {
    fetchService.fetch
      .mockResolvedValueOnce(new Response(PAGE))
      .mockResolvedValueOnce(
        new Response(document, {
          headers: { 'Content-Type': 'text/csv' }
        })
      );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockResponses();
  });

  it('populates missing countries and sectors', async () => {
    const result = await service.enhance({
      response: { ...profile },
      symbol: 'SWDA.MI'
    });

    expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);

    expect(result.sectors).toEqual([{ name: 'Technology', weight: 1 }]);

    expect(fetchService.fetch).toHaveBeenCalledTimes(2);
  });

  it('uses the dynamically discovered holdings date', async () => {
    await service.enhance({
      response: { ...profile },
      symbol: 'SWDA.MI'
    });

    const url = new URL(fetchService.fetch.mock.calls[1][0]);

    expect(url.searchParams.get('portfolioId')).toBe('251882');
    expect(url.searchParams.get('asOfDate')).toBe('20261120');
    expect(url.searchParams.get('component')).toBe('holdings');
  });

  it('preserves existing countries', async () => {
    const countries = [{ code: 'DE', weight: 1 }];

    const result = await service.enhance({
      response: {
        ...profile,
        countries
      } as any,
      symbol: 'SWDA.MI'
    });

    expect(result.countries).toEqual(countries);
    expect(result.sectors).toEqual([{ name: 'Technology', weight: 1 }]);
  });

  it('preserves existing sectors', async () => {
    const sectors = [{ name: 'Energy', weight: 1 }];

    const result = await service.enhance({
      response: {
        ...profile,
        sectors
      } as any,
      symbol: 'SWDA.MI'
    });

    expect(result.sectors).toEqual(sectors);
    expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);
  });

  it('skips requests when both distributions exist', async () => {
    await service.enhance({
      response: {
        ...profile,
        countries: [{ code: 'US', weight: 1 }],
        sectors: [{ name: 'Technology', weight: 1 }]
      } as any,
      symbol: 'SWDA.MI'
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it('accepts verified Yahoo symbols without ISIN', async () => {
    const result = await service.enhance({
      response: { ...profile, isin: undefined },
      symbol: 'IWDA.AS'
    });

    expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);
  });

  it('rejects conflicting ISINs', async () => {
    await service.enhance({
      response: {
        ...profile,
        isin: 'IE00BTJRMP35'
      },
      symbol: 'SWDA.MI'
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it('rejects unrelated symbols', async () => {
    await service.enhance({
      response: { ...profile },
      symbol: 'XMME.MI'
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it('rejects non-ETF assets', async () => {
    await service.enhance({
      response: {
        ...profile,
        assetSubClass: 'STOCK'
      } as any,
      symbol: 'SWDA.MI'
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it('rejects unverified sources without ISIN', async () => {
    await service.enhance({
      response: {
        ...profile,
        dataSource: 'MANUAL',
        isin: undefined
      } as any,
      symbol: 'SWDA.MI'
    });

    expect(fetchService.fetch).not.toHaveBeenCalled();
  });

  it('preserves valid countries when sectors are unclassified', async () => {
    fetchService.fetch.mockReset();
    mockResponses(csv({ sector: 'Unknown' }));

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'SWDA.MI'
    });

    expect(result.countries).toEqual([{ code: 'US', weight: 1 }]);
    expect(result.sectors).toBeUndefined();
  });

  it('preserves valid sectors when countries are unclassified', async () => {
    fetchService.fetch.mockReset();
    mockResponses(csv({ country: '-' }));

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'SWDA.MI'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toEqual([{ name: 'Technology', weight: 1 }]);
  });

  it('rejects insufficient coverage independently', async () => {
    fetchService.fetch.mockReset();
    mockResponses(
      csv({
        equityValue: '90',
        cashValue: '10'
      })
    );

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'SWDA.MI'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });

  it('preserves data on HTTP errors', async () => {
    fetchService.fetch.mockReset();
    fetchService.fetch.mockResolvedValue(new Response(null, { status: 503 }));

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'SWDA.MI'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });

  it('preserves data on invalid CSV', async () => {
    fetchService.fetch.mockReset();
    mockResponses('invalid CSV');

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'SWDA.MI'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });

  it('preserves data on document date mismatch', async () => {
    fetchService.fetch.mockReset();
    mockResponses(csv().replace('20/Nov/2026', '19/Nov/2026'));

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'SWDA.MI'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });

  it('preserves data when the second request fails', async () => {
    fetchService.fetch.mockReset();
    fetchService.fetch
      .mockResolvedValueOnce(new Response(PAGE))
      .mockRejectedValueOnce(new Error('Network unavailable'));

    const result = await service.enhance({
      response: { ...profile },
      symbol: 'SWDA.MI'
    });

    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });
});
