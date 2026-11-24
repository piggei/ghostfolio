import {
  IsharesHoldingsDocument,
  parseIsharesHoldings
} from './ishares.parser';

const DOCUMENT_URL =
  'https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v1/get-fund-document';

const DATE_ATTRIBUTE = 'data-as-of-dates';
const DATE_COMPONENT = 'holdings-as-of-dates';

export type IsharesFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

function parseDate(value: string): Date {
  if (!/^\d{8}$/.test(value)) {
    throw new Error('Invalid iShares holdings date');
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Invalid iShares holdings date');
  }

  return date;
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&amp;/gi, '&');
}

export function parseIsharesHoldingsDate(html: string): string {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('Empty iShares holdings page');
  }

  const tags = html.match(/<[^>]+>/g) ?? [];

  const matches: string[] = [];

  for (const tag of tags) {
    const component = new RegExp(
      `\\bwebqc-datapoint\\s*=\\s*["']${DATE_COMPONENT}["']`
    );

    if (!component.test(tag)) {
      continue;
    }

    const attribute = new RegExp(`\\b${DATE_ATTRIBUTE}\\s*=\\s*(["'])(.*?)\\1`);

    const match = attribute.exec(tag);

    if (!match) {
      throw new Error('Missing iShares holdings date attribute');
    }

    let data: unknown;

    try {
      data = JSON.parse(decodeHtmlAttribute(match[2]));
    } catch {
      throw new Error('Invalid iShares holdings date metadata');
    }

    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      !Object.prototype.hasOwnProperty.call(data, 'all')
    ) {
      throw new Error('Missing iShares holdings date');
    }

    const value = (data as Record<string, unknown>).all;

    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error('Invalid iShares holdings date');
    }

    const date = String(value);

    parseDate(date);

    matches.push(date);
  }

  if (matches.length !== 1) {
    throw new Error('Ambiguous or missing iShares holdings date');
  }

  return matches[0];
}

export function buildIsharesHoldingsUrl({
  asOfDate,
  portfolioId
}: {
  asOfDate: string;
  portfolioId: string;
}): string {
  parseDate(asOfDate);

  if (!/^\d+$/.test(portfolioId)) {
    throw new Error('Invalid iShares portfolio ID');
  }

  const url = new URL(DOCUMENT_URL);

  url.searchParams.set('appType', 'PRODUCT_PAGE');
  url.searchParams.set('appSubType', 'ISHARES');
  url.searchParams.set('targetSite', 'ishares-uk');
  url.searchParams.set('locale', 'en_GB');
  url.searchParams.set('portfolioId', portfolioId);
  url.searchParams.set('userType', 'individual');
  url.searchParams.set('asOfDate', asOfDate);
  url.searchParams.set('component', 'holdings');

  return url.toString();
}

export async function fetchIsharesHoldings({
  fetch,
  pageUrl,
  portfolioId,
  requestTimeout = 30000
}: {
  fetch: IsharesFetch;
  pageUrl: string;
  portfolioId: string;
  requestTimeout?: number;
}): Promise<IsharesHoldingsDocument> {
  if (!Number.isFinite(requestTimeout) || requestTimeout <= 0) {
    throw new Error('Invalid iShares request timeout');
  }

  const pageResponse = await fetch(pageUrl, {
    signal: AbortSignal.timeout(requestTimeout)
  });

  if (!pageResponse.ok) {
    throw new Error(`iShares page HTTP status ${pageResponse.status}`);
  }

  const html = await pageResponse.text();
  const asOfDate = parseIsharesHoldingsDate(html);

  if (parseDate(asOfDate).getTime() > Date.now()) {
    throw new Error('Future iShares holdings date');
  }

  const documentUrl = buildIsharesHoldingsUrl({
    asOfDate,
    portfolioId
  });

  const documentResponse = await fetch(documentUrl, {
    signal: AbortSignal.timeout(requestTimeout)
  });

  if (!documentResponse.ok) {
    throw new Error(`iShares document HTTP status ${documentResponse.status}`);
  }

  const contentType = documentResponse.headers.get('content-type') ?? '';

  if (!contentType.toLowerCase().includes('text/csv')) {
    throw new Error('Unexpected iShares document content type');
  }

  const document = parseIsharesHoldings(await documentResponse.text());

  const date = parseDate(asOfDate);

  const expectedDate = [
    String(date.getUTCDate()).padStart(2, '0'),
    [
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
    ][date.getUTCMonth()],
    date.getUTCFullYear()
  ].join('/');

  if (document.asOfDate !== expectedDate) {
    throw new Error('iShares holdings date mismatch');
  }

  return document;
}
