import { calculateCashBalances } from './cash-balance-calculator';
import { projectDailyCashBalances } from './daily-cash-balance-projection';

type LedgerInput = Parameters<typeof calculateCashBalances>[0];

function project(
  input: LedgerInput,
  startDate = '2026-10-01',
  endDate = '2026-10-05'
) {
  return projectDailyCashBalances({
    balances: calculateCashBalances(input).balances,
    startDate,
    endDate
  });
}

function available(date: string, balance: string) {
  return { date, status: 'available', balance };
}

const openingBalance = { date: '2026-10-01', balance: '100', sequence: 0 };

describe('Daily cash balance projection', () => {
  it('includes opening and carries through consecutive days without transactions', () => {
    expect(project({ openingBalance, events: [] })).toEqual([
      available('2026-10-01', '100'),
      available('2026-10-02', '100'),
      available('2026-10-03', '100'),
      available('2026-10-04', '100'),
      available('2026-10-05', '100')
    ]);
  });

  it('projects deposits and withdrawals, retaining the balance preceding the requested range', () => {
    expect(
      project(
        {
          openingBalance,
          events: [
            { date: '2026-10-02', sequence: 1, type: 'MOVEMENT', amount: '50' },
            {
              date: '2026-10-04',
              sequence: 2,
              type: 'MOVEMENT',
              amount: '-20'
            },
            { date: '2026-10-06', sequence: 3, type: 'MOVEMENT', amount: '999' }
          ]
        },
        '2026-10-03'
      )
    ).toEqual([
      available('2026-10-03', '150'),
      available('2026-10-04', '130'),
      available('2026-10-05', '130')
    ]);
  });

  it('uses the final same-day balance, including a checkpoint between movements', () => {
    expect(
      project(
        {
          openingBalance,
          events: [
            {
              date: '2026-10-01',
              sequence: 30,
              type: 'MOVEMENT',
              amount: '-20'
            },
            {
              date: '2026-10-01',
              sequence: 10,
              type: 'MOVEMENT',
              amount: '50'
            },
            {
              date: '2026-10-01',
              sequence: 20,
              type: 'CHECKPOINT',
              balance: '80'
            }
          ]
        },
        '2026-10-01',
        '2026-10-02'
      )
    ).toEqual([available('2026-10-01', '60'), available('2026-10-02', '60')]);
  });

  it('carries a retroactive change only as far as the next checkpoint', () => {
    const events: LedgerInput['events'] = [
      { date: '2026-10-02', sequence: 1, type: 'MOVEMENT', amount: '-30' },
      { date: '2026-10-04', sequence: 2, type: 'CHECKPOINT', balance: '90' }
    ];
    const original = project({ openingBalance, events });
    const revised = project({
      openingBalance,
      events: [
        ...events,
        { date: '2026-10-02', sequence: 3, type: 'MOVEMENT', amount: '20' }
      ]
    });
    expect(original).toEqual([
      available('2026-10-01', '100'),
      available('2026-10-02', '70'),
      available('2026-10-03', '70'),
      available('2026-10-04', '90'),
      available('2026-10-05', '90')
    ]);
    expect(revised).toEqual([
      available('2026-10-01', '100'),
      available('2026-10-02', '90'),
      available('2026-10-03', '90'),
      available('2026-10-04', '90'),
      available('2026-10-05', '90')
    ]);
  });

  it.each(['-20', '0'])('preserves the verified balance %s', (balance) => {
    expect(
      project(
        { openingBalance: { ...openingBalance, balance }, events: [] },
        '2026-10-01',
        '2026-10-01'
      )
    ).toEqual([available('2026-10-01', balance)]);
  });

  it('does not invent zero before opening', () => {
    expect(
      project({ openingBalance, events: [] }, '2026-09-30', '2026-10-01')
    ).toEqual([
      {
        date: '2026-09-30',
        status: 'unavailable',
        balance: null,
        reason: 'no_opening_balance'
      },
      available('2026-10-01', '100')
    ]);
  });

  it('returns unavailable for every requested day when no opening is supplied', () => {
    expect(
      projectDailyCashBalances({
        balances: [],
        startDate: '2026-09-29',
        endDate: '2026-09-30'
      })
    ).toEqual([
      {
        date: '2026-09-29',
        status: 'unavailable',
        balance: null,
        reason: 'no_opening_balance'
      },
      {
        date: '2026-09-30',
        status: 'unavailable',
        balance: null,
        reason: 'no_opening_balance'
      }
    ]);
  });

  it.each([
    ['2026-12-31', '2027-01-02', ['2026-12-31', '2027-01-01', '2027-01-02']],
    ['2024-02-28', '2024-03-01', ['2024-02-28', '2024-02-29', '2024-03-01']],
    ['2026-03-28', '2026-03-30', ['2026-03-28', '2026-03-29', '2026-03-30']],
    ['2026-10-24', '2026-10-26', ['2026-10-24', '2026-10-25', '2026-10-26']]
  ])('preserves civil dates from %s to %s', (startDate, endDate, dates) => {
    expect(
      project(
        { openingBalance: { ...openingBalance, date: startDate }, events: [] },
        startDate,
        endDate
      )
    ).toEqual(dates.map((date) => available(date, '100')));
  });

  it('preserves high precision through ledger calculation and carry-forward', () => {
    expect(
      project(
        {
          openingBalance: {
            ...openingBalance,
            balance: '9007199254740993.00000000000000000001'
          },
          events: [
            {
              date: '2026-10-02',
              sequence: 1,
              type: 'MOVEMENT',
              amount: '0.00000000000000000002'
            }
          ]
        },
        '2026-10-02',
        '2026-10-03'
      )
    ).toEqual([
      available('2026-10-02', '9007199254740993.00000000000000000003'),
      available('2026-10-03', '9007199254740993.00000000000000000003')
    ]);
  });

  it('does not mutate canonical balances and returns deterministic results', () => {
    const balances = Object.freeze(
      calculateCashBalances({ openingBalance, events: [] }).balances
    );
    const before = JSON.stringify(balances);
    const input = { balances, startDate: '2026-10-01', endDate: '2026-10-02' };
    expect(projectDailyCashBalances(input)).toEqual(
      projectDailyCashBalances(input)
    );
    expect(JSON.stringify(balances)).toBe(before);
  });

  it.each([
    '',
    '2026-2-01',
    '2026-02-30',
    '2023-02-29',
    '2026-13-01',
    '2026-10-01T00:00:00Z'
  ])('rejects invalid range date %s at either boundary', (date) => {
    expect(() =>
      projectDailyCashBalances({
        balances: [],
        startDate: date,
        endDate: '2026-10-01'
      })
    ).toThrow();
    expect(() =>
      projectDailyCashBalances({
        balances: [],
        startDate: '2026-10-01',
        endDate: date
      })
    ).toThrow();
  });

  it('rejects a reversed range', () => {
    expect(() =>
      projectDailyCashBalances({
        balances: [],
        startDate: '2026-10-02',
        endDate: '2026-10-01'
      })
    ).toThrow(RangeError);
  });

  it('rejects unordered or duplicate canonical dates rather than silently choosing a balance', () => {
    const { balances } = calculateCashBalances({
      openingBalance,
      events: [
        { date: '2026-10-02', sequence: 1, type: 'MOVEMENT', amount: '50' }
      ]
    });
    for (const invalid of [
      [balances[1], balances[0]],
      [balances[0], balances[0]]
    ]) {
      expect(() =>
        projectDailyCashBalances({
          balances: invalid,
          startDate: '2026-10-01',
          endDate: '2026-10-02'
        })
      ).toThrow(RangeError);
    }
  });
});
