import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IsinResolverService } from './isin-resolver.service';
import {
  JustEtfHttpClient,
  JustEtfHttpResponse
} from './providers/justetf/justetf.http.interface';
import { JustEtfProvider } from './providers/justetf/justetf.provider';

const fixtureDir = join(__dirname, 'providers/justetf/__fixtures__');

const homepage = `
<script>
Wicket.Ajax.ajax({"u":"/it/?0-1.0-headerJ-navigation-mainSearchPanel-searchForm-query&_wicket=1","e":"focus"});
Wicket.Ajax.ajax({"u":"/it/?0-1.1-headerJ-navigation-mainSearchPanel-searchForm-query&_wicket=1","m":"POST","e":"keyup"});
</script>`;

const funds = [
  {
    ticker: 'XMME',
    symbol: 'XMME.MI',
    isin: 'IE00BTJRMP35'
  },
  {
    ticker: 'XAIX',
    symbol: 'XAIX.MI',
    isin: 'IE00BGV5VN51'
  }
];

describe('ISIN resolver with real justETF fixtures', () => {
  for (const fund of funds) {
    it(`resolves ${fund.symbol}`, async () => {
      const searchXml = readFileSync(
        join(fixtureDir, `${fund.ticker.toLowerCase()}-search.xml`),
        'utf8'
      );

      const profileHtml = readFileSync(
        join(fixtureDir, `${fund.ticker.toLowerCase()}-profile.html`),
        'utf8'
      );

      const calls: string[] = [];

      const http: JustEtfHttpClient = {
        request: async (
          url: string,
          options?: RequestInit
        ): Promise<JustEtfHttpResponse> => {
          calls.push(url);

          let body: string;

          if (url === 'https://www.justetf.com/it/') {
            body = homepage;
          } else if (url.includes('0-1.0-')) {
            body = '<?xml version="1.0"?>' + '<ajax-response></ajax-response>';
          } else if (url.includes('0-1.1-')) {
            const query = new URLSearchParams(
              options?.body as URLSearchParams
            ).get('query');

            if (query !== fund.ticker.toLowerCase()) {
              throw new Error('Unexpected search query');
            }

            body = searchXml;
          } else if (url.includes('/etf-profile.html?isin=')) {
            if (!url.endsWith(`isin=${fund.isin}`)) {
              throw new Error('Unexpected profile ISIN');
            }

            body = profileHtml;
          } else {
            throw new Error(`Unexpected URL: ${url}`);
          }

          const headers = new Headers();

          if (url === 'https://www.justetf.com/it/') {
            headers.append('set-cookie', 'JSESSIONID=fixture-session; Path=/');
          }

          return {
            status: 200,
            url,
            headers,
            body
          };
        }
      };

      const provider = new JustEtfProvider(http);
      const resolver = new IsinResolverService();

      await expect(
        resolver.resolve({
          provider,
          request: {
            dataSource: 'YAHOO',
            symbol: fund.symbol
          }
        })
      ).resolves.toEqual({
        status: 'RESOLVED',
        resolution: {
          isin: fund.isin,
          source: 'JUSTETF',
          valid: true,
          verified: true
        }
      });

      expect(calls).toHaveLength(4);
    });
  }
});
