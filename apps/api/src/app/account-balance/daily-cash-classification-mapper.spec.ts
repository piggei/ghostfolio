import { TAG_ID_EXCLUDE_FROM_ANALYSIS } from '@ghostfolio/common/config';

import { Prisma } from '@prisma/client';
import type { CashEvent } from '@prisma/client';

import {
  ClassificationPrismaAccount,
  ClassificationPrismaOrder,
  mapClassificationAccount,
  mapClassificationCashEvent,
  mapClassificationOrder
} from './daily-cash-classification-mapper';

const date = new Date('2026-10-02T00:00:00.000Z');

// Test fixtures contain only the Prisma fields consumed by the mapper.
// Type assertions are confined to these fixtures, not production code.
function account(
  overrides: Record<string, unknown> = {}
): ClassificationPrismaAccount {
  return {
    id: 'account-a',
    userId: 'user-a',
    currency: 'EUR',
    tags: [],
    cashState: {
      currency: 'EUR',
      openingDate: new Date('2026-10-01T00:00:00.000Z'),
      openingBalance: new Prisma.Decimal('1234.123456789012345678901234567890'),
      revision: 7,
      includeCashInPortfolio: true
    },
    ...overrides
  } as unknown as ClassificationPrismaAccount;
}

function order(
  overrides: Record<string, unknown> = {}
): ClassificationPrismaOrder {
  return {
    id: 'order-a',
    userId: 'user-a',
    accountId: 'account-a',
    accountUserId: 'user-a',
    date,
    currency: null,
    SymbolProfile: { currency: 'USD' },
    type: 'BUY',
    quantity: 0.1,
    unitPrice: 100.25,
    fee: 1.5,
    tax: 0.25,
    cashEvent: { id: 'cash-a' },
    ...overrides
  } as unknown as ClassificationPrismaOrder;
}

function cashEvent(overrides: Record<string, unknown> = {}): CashEvent {
  return {
    id: 'cash-a',
    userId: 'user-a',
    accountId: 'account-a',
    date,
    sequence: 3,
    type: 'MOVEMENT',
    value: new Prisma.Decimal('123.123456789012345678901234567890'),
    fee: new Prisma.Decimal('0.000000000000000000000000000001'),
    economicClassification: 'EXTERNAL_CAPITAL',
    orderId: null,
    transferId: null,
    transferCounterpartyAccountId: null,
    transferCounterpartyMode: null,
    transferCounterpartyAmount: null,
    transferCounterpartyCurrency: null,
    ...overrides
  } as unknown as CashEvent;
}

describe('Daily cash classification Prisma mapper', () => {
  it('preserves managed cash opening precision and revision', () => {
    expect(mapClassificationAccount(account())).toMatchObject({
      id: 'account-a',
      userId: 'user-a',
      currency: 'EUR',
      excluded: false,
      cashState: {
        currency: 'EUR',
        openingDate: '2026-10-01',
        openingBalance: '1234.12345678901234567890123456789',
        revision: 7,
        includeCashInPortfolio: true
      }
    });
  });

  it('uses the persisted exclusion tag', () => {
    const mapped = mapClassificationAccount(
      account({
        tags: [
          { tagId: 'unrelated-tag' },
          { tagId: TAG_ID_EXCLUDE_FROM_ANALYSIS }
        ]
      })
    );

    expect(mapped.excluded).toBe(true);
  });

  it('does not confuse unrelated tags with exclusion', () => {
    expect(
      mapClassificationAccount(account({ tags: [{ tagId: 'unrelated-tag' }] }))
        .excluded
    ).toBe(false);
  });

  it('preserves absent cash management without inventing an opening', () => {
    expect(
      mapClassificationAccount(account({ cashState: null })).cashState
    ).toBeNull();
  });

  it('preserves the cash inclusion flag independently of exclusion', () => {
    const source = account();
    const mapped = mapClassificationAccount(
      account({
        cashState: {
          ...source.cashState,
          includeCashInPortfolio: false
        }
      })
    );

    expect(mapped.excluded).toBe(false);
    expect(mapped.cashState?.includeCashInPortfolio).toBe(false);
  });

  it('preserves order currency fallback and actual settlement link', () => {
    expect(mapClassificationOrder(order())).toMatchObject({
      id: 'order-a',
      accountId: 'account-a',
      accountUserId: 'user-a',
      currency: null,
      symbolCurrency: 'USD',
      type: 'BUY',
      quantity: '0.1',
      unitPrice: '100.25',
      fee: '1.5',
      tax: '0.25',
      cashEventId: 'cash-a'
    });
  });

  it('preserves orders without an account or cash settlement', () => {
    expect(
      mapClassificationOrder(
        order({
          accountId: null,
          accountUserId: null,
          cashEvent: null,
          currency: 'EUR',
          type: 'DIVIDEND'
        })
      )
    ).toMatchObject({
      accountId: null,
      accountUserId: null,
      cashEventId: null,
      currency: 'EUR',
      type: 'DIVIDEND'
    });
  });

  it('preserves 30-digit cash decimals and persisted classification', () => {
    expect(mapClassificationCashEvent(cashEvent())).toMatchObject({
      id: 'cash-a',
      date: '2026-10-02',
      sequence: 3,
      value: '123.12345678901234567890123456789',
      fee: '0.000000000000000000000000000001',
      economicClassification: 'EXTERNAL_CAPITAL',
      orderId: null,
      transferId: null
    });
  });

  it.each(['INCOME', 'EXPENSE', null] as const)(
    'preserves economic classification %s without inference',
    (economicClassification) => {
      expect(
        mapClassificationCashEvent(cashEvent({ economicClassification }))
          .economicClassification
      ).toBe(economicClassification);
    }
  );

  it('preserves both transfer metadata and nullable amounts', () => {
    expect(
      mapClassificationCashEvent(
        cashEvent({
          economicClassification: null,
          transferId: 'transfer-a',
          transferCounterpartyAccountId: 'account-b',
          transferCounterpartyMode: 'CASH',
          transferCounterpartyAmount: new Prisma.Decimal(
            '-123.123456789012345678901234567890'
          ),
          transferCounterpartyCurrency: 'USD'
        })
      )
    ).toMatchObject({
      transferId: 'transfer-a',
      transferCounterpartyAccountId: 'account-b',
      transferCounterpartyMode: 'CASH',
      transferCounterpartyAmount: '-123.12345678901234567890123456789',
      transferCounterpartyCurrency: 'USD'
    });

    expect(
      mapClassificationCashEvent(cashEvent()).transferCounterpartyAmount
    ).toBeNull();
  });

  it('uses the same order accounting date as Ghostfolio', () => {
    const timestamp = new Date('2026-03-29T00:30:00.000Z');

    const expected: Record<string, string> = {
      UTC: '2026-03-29',
      'Europe/Rome': '2026-03-29',
      'America/New_York': '2026-03-28'
    };

    const timezone = process.env.TZ ?? 'UTC';

    if (!(timezone in expected)) {
      throw new Error(`Unexpected test timezone: ${timezone}`);
    }

    expect(mapClassificationOrder(order({ date: timestamp })).date).toBe(
      expected[timezone]
    );
  });
});
