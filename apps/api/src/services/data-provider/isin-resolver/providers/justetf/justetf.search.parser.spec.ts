import {
  parseJustEtfSearchResponse,
  parseJustEtfSearchResults
} from './justetf.search.parser';

function createResponse(rows: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ajax-response>
  <component id="content1">
    <![CDATA[
      <table data-testid="quick-search-etfs-table">
        ${rows}
      </table>
    ]]>
  </component>
</ajax-response>`;
}

function createRow(isin: string, linkIsin = isin): string {
  return `<tr data-testid="quick-search-result-etf-${isin}">
    <td>
      <a href="/it/etf-profile.html?isin=${linkIsin}">
        ETF
      </a>
    </td>
    <td>${isin}</td>
  </tr>`;
}

describe('justETF search parser', () => {
  it('extracts XMME', () => {
    expect(
      parseJustEtfSearchResults(createResponse(createRow('IE00BTJRMP35')))
    ).toEqual(['IE00BTJRMP35']);
  });

  it('extracts XAIX', () => {
    expect(
      parseJustEtfSearchResults(createResponse(createRow('IE00BGV5VN51')))
    ).toEqual(['IE00BGV5VN51']);
  });

  it('preserves multiple candidates', () => {
    expect(
      parseJustEtfSearchResults(
        createResponse(createRow('IE00BTJRMP35') + createRow('IE00BGV5VN51'))
      )
    ).toEqual(['IE00BTJRMP35', 'IE00BGV5VN51']);
  });

  it('deduplicates identical candidates', () => {
    expect(
      parseJustEtfSearchResults(
        createResponse(createRow('IE00BTJRMP35') + createRow('IE00BTJRMP35'))
      )
    ).toEqual(['IE00BTJRMP35']);
  });

  it('rejects inconsistent profile links', () => {
    expect(
      parseJustEtfSearchResults(
        createResponse(createRow('IE00BTJRMP35', 'IE00BGV5VN51'))
      )
    ).toEqual([]);
  });

  it('ignores ISINs outside the ETF results table', () => {
    const xml = createResponse(createRow('IE00BTJRMP35')).replace(
      '</ajax-response>',
      '<header-contribution><![CDATA[' +
        'quick-search-result-etf-IE00BGV5VN51' +
        ']]></header-contribution></ajax-response>'
    );

    expect(parseJustEtfSearchResults(xml)).toEqual(['IE00BTJRMP35']);
  });

  it('rejects malformed XML', () => {
    expect(parseJustEtfSearchResults('')).toEqual([]);
    expect(parseJustEtfSearchResults('<html></html>')).toEqual([]);
    expect(
      parseJustEtfSearchResults('<ajax-response></ajax-response>')
    ).toEqual([]);
  });
  it('extracts a table from the second Wicket component', () => {
    const xml = createResponse(createRow('IE00BTJRMP35')).replace(
      '<component id="content1">',
      '<component id="empty"><![CDATA[<div></div>]]></component>' +
        '<component id="content1">'
    );

    expect(parseJustEtfSearchResults(xml)).toEqual(['IE00BTJRMP35']);
  });

  it('rejects multiple ETF tables', () => {
    const xml = createResponse(createRow('IE00BTJRMP35')).replace(
      '</ajax-response>',
      '<component id="other"><![CDATA[' +
        '<table data-testid="quick-search-etfs-table">' +
        createRow('IE00BGV5VN51') +
        '</table>]]></component></ajax-response>'
    );

    expect(parseJustEtfSearchResults(xml)).toEqual([]);
  });

  it('rejects an incomplete Wicket component', () => {
    const xml = createResponse(createRow('IE00BTJRMP35')).replace(
      '</component>',
      ''
    );

    expect(parseJustEtfSearchResults(xml)).toEqual([]);
  });

  it('rejects a malformed ETF row', () => {
    const xml = createResponse(
      '<tr data-testid="quick-search-result-etf-INVALID">' +
        '<td>Invalid</td></tr>'
    );

    expect(parseJustEtfSearchResults(xml)).toEqual([]);
  });

  it('distinguishes valid empty search results', () => {
    expect(parseJustEtfSearchResponse(createResponse(''))).toEqual([]);
  });

  it('returns null for malformed Wicket XML', () => {
    expect(parseJustEtfSearchResponse('<html></html>')).toBeNull();
  });

  it('returns typed candidates for valid Wicket XML', () => {
    expect(
      parseJustEtfSearchResponse(createResponse(createRow('IE00BTJRMP35')))
    ).toEqual(['IE00BTJRMP35']);
  });
});
