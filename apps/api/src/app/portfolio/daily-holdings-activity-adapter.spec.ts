import type { Activity } from '@ghostfolio/common/interfaces';

import { Big } from 'big.js';

import { adaptDailyHoldingsActivities } from './daily-holdings-activity-adapter';
import { projectDailyHoldings } from './daily-holdings-projector';

function createActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    assetProfile: {
      assetSubClass: 'STOCK',
      currency: 'USD',
      dataSource: 'YAHOO',
      name: 'Microsoft',
      symbol: 'MSFT',
      userId: null
    },
    date: new Date('2024-01-15T12:00:00.000Z'),
    feeInAssetProfileCurrency: 1.25,
    feeInBaseCurrency: 1.15,
    quantity: 1 / 3,
    taxInAssetProfileCurrency: 0.15,
    taxInBaseCurrency: 0.14,
    tags: [],
    type: 'BUY',
    unitPriceInAssetProfileCurrency: 100.25,
    ...overrides
  } as Activity;
}

describe('adaptDailyHoldingsActivities', () => {
  it('converts financial fields using the original PortfolioCalculator mapping', () => {
    const activity = createActivity();

    const [result] = adaptDailyHoldingsActivities([activity]);

    expect(result).toMatchObject({
      date: '2024-01-15',
      type: 'BUY',
      assetProfile: activity.assetProfile,
      tags: activity.tags
    });

    expect(result.quantity).toBeInstanceOf(Big);
    expect(result.quantity.toString()).toBe(
      new Big(activity.quantity).toString()
    );

    expect(result.unitPrice.toString()).toBe('100.25');
    expect(result.fee.toString()).toBe('1.25');
    expect(result.feeInBaseCurrency.toString()).toBe('1.15');
    expect(result.tax.toString()).toBe('0.15');
    expect(result.taxInBaseCurrency.toString()).toBe('0.14');
  });

  it('sorts activities chronologically and preserves same-day ordering', () => {
    const first = createActivity({
      date: new Date('2024-01-16T09:00:00.000Z'),
      quantity: 1
    });

    const second = createActivity({
      date: new Date('2024-01-15T09:00:00.000Z'),
      quantity: 2
    });

    const third = createActivity({
      date: new Date('2024-01-15T15:00:00.000Z'),
      quantity: 3
    });

    const result = adaptDailyHoldingsActivities([first, second, third]);

    expect(result.map(({ date }) => date)).toEqual([
      '2024-01-15',
      '2024-01-15',
      '2024-01-16'
    ]);

    expect(result.map(({ quantity }) => quantity.toString())).toEqual([
      '2',
      '3',
      '1'
    ]);
  });

  it('preserves future activity dates without anticipating transactions', () => {
    const activity = createActivity({
      date: new Date('2099-06-15T12:00:00.000Z')
    });

    const [result] = adaptDailyHoldingsActivities([activity]);

    expect(result.date).toBe('2099-06-15');
  });

  it('does not mutate the original activities', () => {
    const activity = createActivity({
      tags: [],
      date: new Date('2024-01-15T12:00:00.000Z')
    });

    const originalDate = activity.date;
    const originalQuantity = activity.quantity;
    const originalFee = activity.feeInAssetProfileCurrency;

    adaptDailyHoldingsActivities([activity]);

    expect(activity.date).toBe(originalDate);
    expect(activity.quantity).toBe(originalQuantity);
    expect(activity.feeInAssetProfileCurrency).toBe(originalFee);
  });

  it('preserves the original cost basis through the complete adapter and projector pipeline', () => {
    const activities = [
      createActivity({
        date: new Date('2024-01-01T12:00:00.000Z'),
        feeInAssetProfileCurrency: 1,
        feeInBaseCurrency: 1.25,
        quantity: 10,
        taxInAssetProfileCurrency: 2,
        taxInBaseCurrency: 2.5,
        type: 'BUY',
        unitPriceInAssetProfileCurrency: 100
      }),
      createActivity({
        date: new Date('2024-01-02T12:00:00.000Z'),
        feeInAssetProfileCurrency: 2,
        feeInBaseCurrency: 2.5,
        quantity: 4,
        taxInAssetProfileCurrency: 3,
        taxInBaseCurrency: 3.5,
        type: 'SELL',
        unitPriceInAssetProfileCurrency: 120
      }),
      createActivity({
        date: new Date('2024-01-03T12:00:00.000Z'),
        feeInAssetProfileCurrency: 3,
        feeInBaseCurrency: 3.75,
        quantity: 2,
        taxInAssetProfileCurrency: 4,
        taxInBaseCurrency: 4.5,
        type: 'BUY',
        unitPriceInAssetProfileCurrency: 150
      })
    ];

    const adaptedActivities = adaptDailyHoldingsActivities(activities);
    const history = projectDailyHoldings(adaptedActivities);

    expect(history).toHaveLength(3);

    expect(history[0].holdings[0]).toMatchObject({
      quantity: new Big(10),
      investment: new Big(1000),
      averagePrice: new Big(100)
    });

    expect(history[1].holdings[0]).toMatchObject({
      quantity: new Big(6),
      investment: new Big(600),
      averagePrice: new Big(100)
    });

    expect(history[2].holdings[0]).toMatchObject({
      activitiesCount: 3,
      quantity: new Big(8),
      investment: new Big(900),
      averagePrice: new Big(112.5),
      fee: new Big(6),
      feeInBaseCurrency: new Big(7.5),
      tax: new Big(9),
      taxInBaseCurrency: new Big(10.5),
      dateOfFirstActivity: '2024-01-01'
    });
  });
});
