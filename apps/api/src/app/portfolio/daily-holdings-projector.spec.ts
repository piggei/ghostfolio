import { getFactor } from '@ghostfolio/api/helper/portfolio.helper';
import { INVESTMENT_ACTIVITY_TYPES } from '@ghostfolio/common/config';
import { getAssetProfileIdentifier } from '@ghostfolio/common/helper';

import {
  AssetSubClass,
  DataSource,
  Tag,
  Type as ActivityType
} from '@prisma/client';
import { Big } from 'big.js';
import { uniqBy } from 'lodash-es';

import { projectDailyHoldings } from './daily-holdings-projector';
import { HoldingBalance } from './interfaces/holding-balance.interface';
import { HoldingBalancesAtDate } from './interfaces/holding-balances-at-date.interface';
import { PortfolioCalculatorActivity } from './interfaces/portfolio-calculator-activity.interface';

function createTag(id: string): Tag {
  return {
    id,
    name: id,
    userId: null
  } as Tag;
}

interface ActivityOptions {
  date?: string;
  dataSource?: DataSource;
  fee?: number;
  feeInBaseCurrency?: number;
  quantity?: number;
  symbol?: string;
  tags?: Tag[];
  tax?: number;
  taxInBaseCurrency?: number;
  type?: ActivityType;
  unitPrice?: number;
}

function createActivity({
  date = '2024-01-01',
  dataSource = DataSource.YAHOO,
  fee = 0,
  feeInBaseCurrency = 0,
  quantity = 10,
  symbol = 'MSFT',
  tags = [],
  tax = 0,
  taxInBaseCurrency = 0,
  type = 'BUY',
  unitPrice = 100
}: ActivityOptions = {}): PortfolioCalculatorActivity {
  return {
    assetProfile: {
      assetSubClass: AssetSubClass.STOCK,
      currency: 'USD',
      dataSource,
      name: symbol,
      symbol,
      userId: undefined
    },
    date,
    fee: new Big(fee),
    feeInBaseCurrency: new Big(feeInBaseCurrency),
    quantity: new Big(quantity),
    tags,
    tax: new Big(tax),
    taxInBaseCurrency: new Big(taxInBaseCurrency),
    type,
    unitPrice: new Big(unitPrice)
  };
}

