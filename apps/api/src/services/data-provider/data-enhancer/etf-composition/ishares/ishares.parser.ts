import { Big } from 'big.js';

export interface IsharesHolding {
  ticker: string;
  name: string;
  sector: string;
  assetClass: string;
  location: string;
  marketCurrency: string;
  marketValue: string;
  notionalValue: string;
  publishedWeight: string;
}

export interface IsharesHoldingsDocument {
  asOfDate: string;
  holdings: IsharesHolding[];
}

const REQUIRED_COLUMNS = [
  'Ticker',
  'Name',
  'Sector',
  'Asset Class',
  'Market Value',
  'Weight (%)',
  'Notional Value',
  'Location',
  'Market Currency'
];

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];

  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];

    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }

      continue;
    }

    if (character === '"' && field === '' && !closedQuote) {
      quoted = true;
      continue;
    }

    if (character === ',') {
      row.push(field);
      field = '';
      closedQuote = false;
      continue;
    }

    if (character === '\n' || character === '\r') {
      if (character === '\r' && text[i + 1] === '\n') {
        i++;
      }

      row.push(field);
      rows.push(row);

      row = [];
      field = '';
      closedQuote = false;
      continue;
    }

    if (closedQuote || character === '"') {
      throw new Error('Invalid iShares CSV quoting');
    }

    field += character;
  }

  if (quoted) {
    throw new Error('Unterminated iShares CSV field');
  }

  if (field !== '' || row.length > 0 || closedQuote) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseDecimal(value: string, label: string): string {
  const normalized = value.trim();

  if (!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid iShares ${label}: ${value}`);
  }

  try {
    return new Big(normalized.replace(/,/g, '')).toString();
  } catch {
    throw new Error(`Invalid iShares ${label}: ${value}`);
  }
}

function parseDate(value: string): string {
  const match = /^(\d{2})\/([A-Za-z]{3})\/(\d{4})$/.exec(value);

  if (!match) {
    throw new Error('Invalid iShares holdings date');
  }

  const [, day, month, year] = match;
  const monthIndex = MONTHS.indexOf(month);

  if (monthIndex < 0) {
    throw new Error('Invalid iShares holdings date');
  }

  const date = new Date(Date.UTC(Number(year), monthIndex, Number(day)));

  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error('Invalid iShares holdings date');
  }

  return value;
}

export function parseIsharesHoldings(text: string): IsharesHoldingsDocument {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Empty iShares CSV');
  }

  const rows = parseCsv(text.replace(/^\uFEFF/, ''));

  if (
    rows.length < 3 ||
    rows[0].length !== 2 ||
    rows[0][0] !== 'Fund Holdings as of'
  ) {
    throw new Error('Invalid iShares holdings metadata');
  }

  const asOfDate = parseDate(rows[0][1]);

  const headerIndex = rows.findIndex((row) =>
    REQUIRED_COLUMNS.every((column) => row.includes(column))
  );

  if (headerIndex < 0) {
    throw new Error('Missing iShares holdings columns');
  }

  const headers = rows[headerIndex];

  if (new Set(headers).size !== headers.length) {
    throw new Error('Duplicate iShares holdings columns');
  }

  const holdings: IsharesHolding[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    if (row.every((value) => value.trim() === '')) {
      continue;
    }

    if (row.length !== headers.length) {
      throw new Error('Invalid iShares holdings row');
    }

    const record = Object.fromEntries(
      headers.map((header, index) => [header, row[index]])
    );

    const ticker = record['Ticker']?.trim();
    const name = record['Name']?.trim();
    const assetClass = record['Asset Class']?.trim();

    if (!ticker || !name || !assetClass) {
      throw new Error('Invalid iShares holding identity');
    }

    holdings.push({
      ticker,
      name,
      sector: record['Sector']?.trim() ?? '',
      assetClass,
      location: record['Location']?.trim() ?? '',
      marketCurrency: record['Market Currency']?.trim() ?? '',
      marketValue: parseDecimal(record['Market Value'], 'market value'),
      notionalValue: parseDecimal(record['Notional Value'], 'notional value'),
      publishedWeight: parseDecimal(record['Weight (%)'], 'published weight')
    });
  }

  if (holdings.length === 0) {
    throw new Error('Empty iShares holdings');
  }

  return { asOfDate, holdings };
}
