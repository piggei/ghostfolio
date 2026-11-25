import { parseSymbol } from '@ghostfolio/common/helper';

import {
  IsinProviderCandidate,
  IsinProviderInterface,
  IsinSearchResult,
  IsinVerificationResult
} from '../../interfaces/isin-provider.interface';
import { IsinResolutionRequest } from '../../isin-resolver.interface';
import {
  JustEtfFetchClient,
  JustEtfHttpClient,
  JustEtfHttpResponse
} from './justetf.http.interface';
import { parseJustEtfListings } from './justetf.parser';
import { parseJustEtfSearchResponse } from './justetf.search.parser';

const BASE_URL = 'https://www.justetf.com';
const MAX_CANDIDATES = 10;
const TIMEOUT_MS = 20000;

export class JustEtfProvider implements IsinProviderInterface {
  public constructor(
    private readonly http: JustEtfHttpClient = new JustEtfFetchClient()
  ) {}

  public getName(): string {
    return 'JUSTETF';
  }

  public async search(
    request: IsinResolutionRequest
  ): Promise<IsinSearchResult> {
    if (request.dataSource !== 'YAHOO') {
      return { status: 'NOT_FOUND' };
    }

    const { ticker } = parseSymbol(request);

    if (!ticker) {
      return { status: 'NOT_FOUND' };
    }

    try {
      const homepage = await this.request(`${BASE_URL}/it/`);

      const callback = this.extractCallback(homepage.body, 'keyup');

      const focusCallback = this.extractCallback(homepage.body, 'focus');

      if (!callback || !focusCallback) {
        return { status: 'UNAVAILABLE' };
      }

      const cookies = new Map<string, string>();

      const updateCookies = (response: JustEtfHttpResponse) => {
        for (const header of response.headers.getSetCookie()) {
          const pair = header.split(';', 1)[0];
          const separator = pair.indexOf('=');

          if (separator <= 0) {
            continue;
          }

          const name = pair.slice(0, separator).trim();
          const value = pair.slice(separator + 1);

          cookies.set(name, value);
        }
      };

      const cookieHeader = () =>
        [...cookies.entries()]
          .map(([name, value]) => `${name}=${value}`)
          .join('; ');

      updateCookies(homepage);

      const headers = {
        'Wicket-Ajax': 'true',
        'Wicket-Ajax-BaseURL': 'it/',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${BASE_URL}/it/`,
        Cookie: cookieHeader()
      };

      const focusResponse = await this.request(
        new URL(focusCallback, BASE_URL).toString(),
        { headers }
      );

      updateCookies(focusResponse);

      const response = await this.request(
        new URL(callback, BASE_URL).toString(),
        {
          method: 'POST',
          headers: {
            ...headers,
            Cookie: cookieHeader(),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            query: ticker.toLowerCase()
          })
        }
      );

      if (!response.body.startsWith('<?xml')) {
        return { status: 'UNAVAILABLE' };
      }

      const uniqueIsins = parseJustEtfSearchResponse(response.body);

      if (uniqueIsins === null) {
        return { status: 'UNAVAILABLE' };
      }

      if (uniqueIsins.length === 0) {
        return { status: 'NOT_FOUND' };
      }

      if (uniqueIsins.length > MAX_CANDIDATES) {
        return { status: 'UNAVAILABLE' };
      }

      return {
        status: 'FOUND',
        candidates: uniqueIsins.map((isin) => ({ isin }))
      };
    } catch {
      return { status: 'UNAVAILABLE' };
    }
  }

  public async verifyListing({
    candidate,
    request
  }: {
    candidate: IsinProviderCandidate;
    request: IsinResolutionRequest;
  }): Promise<IsinVerificationResult> {
    if (request.dataSource !== 'YAHOO') {
      return { status: 'NOT_MATCHED' };
    }

    const { exchange, ticker } = parseSymbol(request);

    if (!exchange || !ticker) {
      return { status: 'NOT_MATCHED' };
    }

    try {
      const url = new URL(`${BASE_URL}/it/etf-profile.html`);

      url.searchParams.set('isin', candidate.isin);

      const response = await this.request(url.toString());

      const canonicalIsin =
        /<link\s+rel="canonical"\s+href="[^"]*etf-profile\.html\?isin=([A-Z]{2}[A-Z0-9]{9}[0-9])"/.exec(
          response.body
        )?.[1];

      if (canonicalIsin !== candidate.isin) {
        return { status: 'UNAVAILABLE' };
      }

      const exchangeNames: Record<string, string> = {
        MI: 'Borsa Italiana'
      };

      const expectedExchange = exchangeNames[exchange];

      if (!expectedExchange) {
        return { status: 'NOT_MATCHED' };
      }

      const listings = parseJustEtfListings(response.body);

      if (listings.length === 0) {
        return { status: 'UNAVAILABLE' };
      }

      const marketListings = listings.filter(
        (listing) => listing.exchange === expectedExchange
      );

      if (
        marketListings.some(
          (listing) =>
            !listing.ticker ||
            listing.ticker === '-' ||
            !listing.reuters ||
            listing.reuters === '-'
        )
      ) {
        return { status: 'UNAVAILABLE' };
      }

      const matches = marketListings.filter((listing) => {
        return (
          listing.exchange === expectedExchange &&
          listing.ticker === ticker &&
          listing.reuters === request.symbol
        );
      });

      if (matches.length === 0) {
        return { status: 'NOT_MATCHED' };
      }

      if (matches.length !== 1) {
        return { status: 'UNAVAILABLE' };
      }

      return {
        status: 'VERIFIED',
        listing: {
          isin: candidate.isin,
          symbol: request.symbol,
          exchange,
          verified: true
        }
      };
    } catch {
      return { status: 'UNAVAILABLE' };
    }
  }

  private async request(
    url: string,
    options: RequestInit = {}
  ): Promise<JustEtfHttpResponse> {
    const response = await this.http.request(url, {
      ...options,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (response.status !== 200) {
      throw new Error(`justETF HTTP ${response.status}`);
    }

    return response;
  }

  private extractCallback(
    html: string,
    event: 'focus' | 'keyup'
  ): string | undefined {
    const callbacks = [...html.matchAll(/Wicket\.Ajax\.ajax\(\{[^;]{0,1500}/g)];

    for (const match of callbacks) {
      const code = match[0];

      if (
        !code.includes('mainSearchPanel-searchForm-query') ||
        !code.includes(`"e":"${event}"`)
      ) {
        continue;
      }

      const url = /"u":"([^"]+)"/.exec(code);

      if (url) {
        return url[1].replace(/&amp;/g, '&');
      }
    }

    return undefined;
  }
}
