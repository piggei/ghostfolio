import { CASH_MOVEMENT_CLASSIFICATIONS } from '@ghostfolio/common/interfaces';
import type { CashMovementClassification } from '@ghostfolio/common/interfaces';

import { Big } from 'big.js';
import { isISO4217CurrencyCode } from 'class-validator';

function matchesSettledAmount(
  expected: string,
  actual: string,
  currency: string
): boolean {
  if (!isISO4217CurrencyCode(currency)) {
    return new Big(expected).eq(actual);
  }

  const fractionDigits = new Intl.NumberFormat('en', {
    currency,
    style: 'currency'
  }).resolvedOptions().maximumFractionDigits;

  return new Big(expected)
    .round(fractionDigits, Big.roundHalfUp)
    .eq(new Big(actual).round(fractionDigits, Big.roundHalfUp));
}

/** Narrow database-reader contract. Decimal/Float fields are serialized as
 * decimal strings; Order.date is normalized to NG's accounting civil date.
 * excluded is resolved from the persisted Exclude from Analysis account tag.
 * Read every related order/transfer half, including excluded counterparties,
 * from the same transactional view. Do not supply synthetic cash activities.
 */
export interface ClassificationAccount {
  id: string;
  userId: string;
  currency: string | null;
  excluded: boolean;
  cashState: {
    currency: string;
    openingDate: string;
    openingBalance: string;
    revision: number;
    includeCashInPortfolio: boolean;
  } | null;
}

export interface ClassificationOrder {
  id: string;
  userId: string;
  accountId: string | null;
  accountUserId: string | null;
  date: string;
  currency: string | null;
  symbolCurrency: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'INTEREST' | 'FEE' | 'LIABILITY';
  quantity: string;
  unitPrice: string;
  fee: string;
  tax: string;
  cashEventId: string | null;
}

export interface ClassificationCashEvent {
  id: string;
  userId: string;
  accountId: string;
  date: string;
  sequence: number;
  type: 'MOVEMENT' | 'CHECKPOINT';
  value: string;
  fee: string;
  economicClassification: CashMovementClassification | null;
  orderId: string | null;
  transferId: string | null;
  transferCounterpartyAccountId: string | null;
  transferCounterpartyMode: 'CASH' | 'LEGACY' | null;
  transferCounterpartyAmount: string | null;
  transferCounterpartyCurrency: string | null;
}

export interface CashClassificationInput {
  userId: string;
  startDate: string;
  endDate: string;
  /** Omit for the total portfolio. Only account-based scopes are supported. */
  accountIds?: readonly string[];
  accounts: readonly ClassificationAccount[];
  orders: readonly ClassificationOrder[];
  events: readonly ClassificationCashEvent[];
}

export interface NativeAmount {
  currency: string;
  amount: string;
}

export interface CashClassificationItem {
  date: string;
  kind:
    | 'opening'
    | 'manual'
    | 'internal'
    | 'income'
    | 'expense'
    | 'boundary'
    | 'transfer'
    | 'checkpoint'
    | 'unavailable';
  sources: {
    accountIds: string[];
    cashEventIds: string[];
    orderIds: string[];
    transferId: string | null;
    cashRevisions: { accountId: string; revision: number }[];
  };
  /** Diagnostic cash legs; never added to NAV by the classifier. */
  cashChanges: (NativeAmount & { accountId: string })[];
  /** Native components, including explicit zeros; null means unknown. */
  externalFlows: NativeAmount[] | null;
  costs: {
    source: 'cashFee' | 'orderFee' | 'orderTax';
    currency: string;
    amount: string;
  }[];
  classification: 'complete' | 'unclassified';
  coverage: 'verified' | 'unavailable';
  reconciliation: 'none' | 'unresolved';
  issues: string[];
}

export interface DailyCashClassification {
  date: string;
  externalFlows: NativeAmount[] | null;
  classification: 'complete' | 'unclassified';
  coverage: 'verified' | 'unavailable';
  reconciliation: 'none' | 'unresolved';
  items: CashClassificationItem[];
}

