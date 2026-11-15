import { TAG_ID_EXCLUDE_FROM_ANALYSIS } from '@ghostfolio/common/config';

import type { CashEvent, Prisma } from '@prisma/client';

import type {
  ClassificationAccount,
  ClassificationCashEvent,
  ClassificationOrder
} from './cash-event-classifier';
import { orderAccountingDate } from './daily-cash-reader-dates';

export type ClassificationPrismaAccount = Prisma.AccountGetPayload<{
  include: {
    cashState: true;
    tags: true;
  };
}>;

export type ClassificationPrismaOrder = Prisma.OrderGetPayload<{
  include: {
    SymbolProfile: {
      select: { currency: true };
    };
    cashEvent: {
      select: { id: true };
    };
  };
}>;

export function mapClassificationAccount(
  account: ClassificationPrismaAccount
): ClassificationAccount {
  const state = account.cashState;

  return {
    id: account.id,
    userId: account.userId,
    currency: account.currency,
    excluded: account.tags.some(
      ({ tagId }) => tagId === TAG_ID_EXCLUDE_FROM_ANALYSIS
    ),
    cashState: state
      ? {
          currency: state.currency,
          openingDate: state.openingDate.toISOString().slice(0, 10),
          openingBalance: state.openingBalance.toFixed(),
          revision: state.revision,
          includeCashInPortfolio: state.includeCashInPortfolio
        }
      : null
  };
}

export function mapClassificationOrder(
  order: ClassificationPrismaOrder
): ClassificationOrder {
  return {
    id: order.id,
    userId: order.userId,
    accountId: order.accountId,
    accountUserId: order.accountUserId,
    date: orderAccountingDate(order.date),
    currency: order.currency,
    symbolCurrency: order.SymbolProfile.currency,
    type: order.type,
    quantity: String(order.quantity),
    unitPrice: String(order.unitPrice),
    fee: String(order.fee),
    tax: String(order.tax),
    cashEventId: order.cashEvent?.id ?? null
  };
}

export function mapClassificationCashEvent(
  event: CashEvent
): ClassificationCashEvent {
  return {
    id: event.id,
    userId: event.userId,
    accountId: event.accountId,
    date: event.date.toISOString().slice(0, 10),
    sequence: event.sequence,
    type: event.type,
    value: event.value.toFixed(),
    fee: event.fee.toFixed(),
    economicClassification: event.economicClassification,
    orderId: event.orderId,
    transferId: event.transferId,
    transferCounterpartyAccountId: event.transferCounterpartyAccountId,
    transferCounterpartyMode: event.transferCounterpartyMode,
    transferCounterpartyAmount:
      event.transferCounterpartyAmount?.toFixed() ?? null,
    transferCounterpartyCurrency: event.transferCounterpartyCurrency
  };
}
