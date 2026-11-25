import { normalizeEtfComposition } from '../etf-composition.normalizer';

export interface WisdomtreeTextItem {
  str: string;
  transform: number[];
}

export interface WisdomtreeComposition {
  isin: string;
  asOfDate: string;
  countries: { code: string; weight: number }[];
  sectors: { name: string; weight: number }[];
  countryCoverage: number;
  sectorCoverage: number;
  missingCountryWeight: number;
  warnings?: string[];
}

const SECTOR_LABELS: Record<string, string> = {
  'Health Care': 'Health Care',
  'Information…': 'Information Technology',
  Industrials: 'Industrials',
  'Consumer…': 'Consumer Discretionary',
  Financials: 'Financials',
  'Consumer Staples': 'Consumer Staples',
  'Communication…': 'Communication',
  Materials: 'Materials',
  Energy: 'Energy',
  Utilities: 'Utilities',
  'Information Technology': 'Information Technology',
  'Consumer Discretionary': 'Consumer Discretionary',
  'Communication Services': 'Communication Services',
  'Real Estate': 'Real Estate',
  Other: 'Other'
};

interface Item {
  text: string;
  x: number;
  y: number;
}

function percent(text: string): number | undefined {
  if (!/^(?:\d{1,3})(?:\.\d{1,2})?%$/.test(text)) return undefined;
  const value = Number(text.slice(0, -1)) / 100;
  return Number.isFinite(value) && value <= 1 ? value : undefined;
}

function readColumn(
  items: Item[],
  left: number,
  right: number,
  top: number,
  bottom: number,
  expected?: number
): { name: string; weight: number }[] {
  const section = items.filter(
    (item) =>
      item.x >= left && item.x < right && item.y < top && item.y > bottom
  );
  const labels = section.filter((item) => percent(item.text) === undefined);
  const weights = section.filter((item) => percent(item.text) !== undefined);
  if (
    weights.length === 0 ||
    (expected !== undefined && weights.length !== expected)
  ) {
    throw new Error('Unexpected WisdomTree allocation table structure');
  }
  const grouped = weights.map(() => [] as Item[]);
  for (const label of labels) {
    const candidates = weights
      .map((weight, index) => ({
        index,
        distance: Math.abs(weight.y - label.y)
      }))
      .filter(({ distance }) => distance <= 6);
    if (candidates.length !== 1)
      throw new Error('Unexpected WisdomTree allocation table structure');
    grouped[candidates[0].index].push(label);
  }
  return weights.map((weight, index) => {
    if (grouped[index].length === 0)
      throw new Error('Unexpected WisdomTree allocation table structure');
    return {
      name: grouped[index]
        .sort((a, b) => b.y - a.y)
        .map((label) => label.text)
        .join(' '),
      weight: percent(weight.text)!
    };
  });
}

export function parseWisdomtreeFactsheet(
  items: WisdomtreeTextItem[],
  expectedIsin?: string
): WisdomtreeComposition {
  const textItems: Item[] = items
    .filter(
      (item) =>
        typeof item.str === 'string' &&
        item.str.trim() &&
        item.transform?.length >= 6
    )
    .map((item) => ({
      text: item.str.trim(),
      x: item.transform[4],
      y: item.transform[5]
    }));

  const findUnique = (text: string): Item => {
    const matches = textItems.filter((item) => item.text === text);
    if (matches.length !== 1)
      throw new Error(`Missing or ambiguous WisdomTree heading: ${text}`);
    return matches[0];
  };

  const sectorsHeader = findUnique('Fund Sector Exposure (% Weight)');
  const countriesHeader = findUnique('Top 10 Countries (% Weight)');
  if (!(sectorsHeader.x < countriesHeader.x)) {
    throw new Error('Unexpected WisdomTree column ordering');
  }

  const source = textItems.filter((item) =>
    item.text.includes('All data as of ')
  );
  if (source.length !== 1)
    throw new Error('Missing or ambiguous WisdomTree allocation date');
  const match = /All data as of (\d{2})\/(\d{2})\/(\d{4})/.exec(source[0].text);
  if (!match) throw new Error('Invalid WisdomTree allocation date');
  const [, dd, mm, yyyy] = match;
  const asOfDate = `${yyyy}-${mm}-${dd}`;
  const date = new Date(`${asOfDate}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== asOfDate ||
    date.getTime() > Date.now()
  ) {
    throw new Error('Invalid or future WisdomTree allocation date');
  }

  const isins = [
    ...new Set(
      textItems.flatMap(
        (item) => item.text.match(/\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/g) ?? []
      )
    )
  ];
  if (isins.length !== 1 || (expectedIsin && isins[0] !== expectedIsin))
    throw new Error('WisdomTree fund identity mismatch');
  const isin = isins[0];

  const bottom = source[0].y;
  const warnings: string[] = [];
  const readDimension = (dimension: 'countries' | 'sectors') => {
    try {
      const rows = readColumn(
        textItems,
        dimension === 'countries' ? countriesHeader.x : sectorsHeader.x,
        dimension === 'countries' ? Infinity : countriesHeader.x,
        dimension === 'countries' ? countriesHeader.y : sectorsHeader.y,
        bottom
      );
      if (dimension === 'countries')
        return normalizeEtfComposition({ countries: rows });
      if (
        rows.some(({ name }) => name === 'Consumer…') &&
        (!rows.some(({ name }) => name === 'Consumer Staples') ||
          rows.some(({ name }) => name === 'Consumer Discretionary'))
      ) {
        throw new Error('Ambiguous truncated WisdomTree consumer sector');
      }
      return normalizeEtfComposition({
        sectors: rows.map(({ name, weight }) => {
          const normalized = SECTOR_LABELS[name];
          if (!normalized)
            throw new Error('Unknown WisdomTree sector: ' + name);
          return { name: normalized, weight };
        })
      });
    } catch (error) {
      warnings.push(
        dimension +
          ': ' +
          (error instanceof Error ? error.message : String(error))
      );
      return normalizeEtfComposition({});
    }
  };
  const countryComposition = readDimension('countries');
  const sectorComposition = readDimension('sectors');
  if (
    !countryComposition.countries.length &&
    !sectorComposition.sectors.length &&
    warnings.length
  ) {
    throw new Error(warnings.join('; '));
  }
  const composition = {
    ...countryComposition,
    sectors: sectorComposition.sectors,
    sectorCoverage: sectorComposition.sectorCoverage
  };
  return {
    isin,
    warnings,
    asOfDate,
    countries: composition.countries,
    sectors: composition.sectors,
    countryCoverage: composition.countryCoverage,
    sectorCoverage: composition.sectorCoverage,
    missingCountryWeight: composition.missingCountryWeight
  };
}

export async function parseWisdomtreePdf(
  data: Uint8Array,
  expectedIsin?: string
): Promise<WisdomtreeComposition> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true
  });
  try {
    const document = await task.promise;
    if (document.numPages > 20)
      throw new Error('Unsupported WisdomTree factsheet length');
    const pages: WisdomtreeTextItem[][] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items = content.items.filter(
        (item): item is typeof item & { str: string; transform: number[] } =>
          'str' in item && 'transform' in item
      );
      if (items.some((item) => item.str === 'Fund Sector Exposure (% Weight)'))
        pages.push(items);
    }
    if (pages.length !== 1)
      throw new Error('Missing or ambiguous WisdomTree allocation page');
    return parseWisdomtreeFactsheet(pages[0], expectedIsin);
  } finally {
    await task.destroy();
  }
}
