import {
  projectDailyManagedCash,
  type DailyManagedCashSnapshot
} from './daily-managed-cash-projection';

describe('Daily managed cash projection', () => {
  const snapshot = (
    overrides: Partial<DailyManagedCashSnapshot> = {}
  ): DailyManagedCashSnapshot => ({
    accountId: 'account-1',
    currency: 'EUR',
    includeCashInPortfolio: true,
    isAutomaticOpening: false,
    events: [],
    openingBalance: {
      date: '2026-10-01',
      sequence: 0,
      balance: '1000'
    },
    revision: 3,
    ...overrides
  });

  const project = (
    overrides: Partial<DailyManagedCashSnapshot> = {},
    startDate = '2026-10-01',
    endDate = '2026-10-04'
  ) =>
    projectDailyManagedCash({
      snapshot: snapshot(overrides),
      startDate,
      endDate
    });

  it('preserves the explicit opening balance across empty days', () => {
    const result = project();

    expect(result).toMatchObject({
      accountId: 'account-1',
      currency: 'EUR',
      included: true,
      revision: 3
    });

    expect(result.balances).toEqual([
      { date: '2026-10-01', status: 'available', balance: '1000' },
      { date: '2026-10-02', status: 'available', balance: '1000' },
      { date: '2026-10-03', status: 'available', balance: '1000' },
      { date: '2026-10-04', status: 'available', balance: '1000' }
    ]);
  });

  it('subtracts a movement fee exactly once', () => {
    const result = project({
      events: [
        {
          date: '2026-10-02',
          sequence: 1,
          type: 'MOVEMENT',
          amount: '200',
          fee: '2.50'
        }
      ]
    });

    expect(result.balances[1]).toEqual({
      date: '2026-10-02',
      status: 'available',
      balance: '1197.5'
    });
  });

  it('uses the final balance after multiple same-day movements', () => {
    const result = project({
      events: [
        {
          date: '2026-10-02',
          sequence: 1,
          type: 'MOVEMENT',
          amount: '100.125'
        },
        {
          date: '2026-10-02',
          sequence: 2,
          type: 'MOVEMENT',
          amount: '-25.025'
        }
      ]
    });

    expect(result.balances[1]).toMatchObject({
      status: 'available',
      balance: '1075.1'
    });
  });

  it('honors reconciliation checkpoints', () => {
    const result = project({
      events: [
        {
          date: '2026-10-02',
          sequence: 1,
          type: 'MOVEMENT',
          amount: '200'
        },
        {
          date: '2026-10-03',
          sequence: 2,
          type: 'CHECKPOINT',
          balance: '900.25'
        }
      ]
    });

    expect(result.balances[1].balance).toBe('1200');
    expect(result.balances[2].balance).toBe('900.25');
    expect(result.balances[3].balance).toBe('900.25');
  });

  it('preserves negative balances without clamping', () => {
    const result = project({
      events: [
        {
          date: '2026-10-02',
          sequence: 1,
          type: 'MOVEMENT',
          amount: '-1200.125'
        }
      ]
    });

    expect(result.balances[1]).toEqual({
      date: '2026-10-02',
      status: 'available',
      balance: '-200.125'
    });
  });

  it('preserves exclusion without discarding account history', () => {
    const result = project({
      includeCashInPortfolio: false
    });

    expect(result.included).toBe(false);
    expect(result.balances[0]).toMatchObject({
      status: 'available',
      balance: '1000'
    });
  });

  it('does not invent a balance before an explicit opening', () => {
    const result = project(
      {
        openingBalance: {
          date: '2026-10-03',
          sequence: 0,
          balance: '1000'
        }
      },
      '2026-10-01',
      '2026-10-04'
    );

    expect(result.balances).toEqual([
      {
        date: '2026-10-01',
        status: 'unavailable',
        balance: null,
        reason: 'no_opening_balance'
      },
      {
        date: '2026-10-02',
        status: 'unavailable',
        balance: null,
        reason: 'no_opening_balance'
      },
      { date: '2026-10-03', status: 'available', balance: '1000' },
      { date: '2026-10-04', status: 'available', balance: '1000' }
    ]);
  });

  it('starts automatic opening history at the first checkpoint', () => {
    const result = project(
      {
        isAutomaticOpening: true,
        openingBalance: {
          date: '0001-01-01',
          sequence: 0,
          balance: '0'
        },
        events: [
          {
            date: '2026-10-01',
            sequence: 1,
            type: 'MOVEMENT',
            amount: '25'
          },
          {
            date: '2026-10-02',
            sequence: 2,
            type: 'CHECKPOINT',
            balance: '125.50'
          },
          {
            date: '2026-10-03',
            sequence: 3,
            type: 'MOVEMENT',
            amount: '10'
          }
        ]
      },
      '2026-10-01',
      '2026-10-03'
    );

    expect(result.balances).toEqual([
      {
        date: '2026-10-01',
        status: 'unavailable',
        balance: null,
        reason: 'no_opening_balance'
      },
      { date: '2026-10-02', status: 'available', balance: '125.5' },
      { date: '2026-10-03', status: 'available', balance: '135.5' }
    ]);
  });

  it('preserves automatic zero history before the first movement', () => {
    const result = project(
      {
        isAutomaticOpening: true,
        openingBalance: {
          date: '0001-01-01',
          sequence: 0,
          balance: '0'
        },
        events: [
          {
            date: '2026-10-02',
            sequence: 1,
            type: 'MOVEMENT',
            amount: '125'
          }
        ]
      },
      '2026-10-01',
      '2026-10-03'
    );

    expect(result.balances).toEqual([
      { date: '2026-10-01', status: 'available', balance: '0' },
      { date: '2026-10-02', status: 'available', balance: '125' },
      { date: '2026-10-03', status: 'available', balance: '125' }
    ]);
  });

  it('preserves zero history for an empty automatic ledger', () => {
    const result = project(
      {
        isAutomaticOpening: true,
        openingBalance: {
          date: '0001-01-01',
          sequence: 0,
          balance: '0'
        },
        events: []
      },
      '2026-10-01',
      '2026-10-03'
    );

    expect(
      result.balances.every(
        (row) => row.status === 'available' && row.balance === '0'
      )
    ).toBe(true);
  });
});