function projectDailyHoldingsLegacy(
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
        if (previousHoldingBalance.investment.gte(0)) {
          investment = previousHoldingBalance.investment.plus(
            quantity.mul(unitPrice)
          );
        } else {
          investment = previousHoldingBalance.investment.plus(
            quantity.mul(previousHoldingBalance.averagePrice)
          );
        }
      } else if (type === 'SELL') {
        if (previousHoldingBalance.investment.gt(0)) {
          investment = previousHoldingBalance.investment.minus(
            quantity.mul(previousHoldingBalance.averagePrice)
          );
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

describe('projectDailyHoldings', () => {
  it('matches the original PortfolioCalculator algorithm for complete historical snapshots', () => {
    const tag1 = createTag('tag-1');
    const tag2 = createTag('tag-2');

    const activities = [
      createActivity({
        date: '2024-01-01',
        symbol: 'MSFT',
        quantity: 10,
        unitPrice: 100,
        fee: 1,
        feeInBaseCurrency: 1.25,
        tax: 0.5,
        taxInBaseCurrency: 0.625,
        tags: [tag1]
      }),
      createActivity({
        date: '2024-01-01',
        symbol: 'AAPL',
        quantity: 2,
        unitPrice: 50
      }),
      createActivity({
        date: '2024-01-02',
        symbol: 'MSFT',
        type: 'SELL',
        quantity: 4,
        unitPrice: 120,
        fee: 2,
        feeInBaseCurrency: 2.5,
        tags: [tag1, tag2]
      }),
      createActivity({
        date: '2024-01-02',
        symbol: 'TSLA',
        type: 'SELL',
        quantity: 2,
        unitPrice: 10
      }),
      createActivity({
        date: '2024-01-03',
        symbol: 'MSFT',
        quantity: 2,
        unitPrice: 150,
        fee: 3,
        feeInBaseCurrency: 3.75,
        tax: 1,
        taxInBaseCurrency: 1.25,
        tags: [tag2]
      }),
      createActivity({
        date: '2024-01-03',
        symbol: 'TSLA',
        type: 'BUY',
        quantity: 1,
        unitPrice: 12
      }),
      createActivity({
        date: '2024-01-04',
        symbol: 'AAPL',
        type: 'SELL',
        quantity: 2,
        unitPrice: 60
      }),
      createActivity({
        date: '2024-01-04',
        symbol: 'MSFT',
        dataSource: DataSource.EOD_HISTORICAL_DATA,
        quantity: 3,
        unitPrice: 110
      }),
      createActivity({
        date: '2024-01-04',
        symbol: 'MSFT',
        type: 'FEE',
        quantity: 0,
        unitPrice: 0,
        fee: 0.25,
        feeInBaseCurrency: 0.3
      })
    ];

    const expected = projectDailyHoldingsLegacy(activities);
    const actual = projectDailyHoldings(activities);

    expect(actual).toEqual(expected);
  });

  it('returns an empty history without activities', () => {
    expect(projectDailyHoldings([])).toEqual([]);
  });

  it('preserves exact balances and cumulative costs after partial sales and buys', () => {
    const tag1 = createTag('tag-1');
    const tag2 = createTag('tag-2');

    const result = projectDailyHoldings([
      createActivity({
        date: '2024-01-01',
        fee: 1,
        feeInBaseCurrency: 1.25,
        quantity: 10,
        tags: [tag1],
        tax: 2,
        taxInBaseCurrency: 2.5,
        type: 'BUY',
        unitPrice: 100
      }),
      createActivity({
        date: '2024-01-02',
        fee: 2,
        feeInBaseCurrency: 2.5,
        quantity: 4,
        tags: [tag1, tag2],
        tax: 3,
        taxInBaseCurrency: 3.5,
        type: 'SELL',
        unitPrice: 120
      }),
      createActivity({
        date: '2024-01-03',
        fee: 3,
        feeInBaseCurrency: 3.75,
        quantity: 2,
        tags: [tag2],
        tax: 4,
        taxInBaseCurrency: 4.5,
        type: 'BUY',
        unitPrice: 150
      })
    ]);

    expect(result).toHaveLength(3);

    expect(result.map(({ date }) => date)).toEqual([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03'
    ]);

    const first = result[0].holdings[0];
    const afterSell = result[1].holdings[0];
    const final = result[2].holdings[0];

    expect(first).toMatchObject({
      activitiesCount: 1,
      averagePrice: new Big(100),
      investment: new Big(1000),
      quantity: new Big(10)
    });

    expect(afterSell).toMatchObject({
      activitiesCount: 2,
      averagePrice: new Big(100),
      investment: new Big(600),
      quantity: new Big(6)
    });

    expect(final).toMatchObject({
      activitiesCount: 3,
      averagePrice: new Big(112.5),
      investment: new Big(900),
      quantity: new Big(8),
      fee: new Big(6),
      feeInBaseCurrency: new Big(7.5),
      tax: new Big(9),
      taxInBaseCurrency: new Big(10.5),
      dateOfFirstActivity: '2024-01-01',
      tags: [tag1, tag2]
    });

    // Earlier snapshots must not be mutated by subsequent activities.
    expect(result[0].holdings[0].quantity).toEqual(new Big(10));
    expect(result[1].holdings[0].quantity).toEqual(new Big(6));
  });

  it('preserves cost basis when a long position becomes short and is partially covered', () => {
    const result = projectDailyHoldings([
      createActivity({
        date: '2024-01-01',
        quantity: 10,
        type: 'BUY',
        unitPrice: 10
      }),
      createActivity({
        date: '2024-01-02',
        quantity: 5,
        type: 'SELL',
        unitPrice: 12
      }),
      createActivity({
        date: '2024-01-03',
        quantity: 8,
        type: 'SELL',
        unitPrice: 12
      }),
      createActivity({
        date: '2024-01-04',
        quantity: 2,
        type: 'BUY',
        unitPrice: 11
      })
    ]);

    expect(result).toHaveLength(4);

    expect(result.map(({ holdings }) => holdings[0])).toMatchObject([
      {
        quantity: new Big(10),
        investment: new Big(100),
        averagePrice: new Big(10)
      },
      {
        quantity: new Big(5),
        investment: new Big(50),
        averagePrice: new Big(10)
      },
      {
        quantity: new Big(-3),
        investment: new Big(-36),
        averagePrice: new Big(12)
      },
      {
        quantity: new Big(-1),
        investment: new Big(-12),
        averagePrice: new Big(12)
      }
    ]);

    // Subsequent activities must not mutate historical snapshots.
    expect(result[0].holdings[0].quantity).toEqual(new Big(10));
    expect(result[1].holdings[0].investment).toEqual(new Big(50));
    expect(result[2].holdings[0].investment).toEqual(new Big(-36));
  });

  it('preserves cost basis when a short position becomes long and is partially sold', () => {
    const result = projectDailyHoldings([
      createActivity({
        date: '2024-01-01',
        quantity: 10,
        type: 'SELL',
        unitPrice: 10
      }),
      createActivity({
        date: '2024-01-02',
        quantity: 5,
        type: 'BUY',
        unitPrice: 12
      }),
      createActivity({
        date: '2024-01-03',
        quantity: 8,
        type: 'BUY',
        unitPrice: 12
      }),
      createActivity({
        date: '2024-01-04',
        quantity: 2,
        type: 'SELL',
        unitPrice: 11
      })
    ]);

    expect(result).toHaveLength(4);

    expect(result.map(({ holdings }) => holdings[0])).toMatchObject([
      {
        quantity: new Big(-10),
        investment: new Big(-100),
        averagePrice: new Big(10)
      },
      {
        quantity: new Big(-5),
        investment: new Big(-50),
        averagePrice: new Big(10)
      },
      {
        quantity: new Big(3),
        investment: new Big(36),
        averagePrice: new Big(12)
      },
      {
        quantity: new Big(1),
        investment: new Big(12),
        averagePrice: new Big(12)
      }
    ]);
  });

  it('preserves short-position cost basis when buying back part of a short', () => {
    const result = projectDailyHoldings([
      createActivity({
        date: '2024-01-01',
        quantity: 2,
        type: 'SELL',
        unitPrice: 10
      }),
      createActivity({
        date: '2024-01-02',
        quantity: 1,
        type: 'BUY',
        unitPrice: 12
      })
    ]);

    expect(result[0].holdings[0]).toMatchObject({
      investment: new Big(-20),
      quantity: new Big(-2),
      averagePrice: new Big(10)
    });

    expect(result[1].holdings[0]).toMatchObject({
      investment: new Big(-10),
      quantity: new Big(-1),
      averagePrice: new Big(10)
    });
  });

  it('resets investment and quantity when a position is fully closed', () => {
    const result = projectDailyHoldings([
      createActivity({
        date: '2024-01-01',
        quantity: 1,
        type: 'BUY',
        unitPrice: 100
      }),
      createActivity({
        date: '2024-01-02',
        quantity: 1,
        type: 'SELL',
        unitPrice: 120
      })
    ]);

    expect(result[1].holdings[0]).toMatchObject({
      averagePrice: new Big(0),
      investment: new Big(0),
      quantity: new Big(0)
    });
  });

  it('groups multiple activities on the same day into one snapshot', () => {
    const result = projectDailyHoldings([
      createActivity({
        date: '2024-01-01',
        quantity: 2,
        type: 'BUY'
      }),
      createActivity({
        date: '2024-01-01',
        quantity: 3,
        type: 'BUY'
      }),
      createActivity({
        date: '2024-01-01',
        quantity: 1,
        symbol: 'AAPL',
        type: 'BUY'
      })
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].holdings).toHaveLength(2);

    expect(result[0].holdings.map(({ symbol }) => symbol)).toEqual([
      'AAPL',
      'MSFT'
    ]);

    const msft = result[0].holdings.find(({ symbol }) => symbol === 'MSFT');

    expect(msft).toMatchObject({
      activitiesCount: 2,
      quantity: new Big(5),
      investment: new Big(500)
    });
  });

  it('keeps holdings with the same symbol but different data sources separate', () => {
    const result = projectDailyHoldings([
      createActivity({
        dataSource: DataSource.YAHOO,
        quantity: 1,
        symbol: 'MSFT'
      }),
      createActivity({
        dataSource: DataSource.EOD_HISTORICAL_DATA,
        quantity: 2,
        symbol: 'MSFT'
      })
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].holdings).toHaveLength(2);

    expect(
      result[0].holdings.map(({ dataSource, quantity }) => ({
        dataSource,
        quantity: quantity.toString()
      }))
    ).toEqual([
      {
        dataSource: DataSource.EOD_HISTORICAL_DATA,
        quantity: '2'
      },
      {
        dataSource: DataSource.YAHOO,
        quantity: '1'
      }
    ]);
  });

  it('preserves the original inclusion decision for non-investment activities', () => {
    const result = projectDailyHoldings([
      createActivity({
        date: '2024-01-01',
        fee: 5,
        quantity: 0,
        type: 'FEE',
        unitPrice: 0
      }),
      createActivity({
        date: '2024-01-02',
        quantity: 1,
        type: 'BUY',
        unitPrice: 100
      })
    ]);

    expect(result[0].holdings[0].includeInHoldings).toBe(false);

    expect(result[1].holdings[0]).toMatchObject({
      includeInHoldings: false,
      investment: new Big(100),
      quantity: new Big(1),
      fee: new Big(5)
    });
  });
});
