import { Big } from 'big.js';

import {
  normalizeEtfComposition,
  NormalizedEtfComposition
} from '../etf-composition.normalizer';

interface DwsCell {
  value?: unknown;
  sortValue?: unknown;
}

const REQUIRED_COLUMNS = {
  weight: '% Weight',
  country: 'Country',
  sector: 'Industry',
  assetClass: 'Asset class'
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getCell(row: Record<string, unknown>, key: string): DwsCell {
  const cell = row[key];

  if (!isRecord(cell)) {
    throw new Error(`Invalid Xtrackers cell: ${key}`);
  }

  return cell;
}

function getText(cell: DwsCell): string {
  if (typeof cell.value !== 'string') {
    throw new Error('Invalid Xtrackers text cell');
  }

  return cell.value.trim();
}

export function parseXtrackersHoldings(
  data: unknown
): NormalizedEtfComposition {
  if (!isRecord(data) || !Array.isArray(data.tables)) {
    throw new Error('Invalid Xtrackers response');
  }

  if (data.tables.length !== 1) {
    throw new Error('Unexpected Xtrackers tables');
  }

  const table = data.tables[0];

  if (
    !isRecord(table) ||
    !Array.isArray(table.columns) ||
    !Array.isArray(table.values)
  ) {
    throw new Error('Invalid Xtrackers holdings table');
  }

  const columns = new Map<string, string>();

  for (const column of table.columns) {
    if (
      !isRecord(column) ||
      typeof column.key !== 'string' ||
      typeof column.value !== 'string'
    ) {
      throw new Error('Invalid Xtrackers column');
    }

    if (columns.has(column.value)) {
      throw new Error('Duplicate Xtrackers column');
    }

    columns.set(column.value, column.key);
  }

  const weightKey = columns.get(REQUIRED_COLUMNS.weight);
  const countryKey = columns.get(REQUIRED_COLUMNS.country);
  const sectorKey = columns.get(REQUIRED_COLUMNS.sector);

  if (!weightKey || !countryKey || !sectorKey) {
    throw new Error('Missing Xtrackers required columns');
  }

  if (table.values.length === 0) {
    throw new Error('Empty Xtrackers holdings');
  }

  const countries = [];
  const sectors = [];
  const assetClassKey = columns.get(REQUIRED_COLUMNS.assetClass);
  let positiveCash = new Big(0);
  let negativeCash = new Big(0);
  let netTotal = new Big(0);
  let hasNegativeCash = false;
  const cashCountries: { name: string; weight: number }[] = [];
  const cashSectors: { name: string; weight: number }[] = [];

  // A missing asset-class column remains valid for older positive-only feeds.
  // Negative holdings require explicit evidence that they are cash.

  for (const row of table.values) {
    if (!isRecord(row)) {
      throw new Error('Invalid Xtrackers holding');
    }

    const rawWeight = getCell(row, weightKey).sortValue;

    if (typeof rawWeight !== 'number' || !Number.isFinite(rawWeight)) {
      throw new Error('Invalid Xtrackers holding weight');
    }

    const raw = new Big(rawWeight);
    netTotal = netTotal.plus(raw);

    if (raw.lt(0)) {
      if (!assetClassKey || getText(getCell(row, assetClassKey)) !== 'Cash') {
        throw new Error('Invalid Xtrackers holding weight');
      }
      hasNegativeCash = true;
      negativeCash = negativeCash.plus(raw);
      continue;
    }

    if (assetClassKey && getText(getCell(row, assetClassKey)) === 'Cash') {
      positiveCash = positiveCash.plus(raw);
      const weight = raw.div(100).toNumber();
      const country = getText(getCell(row, countryKey));
      const sector = getText(getCell(row, sectorKey));
      cashCountries.push({
        name: country === '--' ? 'Other' : country,
        weight
      });
      cashSectors.push({
        name: sector === 'Unknown' ? 'Other' : sector,
        weight
      });
      continue;
    }

    const weight = raw.div(100).toNumber();

    const country = getText(getCell(row, countryKey));
    const sector = getText(getCell(row, sectorKey));

    countries.push({
      name: country === '--' ? 'Other' : country,
      weight
    });

    sectors.push({
      name: sector === 'Unknown' ? 'Other' : sector,
      weight
    });
  }

  if (hasNegativeCash) {
    // Only offset cash against cash; never alter equity weights or attribute
    // currency balances to an equity country or industry.
    const netCash = positiveCash.plus(negativeCash);
    if (netCash.lt(0)) {
      throw new Error('Negative Xtrackers net cash balance');
    }
    // Holdings feeds with negative cash must reconcile to the portfolio total.
    if (netTotal.minus(100).abs().gt(0.001)) {
      throw new Error('Invalid Xtrackers net holdings total');
    }
    const weight = netCash.div(100).toNumber();
    if (weight > 0) {
      countries.push({ name: 'Other', weight });
      sectors.push({ name: 'Other', weight });
    }
  } else {
    // Preserve existing XMME behavior when there is no negative cash.
    countries.push(...cashCountries);
    sectors.push(...cashSectors);
  }

  return normalizeEtfComposition({ countries, sectors });
}
