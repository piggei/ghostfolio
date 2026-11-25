import { IsinResolverService } from './isin-resolver.service';
import {
  JustEtfHttpClient,
  JustEtfHttpResponse
} from './providers/justetf/justetf.http.interface';
import { JustEtfProvider } from './providers/justetf/justetf.provider';

const BASE = 'https://www.justetf.com';

const funds = [
  {
    symbol: 'XMME.MI',
    ticker: 'XMME',
    isin: 'IE00BTJRMP35'
  },
  {
    symbol: 'XAIX.MI',
    ticker: 'XAIX',
    isin: 'IE00BGV5VN51'
  }
];

type Fund = (typeof funds)[number];

const homepage = `
<script>
Wicket.Ajax.ajax({"u":"/it/?0-1.0-headerJ-navigation-mainSearchPanel-searchForm-query&_wicket=1","c":"search-input","e":"focus"});
Wicket.Ajax.ajax({"u":"/it/?0-1.1-headerJ-navigation-mainSearchPanel-searchForm-query&_wicket=1","m":"POST","c":"search-input","e":"keyup"});
</script>`;

function searchResponse(isin: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ajax-response>
  <component id="content">
    <![CDATA[
      <table data-testid="quick-search-etfs-table">
        <tr data-testid="quick-search-result-etf-${isin}">
          <td>
            <a href="/it/etf-profile.html?isin=${isin}">
              ETF
            </a>
          </td>
          <td>${isin}</td>
        </tr>
      </table>
    ]]>
  </component>
</ajax-response>`;
}

function profileResponse(fund: Fund): string {
  return `
<html>
<head>
<link rel="canonical" href="${BASE}/it/etf-profile.html?isin=${fund.isin}"/>
</head>
<body>
<tr data-testid="etf-trade-data-panel_row-xmil">
  <td data-testid="etf-trade-data-panel_row-xmil_listing">
    Borsa Italiana
  </td>
  <td data-testid="etf-trade-data-panel_row-xmil_trade-currency">
    EUR
  </td>
  <td data-testid="etf-trade-data-panel_row-xmil_ticker">
    ${fund.ticker}
  </td>
  <td>
    <span data-testid="etf-trade-data-panel_row-xmil_reuters">
      ${fund.symbol}
    </span>
  </td>
</tr>
</body>
</html>`;
}

class RecordedHttpClient implements JustEtfHttpClient {
  public readonly calls: string[] = [];

  public constructor(private readonly fund: Fund) {}

  public async request(
    url: string,
    options?: RequestInit
  ): Promise<JustEtfHttpResponse> {
    this.calls.push(url);

    let body: string;

    if (url === `${BASE}/it/`) {
      body = homepage;
    } else if (url.includes('0-1.0-')) {
      body = '<?xml version="1.0"?><ajax-response></ajax-response>';
    } else if (url.includes('0-1.1-')) {
      const query = new URLSearchParams(options?.body as URLSearchParams).get(
        'query'
      );

      if (query !== this.fund.ticker.toLowerCase()) {
        throw new Error('Unexpected search query');
      }

      body = searchResponse(this.fund.isin);
    } else if (url.includes('/etf-profile.html?isin=')) {
      body = profileResponse(this.fund);
    } else {
      throw new Error(`Unexpected URL: ${url}`);
    }

    const headers = new Headers();

    if (url === `${BASE}/it/`) {
      headers.append('set-cookie', 'JSESSIONID=recorded-session; Path=/');
    }

    return {
      status: 200,
      url,
      headers,
      body
    };
  }
}

describe('ISIN resolver end-to-end (recorded HTTP)', () => {
  for (const fund of funds) {
    it(`resolves ${fund.symbol} through justETF`, async () => {
      const http = new RecordedHttpClient(fund);
      const provider = new JustEtfProvider(http);
      const resolver = new IsinResolverService();

      const result = await resolver.resolve({
        provider,
        request: {
          dataSource: 'YAHOO',
          symbol: fund.symbol
        }
      });

      expect(result).toEqual({
        status: 'RESOLVED',
        resolution: {
          isin: fund.isin,
          source: 'JUSTETF',
          valid: true,
          verified: true
        }
      });

      expect(http.calls).toHaveLength(4);

      expect(http.calls[0]).toBe(`${BASE}/it/`);
      expect(http.calls[1]).toContain('0-1.0-');
      expect(http.calls[2]).toContain('0-1.1-');
      expect(http.calls[3]).toContain(`etf-profile.html?isin=${fund.isin}`);
    });
  }

  it('preserves an existing valid ISIN without HTTP requests', async () => {
    const fund = funds[0];
    const http = new RecordedHttpClient(fund);
    const provider = new JustEtfProvider(http);
    const resolver = new IsinResolverService();

    await expect(
      resolver.resolve({
        provider,
        request: {
          dataSource: 'YAHOO',
          symbol: fund.symbol,
          isin: fund.isin
        }
      })
    ).resolves.toEqual({
      status: 'RESOLVED',
      resolution: {
        isin: fund.isin,
        source: 'SYMBOL_PROFILE',
        valid: true,
        verified: false
      }
    });

    expect(http.calls).toHaveLength(0);
  });
});
