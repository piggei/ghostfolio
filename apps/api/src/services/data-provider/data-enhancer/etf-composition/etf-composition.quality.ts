import { SECTORS } from '@ghostfolio/common/config';

import { countries } from 'countries-list';

import { ETF_WEIGHT_TOLERANCE } from './etf-composition.normalizer';

interface Quality {
  valid: boolean;
  coverage: number;
  classified: number;
}

// Existing profiles have no per-dimension provenance/date. Preserve complete
// data conservatively; only improve strictly greater classified coverage.
export function compositionQuality(
  value: unknown,
  dimension: 'countries' | 'sectors'
): Quality {
  if (!Array.isArray(value))
    return { valid: false, coverage: 0, classified: 0 };
  const names = new Set<string>();
  let coverage = 0;
  let classified = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object')
      return { valid: false, coverage: 0, classified: 0 };
    const name = dimension === 'countries' ? entry.code : entry.name;
    if (
      typeof name !== 'string' ||
      !name ||
      names.has(name) ||
      typeof entry.weight !== 'number' ||
      !Number.isFinite(entry.weight) ||
      entry.weight < 0 ||
      entry.weight > 1
    )
      return { valid: false, coverage: 0, classified: 0 };
    if (
      dimension === 'countries' &&
      !Object.prototype.hasOwnProperty.call(countries, name)
    )
      return { valid: false, coverage: 0, classified: 0 };
    if (
      dimension === 'sectors' &&
      !(SECTORS as readonly string[]).includes(name)
    )
      return { valid: false, coverage: 0, classified: 0 };
    names.add(name);
    coverage += entry.weight;
    if (name !== 'Other') classified += entry.weight;
  }
  return { valid: coverage <= 1 + ETF_WEIGHT_TOLERANCE, coverage, classified };
}

export function needsComposition(
  value: unknown,
  dimension: 'countries' | 'sectors'
): boolean {
  const quality = compositionQuality(value, dimension);
  return !quality.valid || quality.classified < 0.95;
}

export function improvesComposition(
  existing: unknown,
  candidate: unknown,
  dimension: 'countries' | 'sectors'
): boolean {
  const next = compositionQuality(candidate, dimension);
  const previous = compositionQuality(existing, dimension);
  return (
    next.valid &&
    next.classified > 0 &&
    (!previous.valid ||
      next.classified > previous.classified + ETF_WEIGHT_TOLERANCE) &&
    needsComposition(existing, dimension)
  );
}
