import { fetchWisdomtreeFactsheet } from './wisdomtree.client';
import { parseWisdomtreePdf } from './wisdomtree.parser';
import { WisdomtreeDataEnhancerService } from './wisdomtree.service';

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));
jest.mock('./wisdomtree.client', () => ({
  fetchWisdomtreeFactsheet: jest.fn()
}));
jest.mock('./wisdomtree.parser', () => ({ parseWisdomtreePdf: jest.fn() }));

const composition = {
  isin: 'IE00BZ56SW52',
  asOfDate: new Date().toISOString().slice(0, 10),
  countries: Array.from({ length: 10 }, (_, i) => ({
    code: `C${i}`,
    weight: i === 0 ? 0.9323 : 0
  })),
  sectors: Array.from({ length: 10 }, (_, i) => ({
    name: `S${i}`,
    weight: i === 0 ? 0.9997 : 0
  })),
  countryCoverage: 0.9323,
  sectorCoverage: 0.9997,
  missingCountryWeight: 0.0677
};
const profile = {
  assetClass: 'EQUITY' as const,
  assetSubClass: 'ETF' as const,
  dataSource: 'YAHOO' as const
};
const service = new WisdomtreeDataEnhancerService(
  { get: jest.fn().mockReturnValue(30000) } as any,
  { fetch: jest.fn() } as any
);

beforeEach(() => {
  jest.clearAllMocks();
  (fetchWisdomtreeFactsheet as jest.Mock).mockResolvedValue(
    new Uint8Array([1])
  );
  (parseWisdomtreePdf as jest.Mock).mockResolvedValue({ ...composition });
});

describe('WisdomTree enhancer', () => {
  it('adds the top ten countries without rescaling', async () => {
    const result = await service.enhance({
      response: { ...profile },
      symbol: 'GGRA.MI'
    });
    expect(result.countries).toEqual(composition.countries);
    expect(result.sectors).toEqual(composition.sectors);
  });

  it('preserves existing sectors', async () => {
    const sectors = [{ name: 'Energy', weight: 1 }];
    const result = await service.enhance({
      response: { ...profile, sectors } as any,
      symbol: 'GGRA.MI'
    });
    expect(result.sectors).toBe(sectors);
    expect(result.countries).toHaveLength(10);
  });

  it('skips unsupported symbols and conflicting ISINs', async () => {
    await service.enhance({ response: { ...profile }, symbol: 'SWDA.MI' });
    await service.enhance({
      response: { ...profile, isin: 'IE00B4L5Y983' },
      symbol: 'GGRA.MI'
    });
    expect(fetchWisdomtreeFactsheet).not.toHaveBeenCalled();
  });

  it('rejects stale factsheets', async () => {
    (parseWisdomtreePdf as jest.Mock).mockResolvedValue({
      ...composition,
      asOfDate: '2016-10-14'
    });
    const result = await service.enhance({
      response: { ...profile },
      symbol: 'GGRA.MI'
    });
    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });

  it('preserves existing countries when factsheet is stale', async () => {
    const countries = [{ code: 'US', weight: 1 }];

    (parseWisdomtreePdf as jest.Mock).mockResolvedValue({
      ...composition,
      asOfDate: '2016-10-14'
    });

    const result = await service.enhance({
      response: { ...profile, countries } as any,
      symbol: 'GGRA.MI'
    });

    expect(result.countries).toBe(countries);
    expect(result.sectors).toBeUndefined();
  });

  it('preserves existing sectors when factsheet is stale', async () => {
    const sectors = [{ name: 'Technology', weight: 1 }];

    (parseWisdomtreePdf as jest.Mock).mockResolvedValue({
      ...composition,
      asOfDate: '2016-10-14'
    });

    const result = await service.enhance({
      response: { ...profile, sectors } as any,
      symbol: 'GGRA.MI'
    });

    expect(result.sectors).toBe(sectors);
    expect(result.countries).toBeUndefined();
  });

  it('rejects insufficient coverage independently', async () => {
    (parseWisdomtreePdf as jest.Mock).mockResolvedValue({
      ...composition,
      countryCoverage: 0.8,
      sectorCoverage: 0.7
    });
    const result = await service.enhance({
      response: { ...profile },
      symbol: 'GGRA.MI'
    });
    expect(result.countries).toBeUndefined();
    expect(result.sectors).toBeUndefined();
  });
});
