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
  sector: 'Industry'
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

  for (const row of table.values) {
    if (!isRecord(row)) {
      throw new Error('Invalid Xtrackers holding');
    }

    const rawWeight = getCell(row, weightKey).sortValue;

    if (
      typeof rawWeight !== 'number' ||
      !Number.isFinite(rawWeight) ||
      rawWeight < 0
    ) {
      throw new Error('Invalid Xtrackers holding weight');
    }

    const weight = new Big(rawWeight).div(100).toNumber();

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

  return normalizeEtfComposition({ countries, sectors });
}
