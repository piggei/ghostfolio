import { IsinResolverService } from '@ghostfolio/api/services/data-provider/isin-resolver/isin-resolver.service';

import { EtfCompositionDiscovery } from '../etf-composition.discovery';
import amundiFixture from './fixtures/amundi.json';
import invescoCountry from './fixtures/invesco-country.json';
import invescoSector from './fixtures/invesco-sector.json';
import {
  AmundiProduct,
  parseAmundiAllocation,
  parseInvescoAllocation,
  fetchAmundiProduct,
  fetchInvescoScope
} from './issuer-api.client';
import {
  AmundiDataEnhancerService,
  InvescoDataEnhancerService
} from './issuer-api.service';

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));

const INVESCO_ISIN = 'IE00B3YCGJ38';
const AMUNDI_ISIN = 'LU0908500753';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const product = () => clone(amundiFixture.products[0]) as AmundiProduct;
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200 });

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(new Date('2026-11-25T12:00:00Z'));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('official issuer allocation parsers', () => {
  it.each([[], [null], [product(), product()], [{ productId: INVESCO_ISIN }]])(
    'rejects malformed Amundi product response %j',
    async (...products) => {
      await expect(
        fetchAmundiProduct(async () => json({ products }), AMUNDI_ISIN)
      ).rejects.toThrow();
    }
  );
  it('parses Invesco index geography without assuming a US-only fund', () => {
    const result = parseInvescoAllocation(
      invescoCountry,
      INVESCO_ISIN,
      'countries'
    );
    expect(result.countries).toEqual([
      { code: 'US', weight: 0.998 },
      { code: 'CH', weight: 0.001 },
      { code: 'NL', weight: 0.001 }
    ]);
  });
  it('maps Invesco camelCase sectors and retains the unclassified residual', () => {
    const result = parseInvescoAllocation(
      invescoSector,
      INVESCO_ISIN,
      'sectors'
    );
    expect(result.sectors).toContainEqual({
      name: 'Technology',
      weight: 0.396
    });
    expect(result.sectors).toContainEqual({ name: 'Other', weight: 0.034 });
    expect(result.sectorCoverage).toBeCloseTo(0.999);
  });
  it.each(['countries', 'sectors'] as const)(
    'parses Amundi %s as decimal weights',
    (dimension) => {
      const result = parseAmundiAllocation(product(), AMUNDI_ISIN, dimension);
      expect(result[dimension].length).toBeGreaterThan(5);
      expect(
        dimension === 'countries'
          ? result.countryCoverage
          : result.sectorCoverage
      ).toBeGreaterThan(0.99);
    }
  );
  it('uses index exposure for synthetic Amundi funds, never the collateral basket', () => {
    const p = product();
    p.characteristics.FUND_REPLICATION_METHODOLOGY = 'Indirect(Swap Based)';
    p.breakDowns!.find(
      (x) => x.aggregationField === 'FUND_COUNTRIES'
    )!.breakDownData = [{ aggregationName: 'Japan', weight: 1 }];
    p.breakDowns!.find(
      (x) => x.aggregationField === 'INDEX_COUNTRIES'
    )!.breakDownData = [{ aggregationName: 'United States', weight: 1 }];
    expect(
      parseAmundiAllocation(p, AMUNDI_ISIN, 'countries').countries
    ).toEqual([{ code: 'US', weight: 1 }]);
  });
  it('does not scale an incomplete allocation to 100%', () => {
    const data = {
      ...invescoCountry,
      holdingWeights: [{ name: 'UnitedStates', value: 70 }]
    };
    expect(
      parseInvescoAllocation(data, INVESCO_ISIN, 'countries').countryCoverage
    ).toBe(0.7);
  });
  it.each(
    [
      undefined,
      null,
      [],
      [{ name: 'UnitedStates', value: -1 }],
      [{ name: 'UnitedStates', value: '100' }],
      [{ name: 'UnitedStates', value: 101 }],
      [{ name: 'UnitedStates', value: NaN }],
      [
        { name: 'UnitedStates', value: 80 },
        { name: 'Japan', value: 80 }
      ],
      [
        { name: 'Japan', value: 50 },
        { name: 'Japan', value: 50 }
      ]
    ].map((rows) => ({ rows }))
  )('rejects invalid Invesco allocation %j', ({ rows }) => {
    expect(() =>
      parseInvescoAllocation(
        { ...invescoCountry, holdingWeights: rows },
        INVESCO_ISIN,
        'countries'
      )
    ).toThrow();
  });
  it.each(['2020-01-01', '2099-01-01', 'invalid', undefined])(
    'rejects invalid allocation date %s',
    (effectiveDate) => {
      expect(() =>
        parseInvescoAllocation(
          { ...invescoCountry, effectiveDate },
          INVESCO_ISIN,
          'countries'
        )
      ).toThrow();
      const p = product();
      p.characteristics.FUND_BREAKDOWNS_AS_OF_DATE = effectiveDate;
      expect(() =>
        parseAmundiAllocation(p, AMUNDI_ISIN, 'countries')
      ).toThrow();
    }
  );
  it('rejects source identity mismatches', () => {
    expect(() =>
      parseInvescoAllocation(invescoCountry, AMUNDI_ISIN, 'countries')
    ).toThrow();
    expect(() =>
      parseAmundiAllocation(product(), INVESCO_ISIN, 'countries')
    ).toThrow();
    const p = product();
    p.characteristics.ISIN = INVESCO_ISIN;
    expect(() => parseAmundiAllocation(p, AMUNDI_ISIN, 'countries')).toThrow();
  });
  it.each([
    'missing',
    'duplicate',
    'invalid weight',
    'unknown replication',
    'wrong asset class'
  ])('rejects Amundi %s', (mode) => {
    const p = product();
    if (mode === 'missing') p.breakDowns = [];
    if (mode === 'duplicate')
      p.breakDowns!.push(
        p.breakDowns!.find((x) => x.aggregationField === 'FUND_COUNTRIES')!
      );
    if (mode === 'invalid weight')
      p.breakDowns!.find(
        (x) => x.aggregationField === 'FUND_COUNTRIES'
      )!.breakDownData[0].weight = -1;
    if (mode === 'unknown replication')
      p.characteristics.FUND_REPLICATION_METHODOLOGY = 'unknown';
    if (mode === 'wrong asset class')
      p.characteristics.ASSET_CLASS = 'Fixed Income';
    expect(() => parseAmundiAllocation(p, AMUNDI_ISIN, 'countries')).toThrow();
  });
  it.each([
    ['Synthetic', 'index'],
    ['Physical', 'fund']
  ] as const)(
    'selects Invesco %s exposure',
    async (replicationMethod, scope) => {
      expect(
        await fetchInvescoScope(
          async () =>
            json({
              isin: INVESCO_ISIN,
              effectiveDate: '2026-11-25',
              replicationMethod
            }),
          INVESCO_ISIN
        )
      ).toBe(scope);
    }
  );
  it.each([
    { isin: AMUNDI_ISIN, replicationMethod: 'Synthetic' },
    { isin: INVESCO_ISIN, replicationMethod: 'unknown' }
  ])('rejects invalid Invesco metadata %j', async (data) => {
    await expect(
      fetchInvescoScope(
        async () => json({ ...data, effectiveDate: '2026-11-25' }),
        INVESCO_ISIN
      )
    ).rejects.toThrow();
  });
});

