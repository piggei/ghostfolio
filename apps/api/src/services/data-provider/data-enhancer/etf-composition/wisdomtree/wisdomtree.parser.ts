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
}

const ISIN = 'IE00BZ56SW52';
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
  Utilities: 'Utilities'
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
  expected: number
): { name: string; weight: number }[] {
  const section = items.filter(
    (item) =>
      item.x >= left && item.x < right && item.y < top && item.y > bottom
  );
  const labels = section.filter((item) => percent(item.text) === undefined);
  const weights = section.filter((item) => percent(item.text) !== undefined);
  if (labels.length !== expected || weights.length !== expected) {
    throw new Error('Unexpected WisdomTree allocation table structure');
  }
  const used = new Set<number>();
  return labels
    .sort((a, b) => b.y - a.y)
    .map((label) => {
      const candidates = weights
        .map((weight, index) => ({
          weight,
          index,
          distance: Math.abs(weight.y - label.y)
        }))
        .filter(({ index, distance }) => !used.has(index) && distance <= 3)
        .sort((a, b) => a.distance - b.distance);
      if (candidates.length !== 1) {
        throw new Error('Ambiguous WisdomTree allocation row');
      }
      used.add(candidates[0].index);
      return { name: label.text, weight: percent(candidates[0].weight.text)! };
    });
}

export function parseWisdomtreeFactsheet(
  items: WisdomtreeTextItem[]
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

  const holdings = findUnique('Top 10 Holdings (% Weight)');
  const sectorsHeader = findUnique('Fund Sector Exposure (% Weight)');
  const countriesHeader = findUnique('Top 10 Countries (% Weight)');
  if (!(holdings.x < sectorsHeader.x && sectorsHeader.x < countriesHeader.x)) {
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

  const listing = textItems.some((item) => item.text === 'GGRA.MI');
  const isin = textItems.some((item) => item.text === ISIN);
  if (!listing || !isin) throw new Error('WisdomTree fund identity mismatch');

  const bottom = source[0].y;
  const sectorRows = readColumn(
    textItems,
    sectorsHeader.x,
    countriesHeader.x,
    sectorsHeader.y,
    bottom,
    10
  );
  const countryRows = readColumn(
    textItems,
    countriesHeader.x,
    Infinity,
    countriesHeader.y,
    bottom,
    10
  );
  const sectorExposures = sectorRows.map(({ name, weight }) => {
    const normalized = SECTOR_LABELS[name];
    if (!normalized) throw new Error(`Unknown WisdomTree sector: ${name}`);
    return { name: normalized, weight };
  });

  const composition = normalizeEtfComposition({
    countries: countryRows,
    sectors: sectorExposures
  });
  if (
    composition.countries.length !== 10 ||
    composition.sectors.length !== 10 ||
    composition.unclassifiedCountryWeight !== 0 ||
    composition.countryCoverage < 0.9 ||
    composition.countryCoverage > 1 ||
    composition.classifiedSectorCoverage < 0.98 ||
    composition.sectorCoverage > 1
  ) {
    throw new Error('Invalid WisdomTree allocation coverage');
  }

  return {
    isin: ISIN,
    asOfDate,
    countries: composition.countries,
    sectors: composition.sectors,
    countryCoverage: composition.countryCoverage,
    sectorCoverage: composition.sectorCoverage,
    missingCountryWeight: composition.missingCountryWeight
  };
}

export async function parseWisdomtreePdf(
  data: Uint8Array
): Promise<WisdomtreeComposition> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true
  });
  try {
    const document = await task.promise;
    if (document.numPages < 3)
      throw new Error('Incomplete WisdomTree factsheet');
    const page = await document.getPage(3);
    const content = await page.getTextContent();
    return parseWisdomtreeFactsheet(
      content.items.filter(
        (item): item is typeof item & { str: string; transform: number[] } =>
          'str' in item && 'transform' in item
      )
    );
  } finally {
    await task.destroy();
  }
}