/** Classifies persisted relationships only. No FX, ledger replay or inferred
 * manual causals. Available totals are native flows, not reporting-currency PnL.
 * An empty flow array is a certified zero; null is unavailable. Coverage must
 * also be verified before asserting complete classification to the PnL core.
 * Opening records are initial holdings, not capital flows; NAV baseline
 * availability must still be checked by the caller using the cash projection.
 */
export function classifyCashEvents(
  input: CashClassificationInput
): DailyCashClassification[] {
  const start = civilDate(input.startDate);
  const end = civilDate(input.endDate);
  if (start > end) throw new RangeError('Reversed classification range');
  const accounts = unique(input.accounts);
  const orders = unique(input.orders);
  const events = unique(input.events);
  if (input.accountIds?.some((id) => !accounts.has(id)))
    throw new TypeError('Unknown scoped account');
  const included = (id: string) => {
    const account = accounts.get(id);
    return (
      !!account &&
      !account.excluded &&
      (!input.accountIds || input.accountIds.includes(id))
    );
  };
  const cashIncluded = (id: string) =>
    included(id) &&
    accounts.get(id)?.cashState?.includeCashInPortfolio !== false;
  const items: CashClassificationItem[] = [];
  const inRange = (date: string) =>
    date >= input.startDate && date <= input.endDate;

  for (const account of input.accounts) {
    if (account.userId !== input.userId)
      throw new TypeError('Account ownership mismatch');
    if (account.cashState) {
      civilDate(account.cashState.openingDate);
      decimal(account.cashState.openingBalance);
      if (cashIncluded(account.id) && inRange(account.cashState.openingDate)) {
        items.push(
          item(account.cashState.openingDate, 'opening', [account.id])
        );
      }
    }
  }
  for (const order of input.orders) {
    civilDate(order.date);
    if (order.userId !== input.userId)
      throw new TypeError('Order ownership mismatch');
    if (order.accountId != null && !accounts.has(order.accountId))
      throw new TypeError('Unknown order account');
  }
  for (const event of input.events) {
    if (event.userId !== input.userId || !accounts.has(event.accountId))
      throw new TypeError('Cash event ownership or account mismatch');
    civilDate(event.date);
    decimal(event.value);
    if (decimal(event.fee).lt(0)) throw new TypeError('Negative cash fee');

    if (
      event.economicClassification !== null &&
      !CASH_MOVEMENT_CLASSIFICATIONS.includes(event.economicClassification)
    ) {
      throw new TypeError('Invalid economic cash classification');
    }

    if (
      event.economicClassification !== null &&
      (event.type !== 'MOVEMENT' ||
        event.orderId !== null ||
        event.transferId !== null ||
        hasMetadata(event))
    ) {
      throw new TypeError('Classification on non-manual cash event');
    }
  }

  function item(
    date: string,
    kind: CashClassificationItem['kind'],
    accountIds: string[],
    group: readonly ClassificationCashEvent[] = [],
    order?: ClassificationOrder
  ): CashClassificationItem {
    return {
      date,
      kind,
      sources: {
        accountIds: [...new Set(accountIds)].sort(),
        cashEventIds: group.map(({ id }) => id).sort(),
        orderIds: order ? [order.id] : [],
        transferId: group[0]?.transferId ?? null,
        cashRevisions: [...new Set(accountIds)].sort().flatMap((accountId) => {
          const state = accounts.get(accountId)?.cashState;
          return state ? [{ accountId, revision: state.revision }] : [];
        })
      },
      cashChanges: group.flatMap((event) => {
        const currency = accounts.get(event.accountId)?.cashState?.currency;
        return currency && event.type === 'MOVEMENT'
          ? [
              {
                accountId: event.accountId,
                currency,
                amount: decimal(event.value).minus(event.fee).toFixed()
              }
            ]
          : [];
      }),
      externalFlows: [],
      costs: [],
      classification: 'complete',
      coverage: 'verified',
      reconciliation: 'none',
      issues: []
    };
  }
  function fail(
    result: CashClassificationItem,
    issue: string,
    unclassified = true
  ) {
    result.externalFlows = null;
    result.coverage = 'unavailable';
    if (unclassified) result.classification = 'unclassified';
    result.issues.push(issue);
    return result;
  }
  function validEvent(event: ClassificationCashEvent): boolean {
    const account = accounts.get(event.accountId);
    const state = account?.cashState;
    return (
      event.userId === input.userId &&
      !!state &&
      state.currency === account.currency &&
      event.date >= state.openingDate &&
      Number.isSafeInteger(event.sequence) &&
      event.sequence >= 0
    );
  }
  function ledgerCurrency(accountId: string): string {
    const state = accounts.get(accountId)?.cashState;
    if (!state) throw new TypeError('Missing managed cash state');
    return state.currency;
  }
  function hasMetadata(event: ClassificationCashEvent) {
    return [
      event.transferCounterpartyAccountId,
      event.transferCounterpartyMode,
      event.transferCounterpartyAmount,
      event.transferCounterpartyCurrency
    ].some((value) => value != null);
  }
  function matches(
    event: ClassificationCashEvent,
    other: ClassificationCashEvent
  ): boolean {
    return (
      event.transferCounterpartyAccountId === other.accountId &&
      event.transferCounterpartyMode === 'CASH' &&
      event.transferCounterpartyCurrency ===
        accounts.get(other.accountId)?.cashState?.currency &&
      event.transferCounterpartyAmount != null &&
      decimal(event.transferCounterpartyAmount).eq(other.value)
    );
  }

  const groups = new Map<string, ClassificationCashEvent[]>();
  for (const event of input.events) {
    if (event.transferId) {
      const group = groups.get(event.transferId) ?? [];
      group.push(event);
      groups.set(event.transferId, group);
      continue;
    }
    if (
      !cashIncluded(event.accountId) &&
      !(event.orderId && included(orders.get(event.orderId)?.accountId ?? ''))
    )
      continue;
    if (!inRange(event.date)) continue;
    const order = event.orderId ? orders.get(event.orderId) : undefined;
    const result = item(
      event.date,
      'manual',
      [event.accountId],
      [event],
      order
    );
    items.push(result);
    if (!validEvent(event) || hasMetadata(event)) {
      fail(result, 'INVALID_EVENT_RELATIONSHIP');
      continue;
    }
    const currency = ledgerCurrency(event.accountId);
    if (event.type === 'CHECKPOINT') {
      result.kind = 'checkpoint';
      result.reconciliation = 'unresolved';
      if (event.orderId || !decimal(event.fee).eq(0))
        fail(result, 'INVALID_CHECKPOINT');
      result.issues.push('RECONCILIATION_UNRESOLVED');
      continue;
    }
    if (!event.orderId) {
      result.costs.push({
        source: 'cashFee',
        currency,
        amount: decimal(event.fee).toFixed()
      });
      switch (event.economicClassification) {
        case 'EXTERNAL_CAPITAL':
          result.externalFlows = [
            { currency, amount: decimal(event.value).toFixed() }
          ];
          break;
        case 'INCOME':
          result.kind = 'income';
          result.externalFlows = [{ currency, amount: '0' }];
          break;
        case 'EXPENSE':
          result.kind = 'expense';
          result.externalFlows = [{ currency, amount: '0' }];
          break;
        default:
          fail(result, 'UNCLASSIFIED_MANUAL_MOVEMENT');
      }
      continue;
    }
    if (
      order?.userId !== input.userId ||
      order.accountUserId !== input.userId ||
      order.accountId !== event.accountId ||
      order.cashEventId !== event.id ||
      order.date !== event.date ||
      !decimal(event.fee).eq(0)
    ) {
      fail(result, 'ORDER_RELATIONSHIP_MISMATCH');
      continue;
    }
    if (!['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE'].includes(order.type)) {
      fail(result, 'UNSUPPORTED_ORDER_TYPE');
      continue;
    }
    const orderCurrency = order.currency ?? order.symbolCurrency;
    result.costs.push(
      {
        source: 'orderFee',
        currency: orderCurrency,
        amount: decimal(order.fee).toFixed()
      },
      {
        source: 'orderTax',
        currency: orderCurrency,
        amount: decimal(order.tax).toFixed()
      }
    );
    if (
      [order.quantity, order.unitPrice, order.fee, order.tax].some((value) =>
        decimal(value).lt(0)
      )
    ) {
      fail(result, 'INVALID_ORDER_AMOUNT');
      continue;
    }
    if (orderCurrency !== currency) {
      fail(result, 'ORDER_FX_SETTLEMENT_UNVERIFIABLE', false);
      continue;
    }
    const principal = decimal(order.quantity)
      .mul(order.unitPrice)
      .mul(['BUY', 'FEE'].includes(order.type) ? -1 : 1);
    const expected = principal.minus(order.fee).minus(order.tax);
    if (
      !matchesSettledAmount(
        expected.toString(),
        event.value,
        orderCurrency
      )
    ) {
      fail(result, 'ORDER_CASH_AMOUNT_MISMATCH', false);
      continue;
    }
    if (!included(event.accountId)) {
      fail(result, 'UNSUPPORTED_COMPONENT_BOUNDARY');
      continue;
    }
    result.kind = ['DIVIDEND', 'INTEREST'].includes(order.type)
      ? 'income'
      : order.type === 'FEE'
        ? 'expense'
        : 'internal';
    result.externalFlows = [{ currency, amount: '0' }];
    if (!cashIncluded(event.accountId)) {
      result.kind = 'boundary';
      result.externalFlows = [
        { currency, amount: decimal(event.value).neg().toFixed() }
      ];
    }
  }

  for (const group of groups.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id));
    const accountIds = [
      ...new Set(
        group.flatMap((event) => [
          event.accountId,
          ...(event.transferCounterpartyAccountId
            ? [event.transferCounterpartyAccountId]
            : [])
        ])
      )
    ];
    if (!accountIds.some(cashIncluded)) continue;
    const dates = [...new Set(group.map(({ date }) => date))]
      .filter(inRange)
      .sort();
    for (const date of dates) {
      const result = item(date, 'transfer', accountIds, group);
      items.push(result);
      if (
        group.some(
          (event) =>
            !validEvent(event) ||
            event.type !== 'MOVEMENT' ||
            event.orderId ||
            !decimal(event.fee).eq(0)
        ) ||
        group.some((event) => event.date !== date)
      ) {
        fail(result, 'INVALID_TRANSFER');
        continue;
      }
      if (group.length === 2) {
        const [left, right] = group;
        if (
          left.accountId === right.accountId ||
          decimal(left.value).eq(0) ||
          decimal(right.value).eq(0) ||
          decimal(left.value).s === decimal(right.value).s ||
          (ledgerCurrency(left.accountId) === ledgerCurrency(right.accountId) &&
            !decimal(left.value).plus(right.value).eq(0)) ||
          ((hasMetadata(left) || hasMetadata(right)) &&
            !(matches(left, right) && matches(right, left)))
        ) {
          fail(result, 'TRANSFER_METADATA_CONFLICT');
          continue;
        }
        result.externalFlows = group
          .filter((event) => cashIncluded(event.accountId))
          .map((event) => ({
            currency: ledgerCurrency(event.accountId),
            amount: group.every((half) => cashIncluded(half.accountId))
              ? '0'
              : decimal(event.value).toFixed()
          }));
      } else if (group.length === 1) {
        const event = group[0];
        const other = accounts.get(event.transferCounterpartyAccountId ?? '');
        if (
          !other ||
          other.id === event.accountId ||
          event.transferCounterpartyMode !== 'LEGACY' ||
          !event.transferCounterpartyCurrency ||
          event.transferCounterpartyCurrency !== other.currency ||
          event.transferCounterpartyAmount == null ||
          decimal(event.transferCounterpartyAmount).eq(0) ||
          decimal(event.value).eq(0) ||
          decimal(event.transferCounterpartyAmount).s ===
            decimal(event.value).s ||
          (other.cashState && other.cashState.openingDate <= date)
        ) {
          fail(result, 'TRANSFER_COUNTERPART_MISSING');
          continue;
        }
        result.externalFlows = cashIncluded(event.accountId)
          ? [
              {
                currency: ledgerCurrency(event.accountId),
                amount: cashIncluded(other.id)
                  ? '0'
                  : decimal(event.value).toFixed()
              }
            ]
          : [
              {
                currency: other.currency,
                amount: decimal(event.transferCounterpartyAmount).toFixed()
              }
            ];
        if (cashIncluded(other.id))
          fail(result, 'LEGACY_CASH_COVERAGE_UNVERIFIABLE', false);
      } else {
        fail(result, 'TRANSFER_INVALID_CARDINALITY');
      }
    }
  }

  for (const order of input.orders) {
    if (
      !inRange(order.date) ||
      !(order.accountId == null ? !input.accountIds : included(order.accountId))
    )
      continue;
    const event = order.cashEventId ? events.get(order.cashEventId) : undefined;
    if (
      event?.orderId !== order.id ||
      event.date !== order.date ||
      !items.some((entry) => entry.sources.orderIds.includes(order.id))
    ) {
      items.push(
        fail(
          item(
            order.date,
            'unavailable',
            order.accountId ? [order.accountId] : [],
            [],
            order
          ),
          'ORDER_CASH_EFFECT_MISSING'
        )
      );
    }
  }

  return Array.from(days(start, end), (date) => {
    const dailyItems = items
      .filter((entry) => entry.date === date)
      .sort((a, b) =>
        JSON.stringify(a.sources).localeCompare(JSON.stringify(b.sources))
      );
    const classification = dailyItems.some(
      (entry) => entry.classification === 'unclassified'
    )
      ? 'unclassified'
      : 'complete';
    const coverage = dailyItems.some(
      (entry) => entry.coverage === 'unavailable'
    )
      ? 'unavailable'
      : 'verified';
    const reconciliation = dailyItems.some(
      (entry) => entry.reconciliation === 'unresolved'
    )
      ? 'unresolved'
      : 'none';
    const sums = new Map<string, Big>();
    for (const entry of dailyItems)
      for (const flow of entry.externalFlows ?? [])
        sums.set(
          flow.currency,
          (sums.get(flow.currency) ?? new Big(0)).plus(flow.amount)
        );
    return {
      date,
      items: dailyItems,
      classification,
      coverage,
      reconciliation,
      externalFlows:
        classification === 'complete' &&
        coverage === 'verified' &&
        reconciliation === 'none'
          ? [...sums]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([currency, amount]) => ({
                currency,
                amount: amount.toFixed()
              }))
          : null
    };
  });
}

function decimal(value: string): Big {
  if (typeof value !== 'string')
    throw new TypeError('Expected a decimal string');
  return new Big(value);
}

function unique<T extends { id: string }>(
  records: readonly T[]
): Map<string, T> {
  const map = new Map(records.map((record) => [record.id, record]));
  if (map.size !== records.length)
    throw new TypeError('Duplicate source identifiers');
  return map;
}

function civilDate(value: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new TypeError('Expected a civil date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new RangeError('Invalid civil date');
  return parsed;
}

function* days(start: Date, end: Date): Generator<string> {
  for (const date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1))
    yield date.toISOString().slice(0, 10);
}
