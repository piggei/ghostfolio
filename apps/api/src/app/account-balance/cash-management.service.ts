import { PortfolioChangedEvent } from '@ghostfolio/api/events/portfolio-changed.event';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import {
  CashConfirmation,
  CashEventInput,
  CashManagementSnapshot
} from '@ghostfolio/common/interfaces';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Account, CashEvent, Order, Prisma } from '@prisma/client';
import { Big } from 'big.js';
import { randomUUID } from 'node:crypto';

import {
  CashBalanceCalculation,
  CashBalanceEvent,
  CashOpeningBalance,
  calculateCashBalances
} from './cash-balance-calculator';
import { findNewCashDeficit } from './cash-balance-warning';

export type {
  CashEventInput,
  CashManagementSnapshot
} from '@ghostfolio/common/interfaces';

interface CashAccountScope {
  accountId: string;
  userId: string;
}

type CashState = Prisma.AccountCashStateGetPayload<{
  include: { events: true };
}>;

type EventValue = Pick<CashEvent, 'date' | 'sequence' | 'type'> & {
  value: Prisma.Decimal | string;
};

const MAX_DATABASE_INTEGER = 2147483647;

/**
 * Canonical cash ledger and the compatibility projection consumed by portfolio calculators.
 * All writers lock the owner's Account row before touching cash. Activity effects,
 * transfers and projections commit together; manual mutations also require a revision.
 * Negative balances require a server-calculated confirmation. Earlier unmanaged
 * history is never reconstructed from old investment activities.
 */
@Injectable()
export class CashManagementService {
  private readonly logger = new Logger(CashManagementService.name);

