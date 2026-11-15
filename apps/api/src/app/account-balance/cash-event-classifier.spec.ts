import { calculateDailyPnl } from '../portfolio/daily-pnl-calculator';
import { classifyCashEvents } from './cash-event-classifier';
import type {
  CashClassificationInput,
  ClassificationAccount,
  ClassificationCashEvent,
  ClassificationOrder
} from './cash-event-classifier';

const date = '2026-10-02';

function account(
  id = 'a',
  cashIncluded = true,
  excluded = false,
  currency = 'EUR'
): ClassificationAccount {
  return {
    id,
    userId: 'u',
    currency,
    excluded,
    cashState: {
      currency,
      openingDate: '2026-10-01',
      openingBalance: '1000',
      revision: 2,
      includeCashInPortfolio: cashIncluded
    }
  };
}

function event(
  overrides: Partial<ClassificationCashEvent> = {}
): ClassificationCashEvent {
  return {
    id: 'e',
    userId: 'u',
    accountId: 'a',
    date,
    sequence: 1,
    type: 'MOVEMENT',
    value: '100',
    fee: '0',
    economicClassification: null,
    orderId: null,
    transferId: null,
    transferCounterpartyAccountId: null,
    transferCounterpartyMode: null,
    transferCounterpartyAmount: null,
    transferCounterpartyCurrency: null,
    ...overrides
  };
}

function order(
  overrides: Partial<ClassificationOrder> = {}
): ClassificationOrder {
  return {
    id: 'o',
    userId: 'u',
    accountUserId: 'u',
    accountId: 'a',
    date,
    currency: 'EUR',
    symbolCurrency: 'EUR',
    type: 'BUY',
    quantity: '1',
    unitPrice: '500',
    fee: '5',
    tax: '3',
    cashEventId: 'e',
    ...overrides
  };
}

function input(
  overrides: Partial<CashClassificationInput> = {}
): CashClassificationInput {
  return {
    userId: 'u',
    startDate: date,
    endDate: date,
    accounts: [account()],
    orders: [],
    events: [],
    ...overrides
  };
}

function settled(
  type: ClassificationOrder['type'],
  value: string,
  overrides: Partial<CashClassificationInput> = {}
) {
  return input({
    orders: [order({ type })],
    events: [event({ orderId: 'o', value })],
    ...overrides
  });
}

function transfer(): CashClassificationInput {
  return input({
    accounts: [account(), account('b')],
    events: [
      event({
        id: 'left',
        value: '-100',
        transferId: 't',
        transferCounterpartyAccountId: 'b',
        transferCounterpartyMode: 'CASH',
        transferCounterpartyAmount: '100',
        transferCounterpartyCurrency: 'EUR'
      }),
      event({
        id: 'right',
        accountId: 'b',
        value: '100',
        transferId: 't',
        transferCounterpartyAccountId: 'a',
        transferCounterpartyMode: 'CASH',
        transferCounterpartyAmount: '-100',
        transferCounterpartyCurrency: 'EUR'
      })
    ]
  });
}

function day(data: CashClassificationInput) {
  return classifyCashEvents(data)[0];
}

