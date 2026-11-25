import { Big } from 'big.js';

import { assertFreshEtfDate } from '../etf-composition.date';
import {
  EtfExposure,
  normalizeEtfComposition
} from '../etf-composition.normalizer';

export const AMUNDI_URL =
  'https://www.amundietf.lu/mapi/ProductAPI/getProductsData';
export const AMUNDI_CONTEXT = {
  countryCode: 'LUX',
  languageCode: 'en',
  userProfileName: 'RETAIL'
};
export const AMUNDI_IDENTITY_FIELDS = [
  'ISIN',
  'LISTINGS',
  'ASSET_CLASS',
  'SHARE_MARKETING_NAME',
  'FUND_REPLICATION_METHODOLOGY'
];

export interface AmundiProduct {
  productId: string;
  characteristics: {
    ISIN: string;
    ASSET_CLASS: string;
    FUND_REPLICATION_METHODOLOGY: string;
    FUND_BREAKDOWNS_AS_OF_DATE?: string;
    INDEX_BREAKDOWNS_AS_OF_DATE?: string;
    LISTINGS?: { ric: string; exchangePlace: string }[];
  };
  breakDowns?: {
    aggregationField: string;
    breakDownData: { aggregationName: string; weight: number }[];
  }[];
}

export type IssuerRequest = (
  url: string,
  init?: RequestInit
) => Promise<Response>;
export type CompositionDimension = 'countries' | 'sectors';

export function amundiBody(productIds?: string[]) {
  return {
    ...(productIds ? { productIds } : {}),
    context: AMUNDI_CONTEXT,
    characteristics: [
      ...AMUNDI_IDENTITY_FIELDS,
      'FUND_BREAKDOWNS_AS_OF_DATE',
      'INDEX_BREAKDOWNS_AS_OF_DATE'
    ],
    metrics: [],
    historics: [],
    ...(productIds
      ? {
          breakDown: {
            aggregationFields: [
              'FUND_COUNTRIES',
              'FUND_SECTORS',
              'INDEX_COUNTRIES',
              'INDEX_SECTORS'
            ]
          }
        }
      : {})
  };
}

function exposures(
  rows: unknown,
  nameField: string,
  weightField: string,
  percent: boolean
): EtfExposure[] {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500)
    throw new Error('Missing issuer allocations');
  const names = new Set<string>();
  return rows.map((row: Record<string, unknown>) => {
    const name = row?.[nameField];
    const value = row?.[weightField];
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      names.has(name) ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > (percent ? 100 : 1)
    )
      throw new Error('Invalid issuer allocation');
    names.add(name);
    // Invesco uses camelCase labels; Amundi publishes ordinary country names.
    const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2');
    const aliases: Record<string, string> = {
      informationTechnology: 'Information Technology',
      financials: 'Financials',
      communicationServices: 'Communication Services',
      healthCare: 'Health Care',
      consumerDiscretionary: 'Consumer Discretionary',
      industrials: 'Industrials',
      consumerStaples: 'Consumer Staples',
      energy: 'Energy',
      utilities: 'Utilities',
      realEstate: 'Real Estate',
      materials: 'Materials',
      other: 'Other',
      Others: 'Other',
      UAE: 'United Arab Emirates'
    };
    return {
      name: aliases[name] ?? spaced,
      weight: percent ? new Big(value).div(100).toNumber() : value
    };
  });
}

export function parseInvescoAllocation(
  data: { isin?: string; effectiveDate?: string; holdingWeights?: unknown },
  isin: string,
  dimension: CompositionDimension
) {
  if (data?.isin !== isin) throw new Error('Invesco ISIN mismatch');
  assertFreshEtfDate(data.effectiveDate);
  return normalizeEtfComposition({
    [dimension]: exposures(data.holdingWeights, 'name', 'value', true)
  });
}

export function parseAmundiAllocation(
  product: AmundiProduct,
  isin: string,
  dimension: CompositionDimension
) {
  if (
    product?.productId !== isin ||
    product.characteristics?.ISIN !== isin ||
    product.characteristics.ASSET_CLASS !== 'Equity'
  )
    throw new Error('Amundi identity or asset class mismatch');
  const replication = product.characteristics.FUND_REPLICATION_METHODOLOGY;
  const scope =
    replication === 'Direct(Physical)'
      ? 'FUND'
      : replication === 'Indirect(Swap Based)'
        ? 'INDEX'
        : undefined;
  if (!scope) throw new Error('Unsupported Amundi replication method');
  assertFreshEtfDate(
    product.characteristics[
      scope === 'FUND'
        ? 'FUND_BREAKDOWNS_AS_OF_DATE'
        : 'INDEX_BREAKDOWNS_AS_OF_DATE'
    ]
  );
  const field = scope + '_' + dimension.toUpperCase();
  const matches = product.breakDowns?.filter(
    (item) => item.aggregationField === field
  );
  if (matches?.length !== 1)
    throw new Error('Missing or ambiguous Amundi allocation');
  return normalizeEtfComposition({
    [dimension]: exposures(
      matches[0].breakDownData,
      'aggregationName',
      'weight',
      false
    )
  });
}

export async function fetchAmundiProduct(
  request: IssuerRequest,
  isin: string
): Promise<AmundiProduct> {
  const data = await (
    await request(AMUNDI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(amundiBody([isin]))
    })
  ).json();
  if (!Array.isArray(data.products) || data.products.length !== 1)
    throw new Error('Missing or ambiguous Amundi product');
  const product = data.products[0] as AmundiProduct;
  if (
    product?.productId !== isin ||
    product.characteristics?.ISIN !== isin ||
    product.characteristics.ASSET_CLASS !== 'Equity'
  )
    throw new Error('Amundi product identity mismatch');
  return product;
}

export async function fetchInvescoScope(
  request: IssuerRequest,
  isin: string
): Promise<'fund' | 'index'> {
  const data = await (
    await request(
      invescoUrl(isin) + '?expand=nav&idType=isin&variationType=fundDetails'
    )
  ).json();
  if (data?.isin !== isin) throw new Error('Invesco product ISIN mismatch');
  assertFreshEtfDate(data.effectiveDate);
  if (data.replicationMethod === 'Synthetic') return 'index';
  if (data.replicationMethod === 'Physical') return 'fund';
  throw new Error('Unsupported Invesco replication method');
}

export function invescoUrl(isin: string): string {
  return (
    'https://dng-api.invesco.com/cache/v1/accounts/en_IE/shareclasses/' + isin
  );
}