  public constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly prismaService: PrismaService,
    private readonly exchangeRateDataService?: ExchangeRateDataService
  ) {}

  public async open({
    accountId,
    userId,
    date,
    balance,
    confirmNegativeBalance = false
  }: CashAccountScope & {
    confirmNegativeBalance?: boolean;
    balance: string;
    date: string;
  }): Promise<CashManagementSnapshot> {
    const scope = { accountId, userId };
    const openingDate = this.toUtcDate(date);
    const openingBalance = this.normalizeValue(balance);
    const calculation = this.calculate({
      openingBalance: { balance: openingBalance, date, sequence: 0 },
      events: []
    });
    if (new Big(openingBalance).lt(0) && !confirmNegativeBalance) {
      this.requireNegativeConfirmation(
        scope.accountId,
        null,
        calculation.minimumBalance.date
      );
    }
    const result = await this.inAccountTransaction(
      scope,
      async (transaction, account) => {
        if (!account.currency?.trim()) {
          throw new BadRequestException('The account must have a currency');
        }

        if (await this.readState(transaction, scope)) {
          throw new ConflictException('Cash management is already open');
        }

        // Only a balance at the exact opening date can be adopted. Later legacy
        // snapshots require an explicit historical reconciliation workflow.
        await this.checkProjectionOwnership({
          transaction,
          scope,
          openingDate,
          isOpening: true
        });

        const state = await transaction.accountCashState.create({
          data: {
            ...scope,
            currency: account.currency,
            lastSequence: 0,
            openingBalance,
            openingDate,
            revision: 0
          },
          include: { events: true }
        });

        await this.writeProjection(transaction, state, calculation);

        return this.toSnapshot(state, calculation);
      }
    );

    this.publishChange(userId);

    return result;
  }

  public async get(
    scope: CashAccountScope
  ): Promise<CashManagementSnapshot | null> {
    return this.inAccountTransaction(scope, async (transaction, account) => {
      const state = await this.readState(transaction, scope);

      if (!state) {
        return null;
      }

      this.checkCurrency(account, state);

      return this.toSnapshot(state, this.calculateState(state));
    });
  }

  public async createEvent({
    accountId,
    userId,
    expectedRevision,
    event,
    confirmNegativeBalance = false
  }: CashAccountScope & {
    confirmNegativeBalance?: boolean;
    event: CashEventInput;
    expectedRevision: number;
  }): Promise<CashManagementSnapshot> {
    const scope = { accountId, userId };
    const normalizedEvent = this.normalizeEvent(event);
    const result = await this.inAccountTransaction(
      scope,
      async (transaction, account) => {
        const state = await this.requireState({
          transaction,
          scope,
          account,
          expectedRevision
        });
        const sequence = this.nextSequence(state);
        const calculation = this.calculate({
          openingBalance: this.toOpeningBalance(state),
          events: [
            ...state.events.map((item) => this.toCalculatorEvent(item)),
            this.toCalculatorEvent({ ...normalizedEvent, sequence })
          ]
        });

        this.checkNewDeficit(
          state,
          [
            ...state.events.map((item) => this.toCalculatorEvent(item)),
            this.toCalculatorEvent({ ...normalizedEvent, sequence })
          ],
          confirmNegativeBalance
        );
        await this.checkProjectionOwnership({
          transaction,
          scope,
          openingDate: state.openingDate
        });

        const createdEvent = await transaction.cashEvent.create({
          data: { ...scope, ...normalizedEvent, sequence }
        });
        const nextState: CashState = {
          ...state,
          events: [...state.events, createdEvent],
          lastSequence: sequence,
          revision: state.revision + 1
        };

        await this.writeState(transaction, nextState);
        await this.writeProjection(transaction, nextState, calculation);

        return this.toSnapshot(nextState, calculation);
      }
    );

    this.publishChange(userId);

    return result;
  }

  public async updateEvent({
    accountId,
    userId,
    expectedRevision,
    eventId,
    event,
    confirmNegativeBalance = false
  }: CashAccountScope & {
    confirmNegativeBalance?: boolean;
    event: CashEventInput;
    eventId: string;
    expectedRevision: number;
  }): Promise<CashManagementSnapshot> {
    const scope = { accountId, userId };
    const normalizedEvent = this.normalizeEvent(event);
    const result = await this.inAccountTransaction(
      scope,
      async (transaction, account) => {
        const state = await this.requireState({
          transaction,
          scope,
          account,
          expectedRevision
        });
        const previousEvent = this.requireEvent(state, eventId);

        if (previousEvent.type !== normalizedEvent.type) {
          throw new BadRequestException(
            'The cash event type cannot be changed'
          );
        }

        const dateChanged =
          previousEvent.date.getTime() !== normalizedEvent.date.getTime();
        const sequence = dateChanged
          ? this.nextSequence(state)
          : previousEvent.sequence;
        const calculation = this.calculate({
          openingBalance: this.toOpeningBalance(state),
          events: state.events.map((item) => {
            return this.toCalculatorEvent(
              item.id === eventId ? { ...normalizedEvent, sequence } : item
            );
          })
        });

        this.checkNewDeficit(
          state,
          state.events.map((item) =>
            this.toCalculatorEvent(
              item.id === eventId ? { ...normalizedEvent, sequence } : item
            )
          ),
          confirmNegativeBalance
        );
        await this.checkProjectionOwnership({
          transaction,
          scope,
          openingDate: state.openingDate
        });

        const updatedEvent = await transaction.cashEvent.update({
          data: { ...normalizedEvent, sequence },
          where: { ...scope, id: eventId }
        });
        const nextState: CashState = {
          ...state,
          events: state.events.map((item) => {
            return item.id === eventId ? updatedEvent : item;
          }),
          lastSequence: dateChanged ? sequence : state.lastSequence,
          revision: state.revision + 1
        };

        await this.writeState(transaction, nextState);
        await this.writeProjection(transaction, nextState, calculation);

        return this.toSnapshot(nextState, calculation);
      }
    );

    this.publishChange(userId);

    return result;
  }

  public async deleteEvent({
    accountId,
    userId,
    expectedRevision,
    eventId,
    confirmNegativeBalance = false
  }: CashAccountScope & {
    confirmNegativeBalance?: boolean;
    eventId: string;
    expectedRevision: number;
  }): Promise<CashManagementSnapshot> {
    const scope = { accountId, userId };
    const result = await this.inAccountTransaction(
      scope,
      async (transaction, account) => {
        const state = await this.requireState({
          transaction,
          scope,
          account,
          expectedRevision
        });

        this.requireEvent(state, eventId);

        const nextState: CashState = {
          ...state,
          events: state.events.filter(({ id }) => id !== eventId),
          revision: state.revision + 1
        };
        const calculation = this.calculateState(nextState);

        this.checkNewDeficit(
          state,
          nextState.events.map((item) => this.toCalculatorEvent(item)),
          confirmNegativeBalance
        );
        await this.checkProjectionOwnership({
          transaction,
          scope,
          openingDate: state.openingDate
        });
        await transaction.cashEvent.delete({
          where: { ...scope, id: eventId }
        });
        await this.writeState(transaction, nextState);
        await this.writeProjection(transaction, nextState, calculation);

        return this.toSnapshot(nextState, calculation);
      }
    );

    this.publishChange(userId);

    return result;
  }

  /** Locks all participating accounts in a stable order before any financial write. */
  public async runInAccounts<T>(
    { accountIds, userId }: { accountIds: string[]; userId: string },
    operation: (
      transaction: Prisma.TransactionClient,
      accounts: Pick<Account, 'id' | 'currency'>[]
    ) => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prismaService.$transaction(
          async (transaction) => {
            const accounts: Pick<Account, 'id' | 'currency'>[] = [];
            for (const accountId of [
              ...new Set(accountIds.filter(Boolean))
            ].sort()) {
              const [account] = await transaction.$queryRaw<
                Pick<Account, 'id' | 'currency'>[]
              >`
              SELECT "id", "currency" FROM "Account"
              WHERE "id" = ${accountId} AND "userId" = ${userId} FOR UPDATE
            `;
              if (!account) {
                throw new NotFoundException('Account not found');
              }
              accounts.push(account);
            }
            return operation(transaction, accounts);
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 5000,
            timeout: 15000
          }
        );
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt >= 2
        ) {
          throw error;
        }
      }
    }
  }

  public validateRestore(
    snapshot: import('@ghostfolio/common/interfaces').CashManagementExport,
    currency: string
  ) {
    if (
      snapshot?.version !== 1 ||
      snapshot.currency !== currency ||
      typeof snapshot.defaultUpdateCash !== 'boolean' ||
      snapshot.openingBalance?.sequence !== 0 ||
      !Array.isArray(snapshot.events)
    ) {
      throw new BadRequestException('Invalid cash ledger export');
    }
    const openingBalance = {
      ...snapshot.openingBalance,
      balance: this.normalizeValue(snapshot.openingBalance.balance)
    };
    this.toUtcDate(openingBalance.date);
    const orderIds = new Set<string>();
    const events = snapshot.events.map((event) => {
      if (
        !event ||
        (event.transferId && typeof event.transferId !== 'string')
      ) {
        throw new BadRequestException('Invalid cash ledger event');
      }
      const normalized = this.normalizeEvent(event);
      if (
        !Number.isInteger(event.sequence) ||
        event.sequence < 1 ||
        event.sequence > MAX_DATABASE_INTEGER ||
        (event.orderId &&
          (typeof event.orderId !== 'string' || orderIds.has(event.orderId)))
      ) {
        throw new BadRequestException(
          'Invalid cash ledger position or activity link'
        );
      }
      if (event.orderId) {
        orderIds.add(event.orderId);
      }
      return { ...normalized, sequence: event.sequence };
    });
    return this.calculate({
      openingBalance,
      events: events.map((event) => this.toCalculatorEvent(event))
    });
  }

  /** Restore replaces no active ledger. Reimporting a backup cannot append its cash twice. */
  public async restore(
    scope: CashAccountScope,
    snapshot: import('@ghostfolio/common/interfaces').CashManagementExport,
    orderIds: Record<string, string>
  ) {
    await this.inAccountTransaction(scope, async (transaction, account) => {
      this.validateRestore(snapshot, account.currency);
      if (await this.readState(transaction, scope)) {
        return;
      }
      const calculation = this.validateRestore(snapshot, account.currency);
      const openingDate = this.toUtcDate(snapshot.openingBalance.date);
      const balances = await transaction.accountBalance.findMany({
        where: { ...scope, date: { gte: openingDate } }
      });
      // Only identical imported snapshots may be adopted; unrelated broker history is protected.
      for (const balance of balances) {
        const expected = calculation.balances.find(
          ({ date }) => date === balance.date.toISOString().slice(0, 10)
        );
        if (
          !expected ||
          balance.date.getUTCHours() !== 0 ||
          balance.date.getUTCMinutes() !== 0 ||
          balance.date.getUTCSeconds() !== 0 ||
          balance.date.getUTCMilliseconds() !== 0 ||
          expected.value.toNumber() !== balance.value
        ) {
          throw new ConflictException(
            'The imported cash transactions conflict with existing balances'
          );
        }
      }
      const data: Prisma.CashEventUncheckedCreateWithoutStateInput[] = [];
      for (const event of snapshot.events) {
        const orderId = event.orderId ? orderIds[event.orderId] : undefined;
        if (event.orderId && !orderId) {
          throw new ConflictException(
            'An activity linked to the imported cash ledger is missing'
          );
        }
        if (
          orderId &&
          !(await transaction.order.findFirst({
            where: {
              id: orderId,
              userId: scope.userId,
              accountId: scope.accountId
            }
          }))
        ) {
          throw new ConflictException(
            'An imported cash event belongs to a different account'
          );
        }
        data.push({
          ...this.normalizeEvent(event),
          sequence: event.sequence,
          orderId,
          transferId: event.transferId
        });
      }
      const state = await transaction.accountCashState.create({
        data: {
          ...scope,
          currency: account.currency,
          defaultUpdateCash: snapshot.defaultUpdateCash,
          openingDate,
          openingBalance: this.normalizeValue(snapshot.openingBalance.balance),
          lastSequence: Math.max(
            0,
            ...snapshot.events.map(({ sequence }) => sequence)
          ),
          events: { create: data }
        },
        include: { events: true }
      });
      await this.writeProjection(transaction, state, calculation);
    });
    this.publishChange(scope.userId);
  }

  public async updatePreferences(
    scope: CashAccountScope & {
      expectedRevision: number;
      defaultUpdateCash: boolean;
    }
  ): Promise<CashManagementSnapshot> {
    const result = await this.inAccountTransaction(
      scope,
      async (transaction, account) => {
        const state = await this.requireState({
          transaction,
          scope,
          account,
          expectedRevision: scope.expectedRevision
        });
        await transaction.accountCashState.update({
          where: {
            accountId_userId: {
              accountId: scope.accountId,
              userId: scope.userId
            }
          },
          data: {
            defaultUpdateCash: scope.defaultUpdateCash,
            revision: state.revision + 1
          }
        });
        return this.toSnapshot(
          {
            ...state,
            defaultUpdateCash: scope.defaultUpdateCash,
            revision: state.revision + 1
          },
          this.calculateState(state)
        );
      }
    );
    return result;
  }

  /** Used by every legacy balance writer, under the same account lock as opening. */
  public async assertLegacyBalanceWrite(
    transaction: Prisma.TransactionClient,
    scope: CashAccountScope,
    date: Date
  ) {
    const state = await this.readState(transaction, scope);
    if (state && date >= state.openingDate) {
      throw new ConflictException(
        'Use the cash ledger to change a managed balance'
      );
    }
  }

  /** Synchronizes the persisted activity and its exact account-currency cash effect. */
  public async synchronizeOrder(
    transaction: Prisma.TransactionClient,
    order: Order & { SymbolProfile: { currency: string } },
    options: CashConfirmation & { enabled?: boolean; original?: Order }
  ): Promise<void> {
    const previousEvent = await transaction.cashEvent.findUnique({
      where: { orderId: order.id }
    });
    const scope = { accountId: order.accountId, userId: order.userId };
    const state = order.accountId
      ? await this.readState(transaction, scope)
      : null;
    const date = order.date.toISOString().slice(0, 10);
    const eligible =
      !['LIABILITY', 'VALUABLE'].includes(order.type) &&
      order.date <= new Date();
    const enabled =
      eligible &&
      (options.enabled ??
        (options.original
          ? !!previousEvent
          : state?.defaultUpdateCash &&
            date >= state.openingDate.toISOString().slice(0, 10)));

    if (previousEvent && enabled && order.accountId && !state) {
      throw new ConflictException(
        'Start cash management on the destination account before moving this activity'
      );
    }
    if (previousEvent && previousEvent.accountId !== order.accountId) {
      const oldScope = {
        accountId: previousEvent.accountId,
        userId: order.userId
      };
      const oldState = await this.readState(transaction, oldScope);
      if (!oldState) {
        throw new ConflictException('The original cash ledger is missing');
      }
      const events = oldState.events.filter(
        ({ id }) => id !== previousEvent.id
      );
      this.checkNewDeficit(
        oldState,
        events.map((item) => this.toCalculatorEvent(item)),
        options.confirmNegativeBalance ?? false,
        options.cashRevisions ?? {}
      );
      await this.checkProjectionOwnership({
        transaction,
        scope: oldScope,
        openingDate: oldState.openingDate
      });
      await transaction.cashEvent.delete({
        where: { id: previousEvent.id, ...oldScope }
      });
      await this.rebuildState(transaction, { ...oldState, events });
    }

    if (!state) {
      if (enabled && order.accountId && !options.original) {
        await this.applyLegacyMovement(
          transaction,
          scope,
          await this.orderAmount(
            order,
            (
              await transaction.account.findUnique({
                where: {
                  id_userId: { id: order.accountId, userId: order.userId }
                }
              })
            ).currency
          ),
          order.date
        );
      }
      return;
    }
    const sameAccountEvent =
      previousEvent?.accountId === order.accountId ? previousEvent : null;
    if (!enabled && !sameAccountEvent) {
      return;
    }
    const events = state.events.filter(({ orderId }) => orderId !== order.id);
    let event: CashEvent | undefined;
    if (enabled) {
      const unchanged =
        options.original &&
        ['accountId', 'currency', 'fee', 'quantity', 'type', 'unitPrice'].every(
          (key) => order[key] === options.original[key]
        ) &&
        order.date.getTime() === options.original.date.getTime();
      const value =
        unchanged && sameAccountEvent
          ? sameAccountEvent.value.toString()
          : await this.orderAmount(order, state.currency);
      const sequence =
        sameAccountEvent?.date.toISOString().slice(0, 10) === date
          ? sameAccountEvent.sequence
          : this.nextSequence(state);
      event = {
        accountId: order.accountId,
        userId: order.userId,
        date: this.toUtcDate(date),
        sequence,
        value: new Prisma.Decimal(value),
        type: 'MOVEMENT',
        comment: order.comment,
        orderId: order.id,
        transferId: null,
        id: sameAccountEvent?.id ?? randomUUID(),
        createdAt: sameAccountEvent?.createdAt ?? new Date(),
        updatedAt: new Date()
      };
      events.push(event);
    }
    this.checkNewDeficit(
      state,
      events.map((item) => this.toCalculatorEvent(item)),
      options.confirmNegativeBalance ?? false,
      options.cashRevisions ?? {}
    );
    await this.checkProjectionOwnership({
      transaction,
      scope,
      openingDate: state.openingDate
    });
    if (event) {
      const { id, createdAt, updatedAt, ...data } = event;
      await transaction.cashEvent.upsert({
        where: { id },
        create: { id, createdAt, updatedAt, ...data },
        update: data
      });
    } else {
      await transaction.cashEvent.delete({
        where: { id: sameAccountEvent.id, ...scope }
      });
    }
    await this.rebuildState(transaction, {
      ...state,
      events,
      lastSequence: Math.max(state.lastSequence, event?.sequence ?? 0)
    });
  }

  public async removeOrderEffects(
    transaction: Prisma.TransactionClient,
    orders: Order[],
    confirmation: CashConfirmation = {}
  ) {
    const accountIds = [
      ...new Set(orders.map(({ accountId }) => accountId).filter(Boolean))
    ];
    for (const accountId of accountIds) {
      const state = await this.readState(transaction, {
        accountId,
        userId: orders[0].userId
      });
      if (!state) {
        continue;
      }
      const ids = new Set(orders.map(({ id }) => id));
      const events = state.events.filter(({ orderId }) => !ids.has(orderId));
      if (events.length === state.events.length) {
        continue;
      }
      this.checkNewDeficit(
        state,
        events.map((item) => this.toCalculatorEvent(item)),
        confirmation.confirmNegativeBalance ?? false,
        confirmation.cashRevisions ?? {}
      );
      await this.checkProjectionOwnership({
        transaction,
        scope: { accountId, userId: state.userId },
        openingDate: state.openingDate
      });
      await transaction.cashEvent.deleteMany({
        where: { accountId, userId: state.userId, orderId: { in: [...ids] } }
      });
      await this.rebuildState(transaction, { ...state, events });
    }
  }

  public async transfer({
    accountIdFrom,
    accountIdTo,
    balance,
    userId,
    ...confirmation
  }: CashConfirmation & {
    accountIdFrom: string;
    accountIdTo: string;
    balance: number;
    userId: string;
  }) {
    if (
      accountIdFrom === accountIdTo ||
      !Number.isFinite(balance) ||
      balance <= 0
    ) {
      throw new BadRequestException(
        'Choose two accounts and a positive transfer amount'
      );
    }
    await this.runInAccounts(
      { accountIds: [accountIdFrom, accountIdTo], userId },
      async (transaction, accounts) => {
        const from = accounts.find(({ id }) => id === accountIdFrom);
        const to = accounts.find(({ id }) => id === accountIdTo);
        const converted = await this.exchangeRateDataService.toCurrencyAtDate(
          balance,
          from.currency,
          to.currency,
          new Date()
        );
        if (!Number.isFinite(converted)) {
          throw new BadRequestException('Exchange rate is unavailable');
        }
        const transferId = randomUUID();
        const date = new Date().toISOString().slice(0, 10);
        for (const [accountId, value] of [
          [accountIdFrom, new Big(balance).neg().toString()],
          [accountIdTo, new Big(converted).toString()]
        ] as const) {
          const scope = { accountId, userId };
          const state = await this.readState(transaction, scope);
          if (!state) {
            await this.applyLegacyMovement(
              transaction,
              scope,
              value,
              this.toUtcDate(date),
              accountId === accountIdFrom
            );
            continue;
          }
          const event = {
            ...scope,
            id: randomUUID(),
            date: this.toUtcDate(date),
            sequence: this.nextSequence(state),
            type: 'MOVEMENT' as const,
            value: new Prisma.Decimal(this.normalizeValue(value)),
            comment: 'Cash transfer',
            orderId: null,
            transferId,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          const events = [...state.events, event];
          this.checkNewDeficit(
            state,
            events.map((item) => this.toCalculatorEvent(item)),
            confirmation.confirmNegativeBalance ?? false,
            confirmation.cashRevisions ?? {}
          );
          await this.checkProjectionOwnership({
            transaction,
            scope,
            openingDate: state.openingDate
          });
          await transaction.cashEvent.create({ data: event });
          await this.rebuildState(transaction, {
            ...state,
            events,
            lastSequence: event.sequence
          });
        }
      }
    );
    this.publishChange(userId);
  }

  private async orderAmount(
    order: Order & { SymbolProfile: { currency: string } },
    currency: string
  ): Promise<string> {
    let amount = new Big(order.unitPrice).mul(order.quantity);
    if (['BUY', 'FEE'].includes(order.type)) {
      amount = amount.neg();
    }
    amount = amount.minus(order.fee);
    const from = order.currency ?? order.SymbolProfile.currency;
    if (from === currency) {
      return this.normalizeValue(amount.toString());
    }
    const converted = await this.exchangeRateDataService.toCurrencyAtDate(
      amount.toNumber(),
      from,
      currency,
      order.date
    );
    if (!Number.isFinite(converted)) {
      throw new BadRequestException('Exchange rate is unavailable');
    }
    return this.normalizeValue(new Big(converted).toString());
  }

  private async applyLegacyMovement(
    transaction: Prisma.TransactionClient,
    scope: CashAccountScope,
    amount: string,
    date: Date,
    requireFunds = false
  ) {
    const latest = await transaction.accountBalance.findFirst({
      where: {
        ...scope,
        date: {
          lt: new Date(
            new Date(
              `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
            ).getTime() + 86400000
          )
        }
      },
      orderBy: { date: 'desc' }
    });
    const value = new Big(latest?.value ?? 0).plus(amount).toNumber();
    if (requireFunds && value < 0) {
      throw new ConflictException('Insufficient cash in the source account');
    }
    const day = this.toUtcDate(date.toISOString().slice(0, 10));
    await transaction.accountBalance.upsert({
      where: {
        accountId_date: { accountId: scope.accountId, date: day },
        userId: scope.userId
      },
      create: { ...scope, date: day, value },
      update: { value }
    });
  }

  private async rebuildState(
    transaction: Prisma.TransactionClient,
    state: CashState
  ) {
    if (state.revision >= MAX_DATABASE_INTEGER) {
      throw new ConflictException('Cash revision limit reached');
    }
    const nextState = { ...state, revision: state.revision + 1 };
    await this.writeState(transaction, nextState);
    await this.writeProjection(
      transaction,
      nextState,
      this.calculateState(nextState)
    );
  }

  private checkNewDeficit(
    state: CashState,
    events: CashBalanceEvent[],
    confirmed: boolean,
    revisions?: Record<string, number>
  ) {
    this.calculate({ openingBalance: this.toOpeningBalance(state), events });
    const deficit = findNewCashDeficit({
      openingBalance: this.toOpeningBalance(state),
      previousEvents: state.events.map((event) =>
        this.toCalculatorEvent(event)
      ),
      events
    });
    if (
      deficit &&
      (!confirmed ||
        (revisions && revisions[state.accountId] !== state.revision))
    ) {
      this.requireNegativeConfirmation(
        state.accountId,
        state.revision,
        deficit.date
      );
    }
  }

  private requireNegativeConfirmation(
    accountId: string,
    revision: number | null,
    date: string
  ): never {
    throw new ConflictException({
      code: 'CASH_CONFIRMATION_REQUIRED',
      message:
        'This change would create or worsen a negative cash balance. Confirm to continue.',
      accountId,
      revision,
      negativeBalanceDate: date
    });
  }

  private calculate(
    input: Parameters<typeof calculateCashBalances>[0]
  ): CashBalanceCalculation {
    try {
      return calculateCashBalances(input);
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  private calculateState(state: CashState): CashBalanceCalculation {
    return this.calculate({
      openingBalance: this.toOpeningBalance(state),
      events: state.events.map((event) => this.toCalculatorEvent(event))
    });
  }

  private checkCurrency(account: Pick<Account, 'currency'>, state: CashState) {
    if (account.currency !== state.currency) {
      throw new ConflictException('The managed account currency has changed');
    }
  }

  private async checkProjectionOwnership({
    transaction,
    scope,
    openingDate,
    isOpening = false
  }: {
    isOpening?: boolean;
    openingDate: Date;
    scope: CashAccountScope;
    transaction: Prisma.TransactionClient;
  }): Promise<void> {
    const foreignBalance = await transaction.accountBalance.findFirst({
      select: { id: true },
      where: {
        ...scope,
        date: isOpening ? { gt: openingDate } : { gte: openingDate },
        isCashManagementProjection: false
      }
    });

    if (foreignBalance) {
      throw new ConflictException(
        'Existing account balances require an explicit reconciliation'
      );
    }
  }

  private async inAccountTransaction<T>(
    { accountId, userId }: CashAccountScope,
    operation: (
      transaction: Prisma.TransactionClient,
      account: Pick<Account, 'id' | 'currency'>
    ) => Promise<T>
  ): Promise<T> {
    return this.runInAccounts(
      { accountIds: [accountId], userId },
      (transaction, [account]) => operation(transaction, account)
    );
  }

  private nextSequence(state: CashState): number {
    if (state.lastSequence >= MAX_DATABASE_INTEGER) {
      throw new ConflictException('Cash event sequence limit reached');
    }

    return state.lastSequence + 1;
  }

  private normalizeEvent(event: CashEventInput): {
    comment: string | null;
    date: Date;
    type: CashEvent['type'];
    value: string;
  } {
    const date = this.toUtcDate(event.date);
    const comment = event.comment ?? null;

    if (comment !== null && typeof comment !== 'string') {
      throw new BadRequestException('Cash event comments must be strings');
    }

    switch (event.type) {
      case 'MOVEMENT':
        return {
          comment,
          date,
          type: event.type,
          value: this.normalizeValue(event.amount)
        };
      case 'CHECKPOINT':
        return {
          comment,
          date,
          type: event.type,
          value: this.normalizeValue(event.balance)
        };
      default:
        throw new BadRequestException('Unsupported cash event type');
    }
  }

  private normalizeValue(input: string): string {
    if (typeof input !== 'string') {
      throw new BadRequestException('Cash amounts must be decimal strings');
    }

    let value: Big;

    try {
      value = new Big(input);
    } catch {
      throw new BadRequestException('Cash amounts must be finite decimals');
    }

    // Reject values that Decimal(65,30) would round or overflow. The ledger
    // therefore stores exactly the amount accepted at the service boundary.
    if (value.abs().gte('1e35') || !value.eq(value.round(30, Big.roundDown))) {
      throw new BadRequestException(
        'Cash amounts support up to 35 integer and 30 fractional digits'
      );
    }

    return value.toFixed();
  }

  private publishChange(userId: string): void {
    try {
      this.eventEmitter.emit(
        PortfolioChangedEvent.getName(),
        new PortfolioChangedEvent({ userId })
      );
    } catch (error) {
      // A notification failure must not turn a committed write into a retry.
      // Durable delivery would require an outbox, beyond this service increment.
      this.logger.error(
        'Cash management committed, but the portfolio notification failed',
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  private readState(
    transaction: Prisma.TransactionClient,
    scope: CashAccountScope
  ): Promise<CashState | null> {
    return transaction.accountCashState.findUnique({
      include: {
        events: { orderBy: [{ date: 'asc' }, { sequence: 'asc' }] }
      },
      where: {
        accountId_userId: { accountId: scope.accountId, userId: scope.userId }
      }
    });
  }

  private requireEvent(state: CashState, eventId: string): CashEvent {
    const event = state.events.find(({ id }) => id === eventId);

    if (!event) {
      throw new NotFoundException('Cash event not found in this account');
    }

    if (event.orderId || event.transferId) {
      throw new ConflictException(
        'Edit the linked activity or transfer instead'
      );
    }

    return event;
  }

  private async requireState({
    transaction,
    scope,
    account,
    expectedRevision
  }: {
    account: Pick<Account, 'currency'>;
    expectedRevision: number;
    scope: CashAccountScope;
    transaction: Prisma.TransactionClient;
  }): Promise<CashState> {
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision > MAX_DATABASE_INTEGER
    ) {
      throw new BadRequestException('A valid cash revision is required');
    }

    const state = await this.readState(transaction, scope);

    if (!state) {
      throw new ConflictException('Cash management is not open');
    }

    this.checkCurrency(account, state);

    if (state.revision !== expectedRevision) {
      throw new ConflictException(
        'The cash history changed; reload the account and try again'
      );
    }

    if (state.revision >= MAX_DATABASE_INTEGER) {
      throw new ConflictException('Cash revision limit reached');
    }

    return state;
  }

  private toCalculatorEvent({
    date,
    sequence,
    type,
    value
  }: EventValue): CashBalanceEvent {
    const position = { date: date.toISOString().slice(0, 10), sequence };

    switch (type) {
      case 'MOVEMENT':
        return { ...position, amount: value.toString(), type };
      case 'CHECKPOINT':
        return { ...position, balance: value.toString(), type };
      default:
        throw new BadRequestException('Unsupported cash event type');
    }
  }

  private toOpeningBalance(state: CashState): CashOpeningBalance {
    return {
      balance: state.openingBalance.toString(),
      date: state.openingDate.toISOString().slice(0, 10),
      sequence: 0
    };
  }

  private toSnapshot(
    state: CashState,
    calculation: CashBalanceCalculation
  ): CashManagementSnapshot {
    const events = state.events
      .map((event) => {
        return {
          ...this.toCalculatorEvent(event),
          comment: event.comment,
          id: event.id,
          ...(event.orderId ? { orderId: event.orderId } : {}),
          ...(event.transferId ? { transferId: event.transferId } : {})
        };
      })
      .sort((left, right) => {
        if (left.date !== right.date) {
          return left.date < right.date ? -1 : 1;
        }

        return left.sequence - right.sequence;
      });

    return {
      accountId: state.accountId,
      balances: calculation.balances.map(({ date, value }) => {
        return { date, value: value.toString() };
      }),
      currency: state.currency,
      defaultUpdateCash: state.defaultUpdateCash ?? false,
      events,
      minimumBalance: {
        ...calculation.minimumBalance,
        value: calculation.minimumBalance.value.toString()
      },
      openingBalance: this.toOpeningBalance(state),
      revision: state.revision
    };
  }

  private toUtcDate(date: string): Date {
    this.calculate({
      openingBalance: { balance: '0', date, sequence: 0 },
      events: []
    });

    if (date.startsWith('0000-')) {
      throw new BadRequestException('Cash dates must have a positive year');
    }

    return new Date(`${date}T00:00:00.000Z`);
  }

  private async writeProjection(
    transaction: Prisma.TransactionClient,
    state: CashState,
    calculation: CashBalanceCalculation
  ): Promise<void> {
    const scope = { accountId: state.accountId, userId: state.userId };
    const balances = calculation.balances.map(({ date, value }) => {
      // Compatibility boundary: AccountBalance remains Float. These approximate
      // projections must never be used to reconstruct the decimal journal.
      const projectedValue = value.toNumber();

      if (!Number.isFinite(projectedValue)) {
        throw new BadRequestException(
          'Cash balance cannot be projected as a number'
        );
      }

      return { date: new Date(`${date}T00:00:00.000Z`), value: projectedValue };
    });

    for (const { date, value } of balances) {
      await transaction.accountBalance.upsert({
        create: { ...scope, date, isCashManagementProjection: true, value },
        update: { isCashManagementProjection: true, value },
        where: {
          accountId_date: { accountId: scope.accountId, date },
          userId: scope.userId
        }
      });
    }

    await transaction.accountBalance.deleteMany({
      where: {
        ...scope,
        date: {
          gte: state.openingDate,
          notIn: balances.map(({ date }) => date)
        },
        isCashManagementProjection: true
      }
    });
  }

  private async writeState(
    transaction: Prisma.TransactionClient,
    state: CashState
  ): Promise<void> {
    await transaction.accountCashState.update({
      data: { lastSequence: state.lastSequence, revision: state.revision },
      where: {
        accountId_userId: { accountId: state.accountId, userId: state.userId }
      }
    });
  }
}
