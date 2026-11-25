import {
  JustEtfHttpClient,
  JustEtfHttpResponse
} from './justetf.http.interface';
import { JustEtfProvider } from './justetf.provider';

const XMME = 'IE00BTJRMP35';
const XAIX = 'IE00BGV5VN51';

const homepage = `
<script>
Wicket.Ajax.ajax({"u":"/it/?0-1.0-headerJ-navigation-mainSearchPanel-searchForm-query&_wicket=1","c":"search-input","e":"focus"});
Wicket.Ajax.ajax({"u":"/it/?0-1.1-headerJ-navigation-mainSearchPanel-searchForm-query&_wicket=1","m":"POST","c":"search-input","f":"searchForm3","e":"keyup"});
</script>`;

function searchResponse(isins: string[]): string {
  const rows = isins
    .map(
      (isin) => `
    <tr data-testid="quick-search-result-etf-${isin}">
      <td>
        <a href="/it/etf-profile.html?isin=${isin}">ETF</a>
      </td>
      <td>${isin}</td>
    </tr>
  `
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ajax-response>
  <component id="content">
    <![CDATA[
      <table data-testid="quick-search-etfs-table">
        ${rows}
      </table>
    ]]>
  </component>
</ajax-response>`;
}

function profileResponse({
  isin = XMME,
  exchange = 'Borsa Italiana',
  ticker = 'XMME',
  reuters = 'XMME.MI'
}: {
  isin?: string;
  exchange?: string;
  ticker?: string;
  reuters?: string;
} = {}): string {
  return `
<html>
<head>
<link rel="canonical" href="https://www.justetf.com/it/etf-profile.html?isin=${isin}"/>
</head>
<body>
<tr data-testid="etf-trade-data-panel_row-xmil">
  <td data-testid="etf-trade-data-panel_row-xmil_listing">${exchange}</td>
  <td data-testid="etf-trade-data-panel_row-xmil_trade-currency">EUR</td>
  <td data-testid="etf-trade-data-panel_row-xmil_ticker">${ticker}</td>
  <td>
    <span data-testid="etf-trade-data-panel_row-xmil_reuters">${reuters}</span>
  </td>
</tr>
</body>
</html>`;
}

interface MockReply {
  status?: number;
  body: string;
  cookies?: string[];
}

class MockHttpClient implements JustEtfHttpClient {
  public calls: {
    url: string;
    options?: RequestInit;
  }[] = [];

  public constructor(private readonly replies: MockReply[]) {}

  public async request(
    url: string,
    options?: RequestInit
  ): Promise<JustEtfHttpResponse> {
    this.calls.push({ url, options });

    const reply = this.replies.shift();

    if (!reply) {
      throw new Error('Unexpected HTTP request');
    }

    const headers = new Headers();

    for (const cookie of reply.cookies ?? []) {
      headers.append('set-cookie', cookie);
    }

    return {
      status: reply.status ?? 200,
      url,
      headers,
      body: reply.body
    };
  }
}

function createSearchClient(isins: string[]): MockHttpClient {
  return new MockHttpClient([
    {
      body: homepage,
      cookies: ['JSESSIONID=test-session; Path=/']
    },
    {
      body: '<?xml version="1.0"?><ajax-response></ajax-response>'
    },
    {
      body: searchResponse(isins)
    }
  ]);
}

describe('justETF provider', () => {
  it('searches XMME through homepage, focus and keyup', async () => {
    const http = createSearchClient([XMME]);
    const provider = new JustEtfProvider(http);

    await expect(
      provider.search({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI'
      })
    ).resolves.toEqual({ status: 'FOUND', candidates: [{ isin: XMME }] });

    expect(http.calls).toHaveLength(3);

    expect(http.calls[0].url).toBe('https://www.justetf.com/it/');

    expect(http.calls[1].url).toContain('0-1.0-');
    expect(http.calls[2].url).toContain('0-1.1-');

    expect(http.calls[2].options?.method).toBe('POST');

    const body = http.calls[2].options?.body as URLSearchParams;

    expect(body.get('query')).toBe('xmme');

    const headers = http.calls[2].options?.headers as Record<string, string>;

    expect(headers['Wicket-Ajax']).toBe('true');
    expect(headers.Cookie).toContain('JSESSIONID=test-session');
  });

  it('searches XAIX', async () => {
    const provider = new JustEtfProvider(createSearchClient([XAIX]));

    await expect(
      provider.search({
        dataSource: 'YAHOO',
        symbol: 'XAIX.MI'
      })
    ).resolves.toEqual({ status: 'FOUND', candidates: [{ isin: XAIX }] });
  });

  it('preserves multiple candidates', async () => {
    const provider = new JustEtfProvider(createSearchClient([XMME, XAIX]));

    await expect(
      provider.search({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI'
      })
    ).resolves.toEqual({
      status: 'FOUND',
      candidates: [{ isin: XMME }, { isin: XAIX }]
    });
  });

  it('rejects candidate overflow', async () => {
    const isins = Array.from(
      { length: 11 },
      (_, index) => `IE${String(index).padStart(10, '0')}`
    );

    const provider = new JustEtfProvider(createSearchClient(isins));

    await expect(
      provider.search({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI'
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('rejects an HTTP redirect', async () => {
    const http = new MockHttpClient([{ status: 302, body: '' }]);

    const provider = new JustEtfProvider(http);

    await expect(
      provider.search({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI'
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });

    expect(http.calls).toHaveLength(1);
  });

  it('rejects an HTTP server error', async () => {
    const http = new MockHttpClient([{ status: 500, body: '' }]);

    const provider = new JustEtfProvider(http);

    await expect(
      provider.search({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI'
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('does not request unsupported data sources', async () => {
    const http = new MockHttpClient([]);
    const provider = new JustEtfProvider(http);

    await expect(
      provider.search({
        dataSource: 'MANUAL',
        symbol: 'XMME.MI'
      })
    ).resolves.toEqual({ status: 'NOT_FOUND' });

    expect(http.calls).toHaveLength(0);
  });

  it('verifies an exact Italian listing', async () => {
    const http = new MockHttpClient([{ body: profileResponse() }]);

    const provider = new JustEtfProvider(http);

    await expect(
      provider.verifyListing({
        candidate: { isin: XMME },
        request: {
          dataSource: 'YAHOO',
          symbol: 'XMME.MI'
        }
      })
    ).resolves.toEqual({
      status: 'VERIFIED',
      listing: {
        isin: XMME,
        symbol: 'XMME.MI',
        exchange: 'MI',
        verified: true
      }
    });
  });

  it('rejects a different canonical ISIN', async () => {
    const provider = new JustEtfProvider(
      new MockHttpClient([{ body: profileResponse({ isin: XAIX }) }])
    );

    await expect(
      provider.verifyListing({
        candidate: { isin: XMME },
        request: {
          dataSource: 'YAHOO',
          symbol: 'XMME.MI'
        }
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('rejects a different exchange', async () => {
    const provider = new JustEtfProvider(
      new MockHttpClient([
        {
          body: profileResponse({
            exchange: 'London Stock Exchange'
          })
        }
      ])
    );

    await expect(
      provider.verifyListing({
        candidate: { isin: XMME },
        request: {
          dataSource: 'YAHOO',
          symbol: 'XMME.MI'
        }
      })
    ).resolves.toEqual({ status: 'NOT_MATCHED' });
  });

  it('rejects a different Reuters symbol', async () => {
    const provider = new JustEtfProvider(
      new MockHttpClient([
        {
          body: profileResponse({
            reuters: 'XMME.L'
          })
        }
      ])
    );

    await expect(
      provider.verifyListing({
        candidate: { isin: XMME },
        request: {
          dataSource: 'YAHOO',
          symbol: 'XMME.MI'
        }
      })
    ).resolves.toEqual({ status: 'NOT_MATCHED' });
  });

  it('rejects a profile HTTP error', async () => {
    const provider = new JustEtfProvider(
      new MockHttpClient([{ status: 503, body: '' }])
    );

    await expect(
      provider.verifyListing({
        candidate: { isin: XMME },
        request: {
          dataSource: 'YAHOO',
          symbol: 'XMME.MI'
        }
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });
  it('uses an updated session cookie after focus', async () => {
    const http = new MockHttpClient([
      {
        body: homepage,
        cookies: ['JSESSIONID=initial; Path=/']
      },
      {
        body: '<?xml version="1.0"?><ajax-response></ajax-response>',
        cookies: ['JSESSIONID=updated; Path=/']
      },
      {
        body: searchResponse([XMME])
      }
    ]);

    const provider = new JustEtfProvider(http);

    await expect(
      provider.search({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI'
      })
    ).resolves.toEqual({ status: 'FOUND', candidates: [{ isin: XMME }] });

    const headers = http.calls[2].options?.headers as Record<string, string>;

    expect(headers.Cookie).toContain('JSESSIONID=updated');
    expect(headers.Cookie).not.toContain('JSESSIONID=initial');
  });

  it('distinguishes an empty valid search from an unavailable search', async () => {
    const provider = new JustEtfProvider(createSearchClient([]));

    await expect(
      provider.search({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI'
      })
    ).resolves.toEqual({
      status: 'NOT_FOUND'
    });
  });

  it('rejects malformed Wicket search responses', async () => {
    const http = new MockHttpClient([
      {
        body: homepage,
        cookies: ['JSESSIONID=test-session; Path=/']
      },
      {
        body: '<?xml version="1.0"?><ajax-response></ajax-response>'
      },
      {
        body: '<html><body>Unexpected response</body></html>'
      }
    ]);

    const provider = new JustEtfProvider(http);

    await expect(
      provider.search({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI'
      })
    ).resolves.toEqual({
      status: 'UNAVAILABLE'
    });
  });

  it('rejects a profile without readable listings', async () => {
    const html = `
      <html>
        <head>
          <link rel="canonical"
            href="https://www.justetf.com/it/etf-profile.html?isin=${XMME}"/>
        </head>
        <body></body>
      </html>
    `;

    const provider = new JustEtfProvider(new MockHttpClient([{ body: html }]));

    await expect(
      provider.verifyListing({
        candidate: { isin: XMME },
        request: {
          dataSource: 'YAHOO',
          symbol: 'XMME.MI'
        }
      })
    ).resolves.toEqual({
      status: 'UNAVAILABLE'
    });
  });

  it('rejects duplicate matching listings', async () => {
    const html = profileResponse();

    const row =
      /<tr\b[^>]*data-testid="etf-trade-data-panel_row-xmil"[^>]*>[\s\S]*?<\/tr>/.exec(
        html
      )?.[0];

    if (!row) {
      throw new Error('Test fixture listing missing');
    }

    const duplicateHtml = html.replace('</body>', row + '</body>');

    const provider = new JustEtfProvider(
      new MockHttpClient([{ body: duplicateHtml }])
    );

    await expect(
      provider.verifyListing({
        candidate: { isin: XMME },
        request: {
          dataSource: 'YAHOO',
          symbol: 'XMME.MI'
        }
      })
    ).resolves.toEqual({
      status: 'UNAVAILABLE'
    });
  });

  it('distinguishes a valid non-matching listing', async () => {
    const provider = new JustEtfProvider(
      new MockHttpClient([
        {
          body: profileResponse({
            ticker: 'OTHER',
            reuters: 'OTHER.MI'
          })
        }
      ])
    );

    await expect(
      provider.verifyListing({
        candidate: { isin: XMME },
        request: {
          dataSource: 'YAHOO',
          symbol: 'XMME.MI'
        }
      })
    ).resolves.toEqual({
      status: 'NOT_MATCHED'
    });
  });
});
