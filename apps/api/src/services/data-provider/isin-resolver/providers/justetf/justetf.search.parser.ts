const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export function parseJustEtfSearchResponse(xml: string): string[] | null {
  if (
    typeof xml !== 'string' ||
    !xml.trimStart().startsWith('<?xml') ||
    !xml.includes('<ajax-response>') ||
    !xml.includes('</ajax-response>')
  ) {
    return null;
  }

  const components = [
    ...xml.matchAll(
      /<component\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/component>/g
    )
  ];

  const tables: string[] = [];

  for (const component of components) {
    const matches = [
      ...component[1].matchAll(
        /<table\b[^>]*data-testid="quick-search-etfs-table"[^>]*>([\s\S]*?)<\/table>/g
      )
    ];

    for (const match of matches) {
      tables.push(match[1]);
    }
  }

  if (tables.length !== 1) {
    return null;
  }

  const table = tables[0];

  const rows = [
    ...table.matchAll(
      /<tr\b[^>]*data-testid="quick-search-result-etf-([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g
    )
  ];

  const results: string[] = [];

  for (const row of rows) {
    const isin = row[1];

    if (!ISIN_PATTERN.test(isin)) {
      return null;
    }

    const links = [
      ...row[2].matchAll(
        /href="[^"]*etf-profile\.html\?isin=([A-Z]{2}[A-Z0-9]{9}[0-9])"/g
      )
    ];

    if (links.length !== 1 || links[0][1] !== isin) {
      return null;
    }

    results.push(isin);
  }

  return [...new Set(results)];
}

export function parseJustEtfSearchResults(xml: string): string[] {
  return parseJustEtfSearchResponse(xml) ?? [];
}
