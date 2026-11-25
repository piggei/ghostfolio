import { IsinResolverService } from '@ghostfolio/api/services/data-provider/isin-resolver/isin-resolver.service';
import { JustEtfProvider } from '@ghostfolio/api/services/data-provider/isin-resolver/providers/justetf/justetf.provider';
import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';

import { SymbolProfile } from '@prisma/client';

type Issuer = 'ISHARES' | 'VANGUARD' | 'XTRACKERS' | 'WISDOMTREE';

export interface DiscoveredEtf {
  isin: string;
  portfolioId?: string;
  pageUrl?: string;
  holdingsUrl?: string;
}

const ISSUERS: Record<Issuer, RegExp> = {
  ISHARES: /\bishares\b/i,
  VANGUARD: /\bvanguard\b/i,
  XTRACKERS: /\b(?:xtrackers|db x-trackers)\b/i,
  WISDOMTREE: /\bwisdomtree\b/i
};

export class EtfCompositionDiscovery {
  private readonly cache = new Map<
    string,
    { expires: number; value: Promise<unknown> }
  >();

  public constructor(
    private readonly fetchService: Pick<FetchService, 'fetch'>
  ) {}

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const previous = this.cache.get(key);
    if (previous && previous.expires > Date.now())
      return previous.value as Promise<T>;
    if (this.cache.size >= 256)
      this.cache.delete(this.cache.keys().next().value!);
    const entry = { expires: Date.now() + 300000, value: load() };
    this.cache.set(key, entry);
    entry.value.catch(() => {
      if (this.cache.get(key) === entry) this.cache.delete(key);
    });
    return entry.value;
  }

  public async discover(
    issuer: Issuer,
    response: Partial<SymbolProfile>,
    symbol: string,
    timeout: number
  ): Promise<DiscoveredEtf | undefined> {
    // A name is a routing hint only. The official issuer must prove the ISIN.
    const matches = (Object.keys(ISSUERS) as Issuer[]).filter((key) =>
      ISSUERS[key].test(response.name ?? '')
    );
    if (matches.length !== 1 || matches[0] !== issuer) return undefined;
    const identity = await this.cached(
      'identity:' +
        JSON.stringify([response.dataSource, symbol, response.isin]),
      () =>
        new IsinResolverService().resolve({
          request: {
            dataSource: response.dataSource ?? 'MANUAL',
            symbol,
            isin: response.isin,
            name: response.name ?? undefined
          },
          provider: new JustEtfProvider({
            request: async (url, options) => {
              const result = await this.fetchService.fetch(url, {
                ...options,
                redirect: 'manual',
                signal: AbortSignal.timeout(timeout)
              });
              return {
                status: result.status,
                url: result.url,
                headers: result.headers,
                body: await result.text()
              };
            }
          })
        })
    );
    if (identity.status !== 'RESOLVED')
      throw new Error('ETF identity: ' + identity.status);
    const isin = identity.resolution.isin;
    return this.cached(issuer + ':' + isin, async () => {
      const get = async (url: string, init?: RequestInit) => {
        const result = await this.fetchService.fetch(url, {
          ...init,
          signal: AbortSignal.timeout(timeout)
        });
        if (!result.ok)
          throw new Error('Issuer discovery HTTP ' + result.status);
        return result;
      };
      if (issuer === 'WISDOMTREE') return { isin };
      if (issuer === 'ISHARES') {
        const query = new URLSearchParams({
          site: 'ishares-uk',
          locale: 'en-gb',
          rows: '10',
          start: '0',
          userType: 'individual',
          query: isin
        });
        const data = await (
          await get(
            'https://www.ishares.com/varnish-api/core-search/search/products?' +
              query.toString()
          )
        ).json();
        if (!Array.isArray(data.results))
          throw new Error('Malformed iShares search');
        const ids = [
          ...new Set<string>(
            data.results
              .map((item: { portfolioId?: string }) => item.portfolioId)
              .filter(
                (id: unknown): id is string =>
                  typeof id === 'string' && /^\d+$/.test(id)
              )
          )
        ];
        if (ids.length !== 1)
          throw new Error('Missing or ambiguous iShares product');
        const portfolioId = ids[0];
        const sitemap = await this.cached('ishares:sitemap', async () =>
          (await get('https://www.ishares.com/uk/product-sitemap.xml')).text()
        );
        const prefix =
          'https://www.ishares.com/uk/individual/en/products/' +
          portfolioId +
          '/';
        const pages = [
          ...new Set(
            [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
              .map((match) => match[1])
              .filter((url) => url.startsWith(prefix))
          )
        ];
        if (pages.length !== 1)
          throw new Error('Missing or ambiguous iShares canonical page');
        const pageUrl = pages[0];
        const page = await (await get(pageUrl)).text();
        // productIsin is the active share class, unlike incidental links to other funds.
        const decoded = page.replace(/&quot;/g, '"');
        const active = [
          ...decoded.matchAll(
            /"value"\s*:\s*"([A-Z]{2}[A-Z0-9]{9}\d)"[^{}]*"fullName"\s*:\s*"fundHeader.fundName.productIsin"/g
          )
        ].map((match) => match[1]);
        if (active.length !== 1 || active[0] !== isin)
          throw new Error('iShares product ISIN mismatch');
        return { isin, portfolioId, pageUrl };
      }
      if (issuer === 'VANGUARD') {
        const catalogue = await this.cached('vanguard:catalogue', async () => {
          const home = await (await get('https://www.ie.vanguard/home')).text();
          const ids = /portIds[^0-9]+([0-9,]+)/.exec(home)?.[1].split(',');
          if (!ids?.length || ids.length > 2000)
            throw new Error('Missing Vanguard catalogue identifiers');
          const data = await (
            await get('https://www.ie.vanguard/gpx/graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-consumer-id': 'ie0'
              },
              body: JSON.stringify({
                query:
                  'query ($portIds: [String!]!) { funds(portIds: $portIds) { profile { portId identifiers(altIds: ["ISIN"]) { altId altIdValue } } } }',
                variables: { portIds: ids }
              })
            })
          ).json();
          if (data.errors || !Array.isArray(data.data?.funds))
            throw new Error('Malformed Vanguard catalogue');
          return data.data.funds as {
            profile: {
              portId: string;
              identifiers: { altId: string; altIdValue: string }[];
            };
          }[];
        });
        const matches = catalogue.filter(({ profile }) =>
          profile?.identifiers?.some(
            (id) => id.altId === 'ISIN' && id.altIdValue === isin
          )
        );
        if (matches.length !== 1 || !/^\d+$/.test(matches[0].profile.portId))
          throw new Error('Missing or ambiguous Vanguard product');
        return { isin, portfolioId: matches[0].profile.portId };
      }
      const sitemap = await this.cached('xtrackers:sitemap', async () =>
        (await get('https://etf.deutsche-am.com/en-gb/sitemap.xml')).text()
      );
      const pages = [
        ...new Set(
          [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
            .map((match) => match[1])
            .filter((url) => {
              const parsed = new URL(url);
              return (
                parsed.origin === 'https://etf.deutsche-am.com' &&
                parsed.pathname.startsWith('/en-gb/' + isin + '-')
              );
            })
        )
      ];
      if (pages.length !== 1)
        throw new Error('Missing or ambiguous Xtrackers product');
      const identifier = new URL(pages[0]).pathname.split('/')[2];
      // The public PDP client uses pdp/{culture}/{productType}/{identifier}/{component}.
      return {
        isin,
        pageUrl: pages[0],
        holdingsUrl:
          'https://etf.deutsche-am.com/api/pdp/en-gb/etf/' +
          identifier +
          '/holdings'
      };
    });
  }
}

const discoveries = new WeakMap<object, EtfCompositionDiscovery>();

export function getEtfCompositionDiscovery(
  fetchService: Pick<FetchService, 'fetch'>
): EtfCompositionDiscovery {
  let discovery = discoveries.get(fetchService);
  if (!discovery) {
    discovery = new EtfCompositionDiscovery(fetchService);
    discoveries.set(fetchService, discovery);
  }
  return discovery;
}
