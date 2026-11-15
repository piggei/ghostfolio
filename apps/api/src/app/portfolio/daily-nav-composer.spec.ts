import { composeDailyNav } from './daily-nav-composer';

describe('Daily NAV composer', () => {
  it('combines securities and included cash without rounding', () => {
    expect(
      composeDailyNav({
        date: '2026-10-02',
        securitiesValue: '2500.123456789012345678',
        cashAccounts: [
          {
            accountId: 'eur',
            currency: 'EUR',
            balance: '1000.123456789012345678',
            included: true
          }
        ],
        baseCurrency: 'EUR',
        exchangeRates: {}
      })
    ).toEqual({
      date: '2026-10-02',
      status: 'available',
      nav: '3500.246913578024691356'
    });
  });

  it('excludes cash accounts outside the portfolio scope', () => {
    expect(
      composeDailyNav({
        date: '2026-10-02',
        securitiesValue: '500',
        cashAccounts: [
          {
            accountId: 'included',
            currency: 'EUR',
            balance: '100',
            included: true
          },
          {
            accountId: 'excluded',
            currency: 'EUR',
            balance: '900',
            included: false
          }
        ],
        baseCurrency: 'EUR',
        exchangeRates: {}
      })
    ).toMatchObject({
      status: 'available',
      nav: '600'
    });
  });

  it('converts foreign cash with the explicitly supplied historical rate', () => {
    expect(
      composeDailyNav({
        date: '2026-10-02',
        securitiesValue: '100',
        cashAccounts: [
          {
            accountId: 'chf',
            currency: 'CHF',
            balance: '200',
            included: true
          }
        ],
        baseCurrency: 'EUR',
        exchangeRates: { CHF: '1.05' }
      })
    ).toMatchObject({
      status: 'available',
      nav: '310'
    });
  });

  it('rejects missing historical FX instead of assuming parity', () => {
    expect(
      composeDailyNav({
        date: '2026-10-02',
        securitiesValue: '100',
        cashAccounts: [
          {
            accountId: 'chf',
            currency: 'CHF',
            balance: '200',
            included: true
          }
        ],
        baseCurrency: 'EUR',
        exchangeRates: {}
      })
    ).toMatchObject({
      status: 'unavailable',
      nav: null,
      reason: 'missing_exchange_rate'
    });
  });

  it('rejects missing securities valuation', () => {
    expect(
      composeDailyNav({
        date: '2026-10-02',
        securitiesValue: null,
        cashAccounts: [],
        baseCurrency: 'EUR',
        exchangeRates: {}
      })
    ).toMatchObject({
      status: 'unavailable',
      nav: null,
      reason: 'missing_securities_valuation'
    });
  });

  it('accepts a verified zero NAV', () => {
    expect(
      composeDailyNav({
        date: '2026-10-02',
        securitiesValue: '0',
        cashAccounts: [],
        baseCurrency: 'EUR',
        exchangeRates: {}
      })
    ).toEqual({
      date: '2026-10-02',
      status: 'available',
      nav: '0'
    });
  });
});

describe('Daily NAV composer edge cases', () => {
  const baseInput = {
    date: '2026-10-02',
    securitiesValue: '100',
    baseCurrency: 'EUR',
    exchangeRates: {}
  };

  it('rejects an unavailable included cash balance', () => {
    expect(
      composeDailyNav({
        ...baseInput,
        cashAccounts: [
          {
            accountId: 'cash',
            currency: 'EUR',
            balance: null,
            included: true
          }
        ]
      })
    ).toMatchObject({
      status: 'unavailable',
      nav: null,
      reason: 'missing_cash_balance'
    });
  });

  it.each(['0', '-1', 'not-a-rate'])('rejects invalid FX rate %s', (rate) => {
    expect(
      composeDailyNav({
        ...baseInput,
        cashAccounts: [
          {
            accountId: 'chf',
            currency: 'CHF',
            balance: '200',
            included: true
          }
        ],
        exchangeRates: { CHF: rate }
      })
    ).toMatchObject({
      status: 'unavailable',
      nav: null,
      reason: 'invalid_decimal'
    });
  });

  it('supports negative cash balances', () => {
    expect(
      composeDailyNav({
        ...baseInput,
        cashAccounts: [
          {
            accountId: 'overdraft',
            currency: 'EUR',
            balance: '-150.25',
            included: true
          }
        ]
      })
    ).toMatchObject({
      status: 'available',
      nav: '-50.25'
    });
  });

  it('aggregates multiple accounts without intermediate rounding', () => {
    expect(
      composeDailyNav({
        ...baseInput,
        cashAccounts: [
          {
            accountId: 'one',
            currency: 'CHF',
            balance: '0.000000000000000001',
            included: true
          },
          {
            accountId: 'two',
            currency: 'CHF',
            balance: '0.000000000000000002',
            included: true
          }
        ],
        exchangeRates: { CHF: '1.123456789012345678' }
      })
    ).toMatchObject({
      status: 'available',
      nav: '100.000000000000000003370370367037037034'
    });
  });

  it('ignores excluded accounts even when their balances are missing', () => {
    expect(
      composeDailyNav({
        ...baseInput,
        cashAccounts: [
          {
            accountId: 'excluded',
            currency: 'CHF',
            balance: null,
            included: false
          }
        ]
      })
    ).toMatchObject({
      status: 'available',
      nav: '100'
    });
  });

  it('rejects malformed securities valuation', () => {
    expect(
      composeDailyNav({
        ...baseInput,
        securitiesValue: 'not-a-number',
        cashAccounts: []
      })
    ).toMatchObject({
      status: 'unavailable',
      nav: null,
      reason: 'invalid_decimal'
    });
  });

  it('does not require FX for a zero foreign-currency balance', () => {
    expect(
      composeDailyNav({
        ...baseInput,
        cashAccounts: [
          {
            accountId: 'empty-chf',
            currency: 'CHF',
            balance: '0',
            included: true
          }
        ]
      })
    ).toMatchObject({
      status: 'available',
      nav: '100'
    });
  });
});
