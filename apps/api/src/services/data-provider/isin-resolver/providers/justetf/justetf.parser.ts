export interface JustEtfListing {
  exchange: string;
  ticker: string;
  reuters: string;
  currency: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, '')).trim();
}

export function parseJustEtfListings(html: string): JustEtfListing[] {
  if (typeof html !== 'string' || html.length === 0) {
    return [];
  }

  const rows =
    html.match(
      /<tr\b[^>]*data-testid="etf-trade-data-panel_row-[^"]+"[^>]*>[\s\S]*?<\/tr>/g
    ) ?? [];

  return rows.map((row) => {
    const getField = (field: string): string => {
      const pattern = new RegExp(
        `data-testid="etf-trade-data-panel_row-[^"]+_${field}"[^>]*>([\\s\\S]*?)<\\/`
      );

      const match = row.match(pattern);

      return match ? stripHtml(match[1]) : '';
    };

    return {
      exchange: getField('listing'),
      ticker: getField('ticker'),
      reuters: getField('reuters'),
      currency: getField('trade-currency')
    };
  });
}
