import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { CashClassificationInput } from './cash-event-classifier';
import {
  mapClassificationAccount,
  mapClassificationCashEvent,
  mapClassificationOrder
} from './daily-cash-classification-mapper';
import {
  getDailyCashReaderBounds,
  orderAccountingDate
} from './daily-cash-reader-dates';

const ORDER_INCLUDE = {
  SymbolProfile: { select: { currency: true } },
  cashEvent: { select: { id: true } }
} as const;

type ReaderScope = Pick<
  CashClassificationInput,
  'userId' | 'startDate' | 'endDate' | 'accountIds'
> & {
  transaction?: Prisma.TransactionClient;
};

type TransactionScope = Omit<ReaderScope, 'transaction'>;

@Injectable()
export class DailyCashClassificationReader {
  public constructor(private readonly prisma: PrismaService) {}

  public async read({
    transaction,
    ...scope
  }: ReaderScope): Promise<CashClassificationInput> {
    const bounds = getDailyCashReaderBounds({
      startDate: scope.startDate,
      endDate: scope.endDate
    });

    if (transaction) {
      return this.readFromTransaction(transaction, scope, bounds);
    }

    return this.prisma.$transaction(
      (tx) => this.readFromTransaction(tx, scope, bounds),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
      }
    );
  }

  private async readFromTransaction(
    transaction: Prisma.TransactionClient,
    { userId, startDate, endDate, accountIds }: TransactionScope,
    bounds: ReturnType<typeof getDailyCashReaderBounds>
  ): Promise<CashClassificationInput> {
    const accounts = await transaction.account.findMany({
      where: { userId },
      include: {
        cashState: true,
        tags: true
      }
    });

    const cashEvents = await transaction.cashEvent.findMany({
      where: {
        userId,
        date: {
          gte: bounds.cashFrom,
          lt: bounds.cashUntil
        }
      }
    });

    const candidateOrders = await transaction.order.findMany({
      where: {
        userId,
        date: {
          gte: bounds.orderFrom,
          lt: bounds.orderUntil
        }
      },
      include: ORDER_INCLUDE
    });

    const ordersById = new Map(
      candidateOrders
        .filter((order) => {
          const date = orderAccountingDate(order.date);

          return date >= startDate && date <= endDate;
        })
        .map((order) => [order.id, order])
    );

    const eventsById = new Map(cashEvents.map((event) => [event.id, event]));

    // An event inside the period can refer to an order outside it.
    const missingOrderIds = [
      ...new Set(
        cashEvents
          .map(({ orderId }) => orderId)
          .filter((id): id is string => id !== null && !ordersById.has(id))
      )
    ];

    if (missingOrderIds.length > 0) {
      const linkedOrders = await transaction.order.findMany({
        where: {
          userId,
          id: { in: missingOrderIds }
        },
        include: ORDER_INCLUDE
      });

      for (const order of linkedOrders) {
        ordersById.set(order.id, order);
      }
    }

    // An order inside the period can have a settlement outside it.
    const orderIds = [...ordersById.keys()];

    if (orderIds.length > 0) {
      const linkedEvents = await transaction.cashEvent.findMany({
        where: {
          userId,
          orderId: { in: orderIds }
        }
      });

      for (const event of linkedEvents) {
        eventsById.set(event.id, event);
      }
    }

    // Transfer completeness requires every persisted leg, even when
    // the other leg belongs to a different day or an excluded account.
    const transferIds = [
      ...new Set(
        [...eventsById.values()]
          .map(({ transferId }) => transferId)
          .filter((id): id is string => id !== null)
      )
    ];

    if (transferIds.length > 0) {
      const transferEvents = await transaction.cashEvent.findMany({
        where: {
          userId,
          transferId: { in: transferIds }
        }
      });

      for (const event of transferEvents) {
        eventsById.set(event.id, event);
      }
    }

    return {
      userId,
      startDate,
      endDate,
      ...(accountIds === undefined ? {} : { accountIds }),
      accounts: accounts.map(mapClassificationAccount),
      orders: [...ordersById.values()].map(mapClassificationOrder),
      events: [...eventsById.values()].map(mapClassificationCashEvent)
    };
  }
}