describe('Verified native cash event classification', () => {
  it.each([
    ['BUY', '-508', 'internal'],
    ['SELL', '492', 'internal'],
    ['DIVIDEND', '492', 'income'],
    ['INTEREST', '492', 'income'],
    ['FEE', '-508', 'expense']
  ] as const)(
    'classifies supported %s and its fees/taxes without another PnL adjustment',
    (type, value, kind) => {
      const result = day(settled(type, value));
      expect(result).toMatchObject({
        classification: 'complete',
        coverage: 'verified',
        reconciliation: 'none',
        externalFlows: [{ currency: 'EUR', amount: '0' }]
      });
      expect(result.items[0]).toMatchObject({
        kind,
        cashChanges: [{ accountId: 'a', currency: 'EUR', amount: value }],
        costs: [
          { source: 'orderFee', currency: 'EUR', amount: '5' },
          { source: 'orderTax', currency: 'EUR', amount: '3' }
        ],
        sources: {
          accountIds: ['a'],
          cashEventIds: ['e'],
          orderIds: ['o'],
          cashRevisions: [{ accountId: 'a', revision: 2 }]
        }
      });
    }
  );

  it.each([
    ['EXTERNAL_CAPITAL', '500', '2', '500', 'manual', '498'],
    ['EXTERNAL_CAPITAL', '-300', '2', '-300', 'manual', '-302'],
    ['INCOME', '100', '0', '0', 'income', '100'],
    ['INCOME', '-100', '0', '0', 'income', '-100'],
    ['EXPENSE', '-100', '2', '0', 'expense', '-102'],
    ['EXPENSE', '100', '0', '0', 'expense', '100'],
    ['EXPENSE', '0', '2', '0', 'expense', '-2']
  ] as const)(
    'classifies persisted %s principal %s fee %s',
    (category, value, fee, flow, kind, cashDelta) => {
      const result = day(
        input({
          events: [event({ economicClassification: category, value, fee })]
        })
      );

      expect(result).toMatchObject({
        classification: 'complete',
        coverage: 'verified',
        reconciliation: 'none',
        externalFlows: [{ currency: 'EUR', amount: flow }]
      });

      expect(result.items[0]).toMatchObject({
        kind,
        cashChanges: [{ accountId: 'a', currency: 'EUR', amount: cashDelta }],
        costs: [{ source: 'cashFee', currency: 'EUR', amount: fee }],
        issues: []
      });
    }
  );

  it('rejects manual classification on linked or checkpoint events', () => {
    const classified = { economicClassification: 'INCOME' as const };

    for (const invalid of [
      { type: 'CHECKPOINT' as const },
      { orderId: 'o' },
      { transferId: 't' },
      { transferCounterpartyAccountId: 'b' }
    ]) {
      expect(() =>
        day(input({ events: [event({ ...classified, ...invalid })] }))
      ).toThrow('Classification on non-manual cash event');
    }
  });

  it('does not certify a day containing both classified and unknown manual movements', () => {
    const result = day(
      input({
        events: [
          event({
            id: 'classified',
            value: '500',
            economicClassification: 'EXTERNAL_CAPITAL'
          }),
          event({ id: 'unknown', value: '100' })
        ]
      })
    );

    expect(result.classification).toBe('unclassified');
    expect(result.coverage).toBe('unavailable');
    expect(result.externalFlows).toBeNull();
  });

  it.each(['UNKNOWN', undefined])(
    'rejects unsupported or missing persisted classification %s',
    (category) => {
      expect(() =>
        day(
          input({
            events: [
              event({
                economicClassification:
                  category as ClassificationCashEvent['economicClassification']
              })
            ]
          })
        )
      ).toThrow('Invalid economic cash classification');
    }
  );

  it.each([
    ['excluded account', account('a', true, true)],
    ['excluded cash component', account('a', false)]
  ] as const)(
    'does not count classified manual movements in an %s',
    (_description, scopedAccount) => {
      const result = day(
        input({
          accounts: [scopedAccount],
          events: [
            event({
              value: '500',
              economicClassification: 'EXTERNAL_CAPITAL'
            })
          ]
        })
      );

      expect(result).toMatchObject({
        items: [],
        externalFlows: [],
        classification: 'complete',
        coverage: 'verified'
      });
    }
  );

  it.each(['0', '2'])(
    'leaves a manual principal unclassified even with known fee %s',
    (fee) => {
      const result = day(input({ events: [event({ value: '500', fee })] }));
      expect(result).toMatchObject({
        classification: 'unclassified',
        coverage: 'unavailable',
        externalFlows: null
      });
      expect(result.items[0]).toMatchObject({
        kind: 'manual',
        costs: [{ source: 'cashFee', currency: 'EUR', amount: fee }],
        issues: ['UNCLASSIFIED_MANUAL_MOVEMENT']
      });
    }
  );

  it.each(['-500', '0', '500'])(
    'does not use principal %s to infer a manual causal',
    (value) => {
      expect(
        day(input({ events: [event({ value })] })).externalFlows
      ).toBeNull();
    }
  );

  it.each([
    ['BUY', '500', '-508', '508', '0', '500', '-8'],
    ['SELL', '600', '592', '-592', '600', '0', '-8'],
    ['DIVIDEND', '31', '23', '-23', '1000', '1000', '23']
  ] as const)(
    'certifies excluded-cash %s boundary and the approved NAV identity',
    (type, price, cashDelta, flow, openingNav, closingNav, pnl) => {
      const result = day(
        input({
          accounts: [account('a', false)],
          orders: [order({ type, unitPrice: price })],
          events: [event({ value: cashDelta, orderId: 'o' })]
        })
      );
      expect(result).toMatchObject({
        classification: 'complete',
        coverage: 'verified',
        externalFlows: [{ currency: 'EUR', amount: flow }]
      });
      expect(result.items[0].kind).toBe('boundary');
      expect(
        calculateDailyPnl({
          openingNav,
          closingNav,
          externalNetFlows: flow,
          movementClassification: result.classification,
          reconciliation: result.reconciliation
        })
      ).toEqual({ status: 'available', dailyPnl: pnl });
    }
  );

  it('uses the actual net-23 dividend example (gross 30, tax 6, fee 1)', () => {
    const result = day(
      input({
        accounts: [account('a', false)],
        orders: [
          order({ type: 'DIVIDEND', unitPrice: '30', fee: '1', tax: '6' })
        ],
        events: [event({ orderId: 'o', value: '23' })]
      })
    );
    expect(result.externalFlows).toEqual([{ currency: 'EUR', amount: '-23' }]);
  });

  it('ignores an entirely excluded account, including ambiguous manual movements', () => {
    expect(
      day(settled('BUY', '-508', { accounts: [account('a', true, true)] }))
    ).toMatchObject({ items: [], externalFlows: [], coverage: 'verified' });
    expect(
      day(input({ accounts: [account('a', true, true)], events: [event()] }))
        .items
    ).toEqual([]);
  });

  it('keeps presentation-hidden cash economically included; only the persisted inclusion flag excludes it', () => {
    // Display visibility has no field in the normalized accounting contract.
    expect(day(settled('BUY', '-508')).externalFlows).toEqual([
      { currency: 'EUR', amount: '0' }
    ]);
    expect(
      day(settled('BUY', '-508', { accounts: [account('a', false)] }))
        .externalFlows
    ).toEqual([{ currency: 'EUR', amount: '508' }]);
  });

  it('classifies a transfer once with both components included', () => {
    const result = day(transfer());
    expect(result.externalFlows).toEqual([{ currency: 'EUR', amount: '0' }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sources).toMatchObject({
      cashEventIds: ['left', 'right'],
      transferId: 't',
      accountIds: ['a', 'b']
    });
  });

  it.each([
    ['a', '-100'],
    ['b', '100']
  ])(
    'uses explicit account scope %s for boundary direction',
    (id, expected) => {
      expect(day({ ...transfer(), accountIds: [id] }).externalFlows).toEqual([
        { currency: 'EUR', amount: expected }
      ]);
    }
  );

  it('respects cash-component exclusion independently of account inclusion', () => {
    expect(
      day({ ...transfer(), accounts: [account(), account('b', false)] })
        .externalFlows
    ).toEqual([{ currency: 'EUR', amount: '-100' }]);
  });

  it('ignores a transfer when both cash components are excluded', () => {
    expect(
      day({
        ...transfer(),
        accounts: [account('a', false), account('b', false)]
      })
    ).toMatchObject({ items: [], externalFlows: [] });
  });

  it('does not accept a missing managed counterpart', () => {
    const data = transfer();
    expect(day({ ...data, events: [data.events[0]] }).items[0].issues).toEqual([
      'TRANSFER_COUNTERPART_MISSING'
    ]);
    expect(day({ ...data, events: [data.events[0]] }).externalFlows).toBeNull();
  });

  it.each([
    { transferCounterpartyAccountId: 'a' },
    { transferCounterpartyAmount: '99' },
    { transferCounterpartyCurrency: 'USD' },
    { transferCounterpartyMode: 'LEGACY' as const }
  ])('rejects conflicting managed metadata %o', (change) => {
    const data = transfer();
    expect(
      day({
        ...data,
        events: [{ ...data.events[0], ...change }, data.events[1]]
      }).externalFlows
    ).toBeNull();
  });

  it('supports old complete pairs linked by transferId without counterparty metadata', () => {
    const data = transfer();
    expect(
      day({
        ...data,
        events: data.events.map((entry) => ({
          ...entry,
          transferCounterpartyAccountId: null,
          transferCounterpartyAmount: null,
          transferCounterpartyCurrency: null,
          transferCounterpartyMode: null
        }))
      }).externalFlows
    ).toEqual([{ currency: 'EUR', amount: '0' }]);
  });

  it('preserves both native legs of a multi-currency transfer without neutralizing FX spread', () => {
    const data = transfer();
    const events = [
      {
        ...data.events[0],
        transferCounterpartyAmount: '108',
        transferCounterpartyCurrency: 'USD'
      },
      { ...data.events[1], value: '108' }
    ];
    const result = day({
      ...data,
      accounts: [account(), account('b', true, false, 'USD')],
      events
    });
    expect(result.externalFlows).toEqual([
      { currency: 'EUR', amount: '0' },
      { currency: 'USD', amount: '0' }
    ]);
    expect(result.items[0].cashChanges).toEqual([
      { accountId: 'a', currency: 'EUR', amount: '-100' },
      { accountId: 'b', currency: 'USD', amount: '108' }
    ]);
    expect(
      day({
        ...data,
        accounts: [account(), account('b', true, false, 'USD')],
        events,
        accountIds: ['b']
      }).externalFlows
    ).toEqual([{ currency: 'USD', amount: '108' }]);
  });

  it('supports an explicitly documented excluded legacy counterpart', () => {
    const data = transfer();
    const legacy = { ...account('b', true, true), cashState: null };
    const result = day({
      ...data,
      accounts: [account(), legacy],
      events: [{ ...data.events[0], transferCounterpartyMode: 'LEGACY' }]
    });
    expect(result.externalFlows).toEqual([{ currency: 'EUR', amount: '-100' }]);
    expect(result.coverage).toBe('verified');
  });

  it('does not claim complete cash coverage for an included legacy counterpart', () => {
    const data = transfer();
    const result = day({
      ...data,
      accounts: [account(), { ...account('b'), cashState: null }],
      events: [{ ...data.events[0], transferCounterpartyMode: 'LEGACY' }]
    });
    expect(result).toMatchObject({
      classification: 'complete',
      coverage: 'unavailable',
      externalFlows: null
    });
    expect(result.items[0].issues).toContain(
      'LEGACY_CASH_COVERAGE_UNVERIFIABLE'
    );
  });

  it('does not invent settlement for an order without a cash event', () => {
    const result = day(input({ orders: [order({ cashEventId: null })] }));
    expect(result.externalFlows).toBeNull();
    expect(result.items[0]).toMatchObject({
      cashChanges: [],
      issues: ['ORDER_CASH_EFFECT_MISSING']
    });
  });

  it('does not infer excluded-cash financing without a verified settlement', () => {
    expect(
      day(
        input({
          accounts: [account('a', false)],
          orders: [order({ cashEventId: null })]
        })
      ).externalFlows
    ).toBeNull();
  });

  it.each([
    { accountId: 'b' },
    { accountUserId: 'other' },
    { date: '2026-10-01' },
    { cashEventId: 'other' }
  ])('rejects order relationship mismatch %o', (change) => {
    const data = settled('BUY', '-508');
    expect(
      day({
        ...data,
        accounts: [account(), account('b')],
        orders: [order(change)]
      }).externalFlows
    ).toBeNull();
  });

  it('accepts the real EUR settlement despite floating-point price precision', () => {
    const result = day(
      settled('BUY', '-463.12', {
        orders: [
          order({
            quantity: '6',
            unitPrice: '77.18666666666667',
            fee: '0',
            tax: '0'
          })
        ]
      })
    );

    expect(result.coverage).toBe('verified');
    expect(result.externalFlows).toEqual([
      { currency: 'EUR', amount: '0' }
    ]);
    expect(result.items[0].issues).toEqual([]);
  });

  it('uses zero minor-unit digits for JPY settlements', () => {
    const data = settled('BUY', '-100', {
      accounts: [account('a', true, false, 'JPY')],
      orders: [
        order({
          currency: 'JPY',
          symbolCurrency: 'JPY',
          quantity: '1',
          unitPrice: '100.4',
          fee: '0',
          tax: '0'
        })
      ]
    });

    expect(day(data).coverage).toBe('verified');
    expect(day(data).externalFlows).toEqual([
      { currency: 'JPY', amount: '0' }
    ]);
  });

  it('uses three minor-unit digits for KWD settlements', () => {
    const data = settled('BUY', '-1.235', {
      accounts: [account('a', true, false, 'KWD')],
      orders: [
        order({
          currency: 'KWD',
          symbolCurrency: 'KWD',
          quantity: '1',
          unitPrice: '1.2345',
          fee: '0',
          tax: '0'
        })
      ]
    });

    expect(day(data).coverage).toBe('verified');
    expect(day(data).externalFlows).toEqual([
      { currency: 'KWD', amount: '0' }
    ]);
  });

  it('still rejects a genuine one-cent EUR settlement mismatch', () => {
    const result = day(
      settled('BUY', '-463.11', {
        orders: [
          order({
            quantity: '6',
            unitPrice: '77.18666666666667',
            fee: '0',
            tax: '0'
          })
        ]
      })
    );

    expect(result.coverage).toBe('unavailable');
    expect(result.externalFlows).toBeNull();
    expect(result.items[0].issues).toContain(
      'ORDER_CASH_AMOUNT_MISMATCH'
    );
  });

  it('rejects linked amount mismatch and historical gross-only tax coverage', () => {
    for (const value of ['-500', '-505', '-509']) {
      const result = day(settled('BUY', value));
      expect(result).toMatchObject({
        classification: 'complete',
        coverage: 'unavailable',
        externalFlows: null
      });
      expect(result.items[0].issues).toContain('ORDER_CASH_AMOUNT_MISMATCH');
    }
  });

  it('does not invent a settlement FX rate or unverifiable tax decomposition', () => {
    const data = settled('BUY', '-457.2');
    const result = day({ ...data, orders: [order({ currency: 'USD' })] });
    expect(result).toMatchObject({
      classification: 'complete',
      coverage: 'unavailable',
      externalFlows: null
    });
    expect(result.items[0].issues).toEqual([
      'ORDER_FX_SETTLEMENT_UNVERIFIABLE'
    ]);
    expect(result.items[0].costs[1]).toEqual({
      source: 'orderTax',
      currency: 'USD',
      amount: '3'
    });
  });

  it('uses persisted symbol currency when Order.currency is null', () => {
    const data = settled('BUY', '-508');
    expect(day({ ...data, orders: [order({ currency: null })] }).coverage).toBe(
      'verified'
    );
  });

  it('rejects unsupported LIABILITY settlement rather than treating it as income', () => {
    expect(day(settled('LIABILITY', '492')).externalFlows).toBeNull();
  });

  it('marks only the checkpoint day unresolved and does not replay its adjustment', () => {
    const result = classifyCashEvents(
      input({
        endDate: '2026-10-03',
        events: [event({ type: 'CHECKPOINT', value: '1050' })]
      })
    );
    expect(result[0]).toMatchObject({
      externalFlows: null,
      reconciliation: 'unresolved'
    });
    expect(result[0].items[0].cashChanges).toEqual([]);
    expect(result[1]).toMatchObject({
      externalFlows: [],
      classification: 'complete',
      coverage: 'verified',
      reconciliation: 'none'
    });
  });

  it('records an opening as an initial holding, never a deposit', () => {
    const result = day(
      input({ startDate: '2026-10-01', endDate: '2026-10-01' })
    );
    expect(result.externalFlows).toEqual([]);
    expect(result.items[0].kind).toBe('opening');
    // This classifier does not certify NAV before opening; the projection does.
    expect(
      day(input({ startDate: '2026-09-30', endDate: '2026-09-30' })).items
    ).toEqual([]);
  });

  it('aggregates multiple same-day sources once and distinguishes zero from unknown', () => {
    const data = transfer();
    const known = {
      ...data,
      orders: [order()],
      events: [...data.events, event({ orderId: 'o', value: '-508' })]
    };
    expect(day(known).externalFlows).toEqual([
      { currency: 'EUR', amount: '0' }
    ]);
    const unknown = day({
      ...known,
      events: [...known.events, event({ id: 'manual', sequence: 2 })]
    });
    expect(unknown.items).toHaveLength(3);
    expect(unknown.externalFlows).toBeNull();
  });

  it('preserves exact decimal amounts at an excluded cash boundary', () => {
    const result = day(
      input({
        accounts: [account('a', false)],
        orders: [
          order({
            unitPrice: '9007199254740993.00000000000000000001',
            fee: '0',
            tax: '0'
          })
        ],
        events: [
          event({
            orderId: 'o',
            value: '-9007199254740993.00000000000000000001'
          })
        ]
      })
    );
    expect(result.externalFlows).toEqual([
      { currency: 'EUR', amount: '9007199254740993.00000000000000000001' }
    ]);
  });

  it('does not mutate records and is independent of input ordering', () => {
    const data = transfer();
    const before = JSON.stringify(data);
    expect(classifyCashEvents(data)).toEqual(
      classifyCashEvents({
        ...data,
        events: [...data.events].reverse(),
        accounts: [...data.accounts].reverse()
      })
    );
    expect(JSON.stringify(data)).toBe(before);
    expect(classifyCashEvents(data)).toEqual(classifyCashEvents(data));
  });

  it('rejects cross-user input instead of producing a certified result', () => {
    expect(() =>
      classifyCashEvents(input({ orders: [order({ userId: 'other' })] }))
    ).toThrow(TypeError);
    expect(() =>
      classifyCashEvents(input({ events: [event({ userId: 'other' })] }))
    ).toThrow(TypeError);
  });

  it('does not lose an order hidden behind a conflicting transfer relationship', () => {
    const result = day(
      input({
        accounts: [account('a', false)],
        orders: [order()],
        events: [event({ orderId: 'o', transferId: 't', value: '-508' })]
      })
    );
    expect(result.externalFlows).toBeNull();
    expect(result.items[0].issues).toContain('ORDER_CASH_EFFECT_MISSING');
  });

  it('rejects inconsistent same-currency transfer amounts even without metadata', () => {
    const data = transfer();
    expect(
      day({
        ...data,
        events: data.events.map((entry, index) => ({
          ...entry,
          value: index === 0 ? '-100' : '90',
          transferCounterpartyAccountId: null,
          transferCounterpartyAmount: null,
          transferCounterpartyCurrency: null,
          transferCounterpartyMode: null
        }))
      }).externalFlows
    ).toBeNull();
  });

  it('rejects a nonzero fee on a linked event rather than subtracting it twice', () => {
    const data = settled('BUY', '-508');
    expect(
      day({ ...data, events: [{ ...data.events[0], fee: '1' }] }).externalFlows
    ).toBeNull();
  });

  it('does not accept a cash event in the wrong ledger currency', () => {
    const data = settled('BUY', '-508');
    expect(
      day({ ...data, accounts: [{ ...account(), currency: 'USD' }] })
        .externalFlows
    ).toBeNull();
  });

  it('certifies a genuine zero-valued linked settlement', () => {
    expect(
      day(
        input({
          orders: [order({ unitPrice: '0', fee: '0', tax: '0' })],
          events: [event({ orderId: 'o', value: '0' })]
        })
      ).externalFlows
    ).toEqual([{ currency: 'EUR', amount: '0' }]);
  });

  it('rejects invalid dates and duplicate source IDs', () => {
    expect(() =>
      classifyCashEvents(input({ startDate: '2026-02-30' }))
    ).toThrow();
    expect(() =>
      classifyCashEvents(input({ endDate: '2026-10-01' }))
    ).toThrow();
    expect(() =>
      classifyCashEvents(input({ events: [event(), event()] }))
    ).toThrow();
  });
});
