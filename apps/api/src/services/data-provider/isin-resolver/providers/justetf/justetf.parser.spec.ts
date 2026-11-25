import { parseJustEtfListings } from './justetf.parser';

describe('justETF listing parser', () => {
  it('extracts an Italian ETF listing', () => {
    const html = `
      <tr data-testid="etf-trade-data-panel_row-xmil">
        <td data-testid="etf-trade-data-panel_row-xmil_listing">
          Borsa Italiana
        </td>
        <td data-testid="etf-trade-data-panel_row-xmil_trade-currency">
          EUR
        </td>
        <td data-testid="etf-trade-data-panel_row-xmil_ticker">
          XMME
        </td>
        <td>
          <span data-testid="etf-trade-data-panel_row-xmil_reuters">
            XMME.MI
          </span>
        </td>
      </tr>
    `;

    expect(parseJustEtfListings(html)).toEqual([
      {
        exchange: 'Borsa Italiana',
        ticker: 'XMME',
        reuters: 'XMME.MI',
        currency: 'EUR'
      }
    ]);
  });

  it('extracts multiple exchange listings', () => {
    const html = `
      <tr data-testid="etf-trade-data-panel_row-xmil">
        <td data-testid="etf-trade-data-panel_row-xmil_listing">
          Borsa Italiana
        </td>
        <td data-testid="etf-trade-data-panel_row-xmil_ticker">
          XAIX
        </td>
        <td data-testid="etf-trade-data-panel_row-xmil_reuters">
          XAIX.MI
        </td>
      </tr>
      <tr data-testid="etf-trade-data-panel_row-xlon">
        <td data-testid="etf-trade-data-panel_row-xlon_listing">
          London Stock Exchange
        </td>
        <td data-testid="etf-trade-data-panel_row-xlon_ticker">
          XAIX
        </td>
        <td data-testid="etf-trade-data-panel_row-xlon_reuters">
          XAIX.L
        </td>
      </tr>
    `;

    const result = parseJustEtfListings(html);

    expect(result).toHaveLength(2);
    expect(result[0].reuters).toBe('XAIX.MI');
    expect(result[1].exchange).toBe('London Stock Exchange');
  });

  it('returns no listings for malformed input', () => {
    expect(parseJustEtfListings('')).toEqual([]);
    expect(parseJustEtfListings('<html></html>')).toEqual([]);
  });
});
