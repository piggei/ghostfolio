import { HoldingBalance } from '@ghostfolio/api/app/portfolio/interfaces/holding-balance.interface';
import { HoldingBalancesAtDate } from '@ghostfolio/api/app/portfolio/interfaces/holding-balances-at-date.interface';
import { PortfolioCalculatorActivity } from '@ghostfolio/api/app/portfolio/interfaces/portfolio-calculator-activity.interface';
import { getFactor } from '@ghostfolio/api/helper/portfolio.helper';
import { INVESTMENT_ACTIVITY_TYPES } from '@ghostfolio/common/config';
import { getAssetProfileIdentifier } from '@ghostfolio/common/helper';

import { Big } from 'big.js';
import { uniqBy } from 'lodash-es';

export function projectDailyHoldings(
  activities: readonly PortfolioCalculatorActivity[]
): HoldingBalancesAtDate[] {
  const holdingBalancesByDate: HoldingBalancesAtDate[] = [];

  const holdingBalancesByAssetProfileIdentifier: {
    [assetProfileIdentifier: string]: HoldingBalance;
  } = {};

  let lastDate: string = null;
  let latestHoldingBalances: HoldingBalancesAtDate = null;

  for (const {
    assetProfile,
    date,
    fee,
    feeInBaseCurrency,
    quantity,
    tags,
    tax,
    taxInBaseCurrency,
    type,
    unitPrice
  } of activities) {
    let holdingBalance: HoldingBalance;

    const assetSubClass = assetProfile.assetSubClass;
    const currency = assetProfile.currency;
    const dataSource = assetProfile.dataSource;
    const factor = getFactor(type);
    const skipErrors = !!assetProfile.userId;
    const symbol = assetProfile.symbol;

    const assetProfileIdentifier = getAssetProfileIdentifier(assetProfile);

    const previousHoldingBalance =
      holdingBalancesByAssetProfileIdentifier[assetProfileIdentifier];

    if (previousHoldingBalance) {
      let investment = previousHoldingBalance.investment;

      let newQuantity = quantity
        .mul(factor)
        .plus(previousHoldingBalance.quantity);

      if (type === 'BUY') {
        if (previousHoldingBalance.quantity.lt(0)) {
          const shortCoverQuantity = quantity.lt(
            previousHoldingBalance.quantity.abs()
          )
            ? quantity
            : previousHoldingBalance.quantity.abs();

          const openingLongQuantity = quantity.minus(shortCoverQuantity);

          investment = previousHoldingBalance.investment
            .plus(shortCoverQuantity.mul(previousHoldingBalance.averagePrice))
            .plus(openingLongQuantity.mul(unitPrice));
        } else {
          investment = previousHoldingBalance.investment.plus(
            quantity.mul(unitPrice)
          );
        }
      } else if (type === 'SELL') {
        if (previousHoldingBalance.quantity.gt(0)) {
          const closingLongQuantity = quantity.lt(
            previousHoldingBalance.quantity
          )
            ? quantity
            : previousHoldingBalance.quantity;

          const openingShortQuantity = quantity.minus(closingLongQuantity);

          investment = previousHoldingBalance.investment
            .minus(closingLongQuantity.mul(previousHoldingBalance.averagePrice))
            .minus(openingShortQuantity.mul(unitPrice));
        } else {
          investment = previousHoldingBalance.investment.minus(
            quantity.mul(unitPrice)
          );
        }
      }

      if (newQuantity.abs().lt(Number.EPSILON)) {
        investment = new Big(0);
        newQuantity = new Big(0);
      }

      holdingBalance = {
        assetSubClass,
        currency,
        dataSource,
        investment,
        skipErrors,
        symbol,
        activitiesCount: previousHoldingBalance.activitiesCount + 1,
        averagePrice: newQuantity.eq(0)
          ? new Big(0)
          : investment.div(newQuantity).abs(),
        dateOfFirstActivity: previousHoldingBalance.dateOfFirstActivity,
        fee: previousHoldingBalance.fee.plus(fee),
        feeInBaseCurrency:
          previousHoldingBalance.feeInBaseCurrency.plus(feeInBaseCurrency),
        includeInHoldings: previousHoldingBalance.includeInHoldings,
        quantity: newQuantity,
        tax: previousHoldingBalance.tax.plus(tax),
        taxInBaseCurrency:
          previousHoldingBalance.taxInBaseCurrency.plus(taxInBaseCurrency),
        tags: previousHoldingBalance.tags.concat(tags)
      };
    } else {
      holdingBalance = {
        assetSubClass,
        currency,
        dataSource,
        fee,
        feeInBaseCurrency,
        skipErrors,
        symbol,
        tags,
        tax,
        taxInBaseCurrency,
        activitiesCount: 1,
        averagePrice: unitPrice,
        dateOfFirstActivity: date,
        includeInHoldings: INVESTMENT_ACTIVITY_TYPES.includes(type),
        investment: unitPrice.mul(quantity).mul(factor),
        quantity: quantity.mul(factor)
      };
    }

    holdingBalance.tags = uniqBy(holdingBalance.tags, 'id');

    holdingBalancesByAssetProfileIdentifier[assetProfileIdentifier] =
      holdingBalance;

    const holdings = (latestHoldingBalances?.holdings ?? []).filter(
      (holding) => {
        return getAssetProfileIdentifier(holding) !== assetProfileIdentifier;
      }
    );

    holdings.push(holdingBalance);

    holdings.sort((a, b) => {
      return (
        a.symbol?.localeCompare(b.symbol) ||
        a.dataSource?.localeCompare(b.dataSource)
      );
    });

    if (lastDate !== date || latestHoldingBalances === null) {
      latestHoldingBalances = { date, holdings };
      holdingBalancesByDate.push(latestHoldingBalances);
    } else {
      latestHoldingBalances.holdings = holdings;
    }

    lastDate = date;
  }

  return holdingBalancesByDate;
}
