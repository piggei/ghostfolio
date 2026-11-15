import type { PortfolioCalculatorActivity } from '@ghostfolio/api/app/portfolio/interfaces/portfolio-calculator-activity.interface';
import { DATE_FORMAT } from '@ghostfolio/common/helper';
import type { Activity } from '@ghostfolio/common/interfaces';

import { Big } from 'big.js';
import { format } from 'date-fns';

/**
 * Adapts securities activities to the historical holdings projector.
 *
 * Financial fields follow PortfolioCalculator's original transformation.
 * Future activity dates are preserved rather than moved to today, because
 * a historical daily NAV must not anticipate future transactions.
 */
export function adaptDailyHoldingsActivities(
  activities: readonly Activity[]
): PortfolioCalculatorActivity[] {
  return activities
    .map(
      ({
        assetProfile,
        date,
        feeInAssetProfileCurrency,
        feeInBaseCurrency,
        quantity,
        taxInAssetProfileCurrency,
        taxInBaseCurrency,
        tags = [],
        type,
        unitPriceInAssetProfileCurrency
      }): PortfolioCalculatorActivity => ({
        assetProfile,
        tags,
        type,
        date: format(date, DATE_FORMAT),
        fee: new Big(feeInAssetProfileCurrency),
        feeInBaseCurrency: new Big(feeInBaseCurrency),
        quantity: new Big(quantity),
        tax: new Big(taxInAssetProfileCurrency ?? 0),
        taxInBaseCurrency: new Big(taxInBaseCurrency ?? 0),
        unitPrice: new Big(unitPriceInAssetProfileCurrency)
      })
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
