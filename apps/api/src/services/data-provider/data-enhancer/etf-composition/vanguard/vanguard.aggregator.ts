import { Big } from 'big.js';

import {
  ETF_WEIGHT_TOLERANCE,
  normalizeEtfComposition,
  NormalizedEtfComposition
} from '../etf-composition.normalizer';
import { VanguardHolding } from './vanguard.parser';

export interface VanguardCompositionResult {
  composition: NormalizedEtfComposition;
  reconciliation: {
    positiveWeight: number;
    negativeWeight: number;
    netWeight: number;
    classifiedCountryWeight: number;
    classifiedSectorWeight: number;
    unclassifiedCountryNetWeight: number;
    unclassifiedSectorNetWeight: number;
  };
}

const NET_WEIGHT_TOLERANCE = new Big('0.00001');

export function aggregateVanguardHoldings(
  holdings: VanguardHolding[]
): VanguardCompositionResult {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    throw new Error('Empty Vanguard holdings');
  }

  const countries = new Map<string, Big>();
  const sectors = new Map<string, Big>();

  let positiveWeight = new Big(0);
  let negativeWeight = new Big(0);
  let netWeight = new Big(0);

  let unclassifiedCountryNetWeight = new Big(0);
  let unclassifiedSectorNetWeight = new Big(0);

  for (const holding of holdings) {
    if (
      !holding ||
      typeof holding !== 'object' ||
      typeof holding.weight !== 'number' ||
      !Number.isFinite(holding.weight) ||
      typeof holding.securityType !== 'string' ||
      !holding.securityType.trim()
    ) {
      throw new Error('Invalid Vanguard holding');
    }

    const weight = new Big(holding.weight);

    const country = holding.country?.trim() || undefined;
    const sector = holding.sector?.trim() || undefined;

    if (weight.lt(0) && (country !== undefined || sector !== undefined)) {
      throw new Error('Classified negative Vanguard holding');
    }

    netWeight = netWeight.plus(weight);

    if (weight.gte(0)) {
      positiveWeight = positiveWeight.plus(weight);
    } else {
      negativeWeight = negativeWeight.plus(weight);
    }

    if (country) {
      countries.set(
        country,
        (countries.get(country) ?? new Big(0)).plus(weight)
      );
    } else {
      unclassifiedCountryNetWeight = unclassifiedCountryNetWeight.plus(weight);
    }

    if (sector) {
      sectors.set(sector, (sectors.get(sector) ?? new Big(0)).plus(weight));
    } else {
      unclassifiedSectorNetWeight = unclassifiedSectorNetWeight.plus(weight);
    }
  }

  if (netWeight.minus(1).abs().gt(NET_WEIGHT_TOLERANCE)) {
    throw new Error('Invalid Vanguard net holdings weight');
  }

  const countryExposures = [...countries].map(([name, weight]) => ({
    name,
    weight: weight.toNumber()
  }));

  const sectorExposures = [...sectors].map(([name, weight]) => ({
    name,
    weight: weight.toNumber()
  }));

  const countryTotal = [...countries.values()].reduce(
    (sum, weight) => sum.plus(weight),
    new Big(0)
  );

  const sectorTotal = [...sectors.values()].reduce(
    (sum, weight) => sum.plus(weight),
    new Big(0)
  );

  const maximumWeight = new Big(1).plus(ETF_WEIGHT_TOLERANCE);

  const validCountries = countryTotal.lte(maximumWeight);
  const validSectors = sectorTotal.lte(maximumWeight);

  const composition = normalizeEtfComposition({
    countries: validCountries ? countryExposures : [],
    sectors: validSectors ? sectorExposures : []
  });

  const classifiedCountryWeight = [...countries.values()].reduce(
    (sum, weight) => sum.plus(weight),
    new Big(0)
  );

  const classifiedSectorWeight = [...sectors.values()].reduce(
    (sum, weight) => sum.plus(weight),
    new Big(0)
  );

  if (
    !classifiedCountryWeight.plus(unclassifiedCountryNetWeight).eq(netWeight) ||
    !classifiedSectorWeight.plus(unclassifiedSectorNetWeight).eq(netWeight)
  ) {
    throw new Error('Vanguard exposure reconciliation failed');
  }

  return {
    composition,
    reconciliation: {
      positiveWeight: positiveWeight.toNumber(),
      negativeWeight: negativeWeight.toNumber(),
      netWeight: netWeight.toNumber(),
      classifiedCountryWeight: classifiedCountryWeight.toNumber(),
      classifiedSectorWeight: classifiedSectorWeight.toNumber(),
      unclassifiedCountryNetWeight: unclassifiedCountryNetWeight.toNumber(),
      unclassifiedSectorNetWeight: unclassifiedSectorNetWeight.toNumber()
    }
  };
}
