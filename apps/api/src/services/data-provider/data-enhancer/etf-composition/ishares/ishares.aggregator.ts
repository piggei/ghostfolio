import { Big } from 'big.js';

import {
  normalizeEtfComposition,
  NormalizedEtfComposition
} from '../etf-composition.normalizer';
import { IsharesHolding } from './ishares.parser';

export interface IsharesCompositionResult {
  composition: NormalizedEtfComposition;
  reconciliation: {
    totalMarketValue: string;
    equityMarketValue: string;
    nonEquityMarketValue: string;
    negativeMarketValue: string;
    equityWeight: number;
    nonEquityWeight: number;
    publishedWeightTotal: number;
    maximumPublishedWeightDifference: number;
  };
}

const PUBLISHED_WEIGHT_TOLERANCE = new Big('0.0051');

const UNKNOWN = new Set(['', '-', '--', 'unknown', 'other', 'n/a']);

function isUnknown(value: string): boolean {
  return UNKNOWN.has(value.trim().toLowerCase());
}

export function aggregateIsharesHoldings(
  holdings: IsharesHolding[]
): IsharesCompositionResult {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    throw new Error('Empty iShares holdings');
  }

  let totalMarketValue = new Big(0);
  let equityMarketValue = new Big(0);
  let nonEquityMarketValue = new Big(0);
  let negativeMarketValue = new Big(0);
  let publishedWeightTotal = new Big(0);

  for (const holding of holdings) {
    if (!holding || typeof holding !== 'object') {
      throw new Error('Invalid iShares holding');
    }

    const marketValue = new Big(holding.marketValue);
    const publishedWeight = new Big(holding.publishedWeight);

    totalMarketValue = totalMarketValue.plus(marketValue);
    publishedWeightTotal = publishedWeightTotal.plus(publishedWeight);

    if (marketValue.lt(0)) {
      negativeMarketValue = negativeMarketValue.plus(marketValue);
    }

    if (holding.assetClass === 'Equity') {
      if (marketValue.lt(0)) {
        throw new Error('Negative iShares equity market value');
      }

      equityMarketValue = equityMarketValue.plus(marketValue);
    } else {
      nonEquityMarketValue = nonEquityMarketValue.plus(marketValue);
    }
  }

  if (totalMarketValue.lte(0)) {
    throw new Error('Invalid iShares total market value');
  }

  if (!equityMarketValue.plus(nonEquityMarketValue).eq(totalMarketValue)) {
    throw new Error('iShares market value reconciliation failed');
  }

  const countries = new Map<string, Big>();
  const sectors = new Map<string, Big>();

  let maximumPublishedWeightDifference = new Big(0);

  for (const holding of holdings) {
    const marketValue = new Big(holding.marketValue);
    const publishedWeight = new Big(holding.publishedWeight);

    const weight = marketValue.div(totalMarketValue);
    const calculatedPercentage = weight.times(100);

    const difference = calculatedPercentage.minus(publishedWeight).abs();

    if (difference.gt(maximumPublishedWeightDifference)) {
      maximumPublishedWeightDifference = difference;
    }

    if (difference.gt(PUBLISHED_WEIGHT_TOLERANCE)) {
      throw new Error('Inconsistent iShares published weight');
    }

    if (holding.assetClass !== 'Equity') {
      continue;
    }

    if (!isUnknown(holding.location)) {
      countries.set(
        holding.location,
        (countries.get(holding.location) ?? new Big(0)).plus(weight)
      );
    }

    if (!isUnknown(holding.sector)) {
      sectors.set(
        holding.sector,
        (sectors.get(holding.sector) ?? new Big(0)).plus(weight)
      );
    }
  }

  const composition = normalizeEtfComposition({
    countries: [...countries].map(([name, weight]) => ({
      name,
      weight: weight.toNumber()
    })),
    sectors: [...sectors].map(([name, weight]) => ({
      name,
      weight: weight.toNumber()
    }))
  });

  return {
    composition,
    reconciliation: {
      totalMarketValue: totalMarketValue.toString(),
      equityMarketValue: equityMarketValue.toString(),
      nonEquityMarketValue: nonEquityMarketValue.toString(),
      negativeMarketValue: negativeMarketValue.toString(),
      equityWeight: equityMarketValue.div(totalMarketValue).toNumber(),
      nonEquityWeight: nonEquityMarketValue.div(totalMarketValue).toNumber(),
      publishedWeightTotal: publishedWeightTotal.toNumber(),
      maximumPublishedWeightDifference:
        maximumPublishedWeightDifference.toNumber()
    }
  };
}