describe('issuer enhancement safeguards', () => {
  const profile = (
    name = 'Invesco ETF',
    isin: string | null = INVESCO_ISIN
  ) => ({
    name,
    isin,
    assetClass: 'EQUITY' as const,
    assetSubClass: 'ETF' as const,
    dataSource: 'YAHOO' as const
  });
  const invescoFetch = (failCountry = false, failSector = false) =>
    jest.fn(async (url: string) => {
      if (url.includes('fundDetails'))
        return json({
          isin: INVESCO_ISIN,
          effectiveDate: '2026-11-25',
          replicationMethod: 'Synthetic'
        });
      if (url.includes('breakdown=country')) {
        if (failCountry) throw new Error('timeout');
        return json(invescoCountry);
      }
      if (url.includes('breakdown=sector')) {
        if (failSector) return new Response('', { status: 503 });
        return json(invescoSector);
      }
      throw new Error('Unexpected URL ' + url);
    });
  it('enhances Invesco through the verified index endpoints', async () => {
    const fetch = invescoFetch();
    const result = await new InvescoDataEnhancerService(
      { get: () => 5000 } as any,
      { fetch } as any
    ).enhance({ response: profile(), symbol: 'SPXS.MI' });
    expect(result.countries).toHaveLength(3);
    expect(result.sectors).toHaveLength(10);
    expect(
      fetch.mock.calls.every(([url]) => !url.includes('/weightedHoldings/fund'))
    ).toBe(true);
  });
  it.each([true, false])(
    'retains the independent valid dimension when country failure is %s',
    async (failCountry) => {
      const result = await new InvescoDataEnhancerService(
        { get: () => 5000 } as any,
        { fetch: invescoFetch(failCountry, !failCountry) } as any
      ).enhance({ response: profile(), symbol: 'SPXS.MI' });
      expect(result[failCountry ? 'sectors' : 'countries']).toBeDefined();
      expect(result[failCountry ? 'countries' : 'sectors']).toBeUndefined();
    }
  );
  it('retains complete sectors while filling missing countries', async () => {
    const sectors = [{ name: 'Technology', weight: 1 }];
    const result = await new InvescoDataEnhancerService(
      { get: () => 5000 } as any,
      { fetch: invescoFetch() } as any
    ).enhance({ response: { ...profile(), sectors }, symbol: 'SPXS.MI' });
    expect(result.sectors).toEqual(sectors);
    expect(result.countries).toHaveLength(3);
  });
  it.each(['complete', 'stock', 'other issuer', 'invalid ISIN'])(
    'skips %s safely',
    async (mode) => {
      const fetch = jest.fn();
      const response: any = profile();
      if (mode === 'complete') {
        response.countries = [{ code: 'US', weight: 1 }];
        response.sectors = [{ name: 'Technology', weight: 1 }];
      }
      if (mode === 'stock') response.assetSubClass = 'STOCK';
      if (mode === 'other issuer') response.name = 'Amundi ETF';
      if (mode === 'invalid ISIN') response.isin = 'IE0000000000';
      const before = clone(response);
      const result = await new InvescoDataEnhancerService(
        { get: () => 5000 } as any,
        { fetch } as any
      ).enhance({ response, symbol: 'SPXS.MI' });
      expect(result).toEqual(before);
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it('does not discard Amundi countries when sectors are missing', async () => {
    const p = product();
    p.breakDowns = p.breakDowns!.filter(
      (x) => x.aggregationField === 'FUND_COUNTRIES'
    );
    const result = await new AmundiDataEnhancerService(
      { get: () => 5000 } as any,
      { fetch: async () => json({ products: [p] }) } as any
    ).enhance({
      response: profile('Amundi ETF', AMUNDI_ISIN),
      symbol: 'MEUD.MI'
    });
    expect(result.countries).toBeDefined();
    expect(result.sectors).toBeUndefined();
  });
});

describe('official Amundi listing fallback', () => {
  const response = {
    name: 'Amundi ETF',
    assetClass: 'EQUITY' as const,
    assetSubClass: 'ETF' as const,
    dataSource: 'YAHOO' as const
  };
  const discovery = (products: AmundiProduct[]) =>
    new EtfCompositionDiscovery({
      fetch: async (url) =>
        String(url).includes('amundietf.lu')
          ? json({ products })
          : new Response('', { status: 503 })
    } as any);
  it('does not override an ambiguous primary identity', async () => {
    jest
      .spyOn(IsinResolverService.prototype, 'resolve')
      .mockResolvedValue({ status: 'AMBIGUOUS' });
    const fetch = jest.fn();
    await expect(
      new EtfCompositionDiscovery({ fetch } as any).discover(
        'AMUNDI',
        response,
        'MEUD.MI',
        5000
      )
    ).rejects.toThrow('AMBIGUOUS');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not use listing fallback for a stored invalid identity', async () => {
    const fetch = jest.fn();
    await expect(
      new EtfCompositionDiscovery({ fetch } as any).discover(
        'AMUNDI',
        { ...response, isin: 'INVALID' },
        'MEUD.MI',
        5000
      )
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('resolves an exact RIC and market from the official catalogue', async () => {
    expect(
      await discovery([product()]).discover('AMUNDI', response, 'MEUD.MI', 5000)
    ).toEqual({ isin: AMUNDI_ISIN });
  });
  it.each([
    'wrong ric',
    'wrong market',
    'duplicate product',
    'duplicate listing',
    'invalid isin',
    'wrong asset'
  ])('rejects %s', async (mode) => {
    const p = product();
    p.characteristics.LISTINGS = [
      { ric: 'MEUD.MI', exchangePlace: 'Borsa Italiana' }
    ];
    const products = [p];
    if (mode === 'wrong ric') p.characteristics.LISTINGS[0].ric = 'MEUD.PA';
    if (mode === 'wrong market')
      p.characteristics.LISTINGS[0].exchangePlace = 'LSE';
    if (mode === 'duplicate product') products.push(clone(p));
    if (mode === 'duplicate listing')
      p.characteristics.LISTINGS.push(clone(p.characteristics.LISTINGS[0]));
    if (mode === 'invalid isin') {
      p.productId = 'LU0000000000';
      p.characteristics.ISIN = p.productId;
    }
    if (mode === 'wrong asset') p.characteristics.ASSET_CLASS = 'Fixed Income';
    await expect(
      discovery(products).discover('AMUNDI', response, 'MEUD.MI', 5000)
    ).rejects.toThrow();
  });
});
