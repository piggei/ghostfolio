import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { TAG_ID_EXCLUDE_FROM_ANALYSIS } from '@ghostfolio/common/config';

import { Prisma } from '@prisma/client';

import { classifyCashEvents } from './cash-event-classifier';
import { DailyCashClassificationReader } from './daily-cash-classification-reader.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function account(id: string, excluded = false, managed = false) {
  return {
    id,
    userId: 'user-a',
    currency: 'EUR',
    tags: excluded ? [{ tagId: TAG_ID_EXCLUDE_FROM_ANALYSIS }] : [],
    cashState: managed
      ? {
          currency: 'EUR',
          openingDate: day('2026-10-01'),
          openingBalance: new Prisma.Decimal('0'),
          revision: 1,
          includeCashInPortfolio: true
        }
      : null
  };
}

function order(id: string, date: string, cashEventId: string | null) {
  return {
    id,
    userId: 'user-a',
    accountId: 'account-a',
    accountUserId: 'user-a',
    date: day(date),
    currency: 'EUR',
    SymbolProfile: { currency: 'EUR' },
    type: 'BUY',
    quantity: 1,
    unitPrice: 100,
    fee: 0,
    tax: 0,
    cashEvent: cashEventId ? { id: cashEventId } : null
  };
}

function event(
  id: string,
  date: string,
  {
    accountId = 'account-a',
    orderId = null,
    transferId = null
  }: {
    accountId?: string;
    orderId?: string | null;
    transferId?: string | null;
  } = {}
) {
  return {
    id,
    userId: 'user-a',
    accountId,
    date: day(date),
    sequence: 1,
    type: 'MOVEMENT',
    value: new Prisma.Decimal('100'),
    fee: new Prisma.Decimal('0'),
    economicClassification: null,
    orderId,
    transferId,
    transferCounterpartyAccountId: null,
    transferCounterpartyMode: null,
    transferCounterpartyAmount: null,
    transferCounterpartyCurrency: null
  };
}

function setup({
  accounts = [account('account-a')],
  initialEvents = [],
  candidateOrders = [],
  missingOrders = [],
  linkedEvents = [],
  transferEvents = []
}: {
  accounts?: ReturnType<typeof account>[];
  initialEvents?: ReturnType<typeof event>[];
  candidateOrders?: ReturnType<typeof order>[];
  missingOrders?: ReturnType<typeof order>[];
  linkedEvents?: ReturnType<typeof event>[];
  transferEvents?: ReturnType<typeof event>[];
} = {}) {
  const cashFindMany = jest.fn(
    ({
      where
    }: {
      where: {
        userId: string;
        date?: unknown;
        orderId?: unknown;
        transferId?: unknown;
      };
    }) => {
      if (where.date) return Promise.resolve(initialEvents);
      if (where.orderId) return Promise.resolve(linkedEvents);
      if (where.transferId) return Promise.resolve(transferEvents);
      throw new Error('Unexpected cash event query');
    }
  );

  const orderFindMany = jest.fn(
    ({
      where
    }: {
      where: { userId: string; date?: unknown; id?: unknown };
    }) => {
      if (where.date) return Promise.resolve(candidateOrders);
      if (where.id) return Promise.resolve(missingOrders);
      throw new Error('Unexpected order query');
    }
  );

  const transactionClient = {
    account: {
      findMany: jest.fn(
        (args: {
          where: { userId: string };
          include: { cashState: boolean; tags: boolean };
        }) => {
          expect(args.where.userId).toBe('user-a');
          return Promise.resolve(accounts);
        }
      )
    },
    cashEvent: { findMany: cashFindMany },
    order: { findMany: orderFindMany }
  };

  const transaction = jest.fn(
    async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient)
  );

  const reader = new DailyCashClassificationReader({
    $transaction: transaction
  } as unknown as PrismaService);

  return {
    reader,
    transaction,
    transactionClient,
    cashFindMany,
    orderFindMany
  };
}

