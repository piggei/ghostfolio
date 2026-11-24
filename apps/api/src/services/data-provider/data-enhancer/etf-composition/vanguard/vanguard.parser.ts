import { Big } from 'big.js';

export interface VanguardHolding {
  country?: string;
  sector?: string;
  securityType: string;
  weight: number;
}

export interface VanguardHoldingsPage {
  holdings: VanguardHolding[];
  totalHoldings: number;
  lastItemKey: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseVanguardHoldingsPage(
  response: unknown
): VanguardHoldingsPage {
  if (!isRecord(response) || !isRecord(response.data)) {
    throw new Error('Invalid Vanguard GraphQL response');
  }

  if (Array.isArray(response.errors) && response.errors.length > 0) {
    throw new Error('Vanguard GraphQL returned errors');
  }

  const funds = response.data.borHoldings;

  if (!Array.isArray(funds) || funds.length !== 1) {
    throw new Error('Unexpected Vanguard fund response');
  }

  const fund = funds[0];

  if (!isRecord(fund) || !isRecord(fund.holdings)) {
    throw new Error('Invalid Vanguard holdings structure');
  }

  const { items, totalHoldings, lastItemKey } = fund.holdings;

  if (
    !Array.isArray(items) ||
    typeof totalHoldings !== 'number' ||
    !Number.isInteger(totalHoldings) ||
    totalHoldings < 0 ||
    (lastItemKey !== null && typeof lastItemKey !== 'string')
  ) {
    throw new Error('Invalid Vanguard holdings page');
  }

  const holdings: VanguardHolding[] = [];

  for (const item of items) {
    if (!isRecord(item)) {
      throw new Error('Invalid Vanguard holding');
    }

    const {
      bloombergIsoCountry,
      gicsSectorDescription,
      marketValuePercentage,
      securityType
    } = item;

    if (
      typeof marketValuePercentage !== 'number' ||
      !Number.isFinite(marketValuePercentage) ||
      typeof securityType !== 'string' ||
      securityType.length === 0
    ) {
      throw new Error('Invalid Vanguard holding fields');
    }

    if (
      bloombergIsoCountry !== null &&
      bloombergIsoCountry !== undefined &&
      typeof bloombergIsoCountry !== 'string'
    ) {
      throw new Error('Invalid Vanguard country');
    }

    if (
      gicsSectorDescription !== null &&
      gicsSectorDescription !== undefined &&
      typeof gicsSectorDescription !== 'string'
    ) {
      throw new Error('Invalid Vanguard sector');
    }

    holdings.push({
      country:
        typeof bloombergIsoCountry === 'string'
          ? bloombergIsoCountry
          : undefined,
      sector:
        typeof gicsSectorDescription === 'string'
          ? gicsSectorDescription
          : undefined,
      securityType,
      weight: new Big(marketValuePercentage).div(100).toNumber()
    });
  }

  return {
    holdings,
    totalHoldings,
    lastItemKey: typeof lastItemKey === 'string' ? lastItemKey : null
  };
}