describe('DailyCashClassificationReader', () => {
  const scope = {
    userId: 'user-a',
    startDate: '2026-10-02',
    endDate: '2026-10-02'
  };

  it('reads an empty day inside a repeatable-read snapshot', async () => {
    const { reader, transaction, transactionClient } = setup();

    const result = await reader.read(scope);

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });

    expect(transactionClient.account.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-a' },
      include: { cashState: true, tags: true }
    });

    expect(result).toMatchObject({
      ...scope,
      orders: [],
      events: []
    });
    expect(result.accounts).toHaveLength(1);
  });

  it('uses an external transaction without opening a nested transaction', async () => {
    const {
      reader,
      transaction,
      transactionClient,
      cashFindMany,
      orderFindMany
    } = setup({
      initialEvents: [
        event('cash-a', '2026-10-02', {
          orderId: 'order-a',
          transferId: 'transfer-a'
        })
      ],
      missingOrders: [order('order-a', '2026-10-01', 'cash-a')],
      linkedEvents: [
        event('cash-a', '2026-10-02', {
          orderId: 'order-a',
          transferId: 'transfer-a'
        })
      ],
      transferEvents: [
        event('cash-a', '2026-10-02', {
          orderId: 'order-a',
          transferId: 'transfer-a'
        }),
        event('cash-b', '2026-10-03', {
          accountId: 'account-b',
          transferId: 'transfer-a'
        })
      ]
    });

    const result = await reader.read({
      ...scope,
      transaction: transactionClient as unknown as Prisma.TransactionClient
    });

    expect(transaction).not.toHaveBeenCalled();

    expect(transactionClient.account.findMany).toHaveBeenCalledTimes(1);
    expect(orderFindMany).toHaveBeenCalledTimes(2);
    expect(cashFindMany).toHaveBeenCalledTimes(3);

    expect(result.orders.map(({ id }) => id)).toEqual(['order-a']);
    expect(result.events.map(({ id }) => id).sort()).toEqual([
      'cash-a',
      'cash-b'
    ]);
  });

  it('recovers an order linked to an in-range cash event', async () => {
    const { reader, orderFindMany } = setup({
      initialEvents: [event('cash-a', '2026-10-02', { orderId: 'order-a' })],
      missingOrders: [order('order-a', '2026-10-01', 'cash-a')]
    });

    const result = await reader.read(scope);

    expect(result.orders.map(({ id }) => id)).toEqual(['order-a']);
    expect(result.events.map(({ id }) => id)).toEqual(['cash-a']);

    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-a',
          id: { in: ['order-a'] }
        }
      })
    );
  });

  it('recovers a settlement outside the order accounting day', async () => {
    const { reader, cashFindMany } = setup({
      candidateOrders: [
        order('order-a', '2026-10-02', 'cash-a'),
        order('order-before', '2026-10-01', null)
      ],
      linkedEvents: [event('cash-a', '2026-10-03', { orderId: 'order-a' })]
    });

    const result = await reader.read(scope);

    expect(result.orders.map(({ id }) => id)).toEqual(['order-a']);
    expect(result.events.map(({ id }) => id)).toEqual(['cash-a']);

    expect(cashFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        orderId: { in: ['order-a'] }
      }
    });
  });

  it('recovers transfer counterparts from excluded accounts', async () => {
    const { reader, cashFindMany } = setup({
      accounts: [account('account-a'), account('account-b', true)],
      initialEvents: [
        event('cash-out', '2026-10-02', {
          transferId: 'transfer-a'
        })
      ],
      transferEvents: [
        event('cash-out', '2026-10-02', {
          transferId: 'transfer-a'
        }),
        event('cash-in', '2026-10-03', {
          accountId: 'account-b',
          transferId: 'transfer-a'
        })
      ]
    });

    const result = await reader.read({
      ...scope,
      accountIds: ['account-a']
    });

    expect(result.accountIds).toEqual(['account-a']);
    expect(result.accounts.find(({ id }) => id === 'account-b')?.excluded).toBe(
      true
    );
    expect(result.events.map(({ id }) => id).sort()).toEqual([
      'cash-in',
      'cash-out'
    ]);

    expect(cashFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        transferId: { in: ['transfer-a'] }
      }
    });
  });

  it('scopes all database reads to the requested user', async () => {
    const { reader, transactionClient } = setup({
      initialEvents: [
        event('cash-a', '2026-10-02', {
          orderId: 'order-a',
          transferId: 'transfer-a'
        })
      ],
      missingOrders: [order('order-a', '2026-10-01', 'cash-a')],
      linkedEvents: [
        event('cash-a', '2026-10-02', {
          orderId: 'order-a',
          transferId: 'transfer-a'
        })
      ],
      transferEvents: [
        event('cash-a', '2026-10-02', {
          orderId: 'order-a',
          transferId: 'transfer-a'
        })
      ]
    });

    await reader.read(scope);

    for (const query of [
      ...transactionClient.account.findMany.mock.calls,
      ...transactionClient.order.findMany.mock.calls,
      ...transactionClient.cashEvent.findMany.mock.calls
    ]) {
      expect(query[0].where.userId).toBe('user-a');
    }

    expect(transactionClient.order.findMany).toHaveBeenCalledTimes(2);
    expect(transactionClient.cashEvent.findMany).toHaveBeenCalledTimes(3);
  });

  it('uses UTC query bounds and filters orders by accounting date', async () => {
    const { reader, orderFindMany, cashFindMany } = setup({
      candidateOrders: [
        order('before', '2026-10-01', null),
        order('inside', '2026-10-02', null),
        order('after', '2026-10-03', null)
      ]
    });

    const result = await reader.read(scope);

    expect(result.orders.map(({ id }) => id)).toEqual(['inside']);

    expect(cashFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        date: {
          gte: day('2026-10-02'),
          lt: day('2026-10-03')
        }
      }
    });

    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-a',
          date: {
            gte: day('2026-09-30'),
            lt: day('2026-10-05')
          }
        }
      })
    );
  });

  it('rejects invalid ranges before opening a transaction', async () => {
    const { reader, transaction } = setup();

    await expect(
      reader.read({
        ...scope,
        startDate: '2026-10-03',
        endDate: '2026-10-02'
      })
    ).rejects.toThrow('Reversed classification range');

    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not certify an order without a cash settlement', async () => {
    const { reader } = setup({
      accounts: [account('account-a', false, true)],
      candidateOrders: [order('order-a', '2026-10-02', null)]
    });

    const snapshot = await reader.read(scope);
    const classification = classifyCashEvents(snapshot);

    expect(snapshot.orders).toHaveLength(1);
    expect(snapshot.events).toHaveLength(0);
    expect(classification).toHaveLength(1);
    expect(classification[0].coverage).toBe('unavailable');
    expect(classification[0].externalFlows).toBeNull();
    expect(classification[0].items[0].issues).toContain(
      'ORDER_CASH_EFFECT_MISSING'
    );
  });

  it('does not certify a cash event whose linked order is missing', async () => {
    const { reader } = setup({
      accounts: [account('account-a', false, true)],
      initialEvents: [
        event('cash-a', '2026-10-02', { orderId: 'missing-order' })
      ],
      missingOrders: []
    });

    const snapshot = await reader.read(scope);
    const classification = classifyCashEvents(snapshot);

    expect(snapshot.orders).toHaveLength(0);
    expect(snapshot.events).toHaveLength(1);
    expect(classification).toHaveLength(1);
    expect(classification[0].coverage).toBe('unavailable');
    expect(classification[0].externalFlows).toBeNull();
    expect(classification[0].items[0].issues).toContain(
      'ORDER_RELATIONSHIP_MISMATCH'
    );
  });

  it('classifies a transfer to an excluded account as a scope boundary', async () => {
    const outgoing = {
      ...event('cash-out', '2026-10-02', {
        transferId: 'transfer-a'
      }),
      value: new Prisma.Decimal('-100')
    };
    const incoming = {
      ...event('cash-in', '2026-10-02', {
        accountId: 'account-b',
        transferId: 'transfer-a'
      }),
      value: new Prisma.Decimal('100')
    };

    const { reader } = setup({
      accounts: [
        account('account-a', false, true),
        account('account-b', true, true)
      ],
      initialEvents: [outgoing, incoming],
      transferEvents: [outgoing, incoming]
    });

    const snapshot = await reader.read({
      ...scope,
      accountIds: ['account-a']
    });
    const result = classifyCashEvents(snapshot);

    expect(snapshot.events).toHaveLength(2);
    expect(result).toHaveLength(1);
    expect(result[0].coverage).toBe('verified');
    expect(result[0].externalFlows).toEqual([
      { currency: 'EUR', amount: '-100' }
    ]);
  });

  it('does not certify a transfer whose counterpart is on another day', async () => {
    const outgoing = {
      ...event('cash-out', '2026-10-02', {
        transferId: 'transfer-a'
      }),
      value: new Prisma.Decimal('-100')
    };
    const incoming = {
      ...event('cash-in', '2026-10-03', {
        accountId: 'account-b',
        transferId: 'transfer-a'
      }),
      value: new Prisma.Decimal('100')
    };

    const { reader } = setup({
      accounts: [
        account('account-a', false, true),
        account('account-b', false, true)
      ],
      initialEvents: [outgoing],
      transferEvents: [outgoing, incoming]
    });

    const snapshot = await reader.read(scope);
    const result = classifyCashEvents(snapshot);

    expect(snapshot.events).toHaveLength(2);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-10-02');
    expect(result[0].coverage).toBe('unavailable');
    expect(result[0].externalFlows).toBeNull();
    expect(result[0].items[0].issues).toContain('INVALID_TRANSFER');
  });
});
