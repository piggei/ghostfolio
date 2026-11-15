import { WHERE_ACCOUNT_NOT_EXCLUDED } from '@ghostfolio/api/helper/account.helper';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Big } from 'big.js';

import {
  projectDailyCashBalances,
  type DailyCashBalance
} from './daily-cash-balance-projection';
import { getDailyCashReaderBounds } from './daily-cash-reader-dates';
import {
  projectDailyManagedCash,
  type DailyManagedCashSnapshot
} from './daily-managed-cash-projection';

export interface DailyCashPersistedAccount {
  accountId: string;
  currency: string;
  source: 'managed' | 'legacy';
  included: boolean;
  revision: number | null;
  balances: DailyCashBalance[];
}

export interface DailyCashPersistedResult {
  userId: string;
  startDate: string;
  endDate: string;
  accounts: DailyCashPersistedAccount[];
}

interface ReaderScope {
  userId: string;
  startDate: string;
  endDate: string;
  baseCurrency: string;
  accountIds?: string[];
  transaction?: Prisma.TransactionClient;
}

type TransactionScope = Omit<ReaderScope, 'transaction'>;

function civilDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class DailyCashPersistedReader {
  public constructor(private readonly prisma: PrismaService) {}
  public async read({
    userId,
    startDate,
    endDate,
    baseCurrency,
    accountIds,
    transaction
  }: ReaderScope): Promise<DailyCashPersistedResult> {
    const bounds = getDailyCashReaderBounds({ startDate, endDate });

    const scope: TransactionScope = {
      userId,
      startDate,
      endDate,
      baseCurrency,
      ...(accountIds === undefined ? {} : { accountIds })
    };

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
    { userId, startDate, endDate, baseCurrency, accountIds }: TransactionScope,
    bounds: ReturnType<typeof getDailyCashReaderBounds>
  ): Promise<DailyCashPersistedResult> {
    const accounts = await transaction.account.findMany({
      where: {
        userId,
        AND: [WHERE_ACCOUNT_NOT_EXCLUDED],
        ...(accountIds === undefined ? {} : { id: { in: accountIds } })
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        currency: true,
        cashState: {
          select: {
            accountId: true,
            currency: true,
            includeCashInPortfolio: true,
            isAutomaticOpening: true,
            openingBalance: true,
            openingDate: true,
            revision: true,
            events: {
              orderBy: [{ date: 'asc' }, { sequence: 'asc' }],
              select: {
                date: true,
                sequence: true,
                type: true,
                value: true,
                fee: true
              }
            }
          }
        }
      }
    });

    const legacyAccounts = accounts.filter(
      ({ cashState }) => cashState === null
    );

    const legacyAccountIds = legacyAccounts.map(({ id }) => id);

    let legacyRows: {
      accountId: string;
      date: Date;
      value: number;
    }[] = [];

    if (legacyAccountIds.length > 0) {
      const previousGroups = await transaction.accountBalance.groupBy({
        by: ['accountId'],
        where: {
          userId,
          accountId: { in: legacyAccountIds },
          isCashManagementProjection: false,
          date: { lt: bounds.cashFrom }
        },
        _max: { date: true }
      });

      const previousBalanceFilters: Prisma.AccountBalanceWhereInput[] =
        previousGroups.flatMap(({ accountId, _max }) => {
          return _max.date ? [{ accountId, date: _max.date }] : [];
        });

      legacyRows = await transaction.accountBalance.findMany({
        where: {
          userId,
          accountId: { in: legacyAccountIds },
          isCashManagementProjection: false,
          OR: [
            {
              date: {
                gte: bounds.cashFrom,
                lt: bounds.cashUntil
              }
            },
            ...previousBalanceFilters
          ]
        },
        orderBy: [{ accountId: 'asc' }, { date: 'asc' }],
        select: {
          accountId: true,
          date: true,
          value: true
        }
      });
    }

    const legacyBalancesByAccount = new Map<string, Map<string, Big>>();

    for (const row of legacyRows) {
      let dailyBalances = legacyBalancesByAccount.get(row.accountId);

      if (!dailyBalances) {
        dailyBalances = new Map<string, Big>();
        legacyBalancesByAccount.set(row.accountId, dailyBalances);
      }

      // AccountBalance is a Float legacy source. String conversion
      // avoids introducing an additional binary floating-point step.
      dailyBalances.set(civilDate(row.date), new Big(String(row.value)));
    }

    const result: DailyCashPersistedAccount[] = accounts.map((account) => {
      const state = account.cashState;

      if (state) {
        const snapshot: DailyManagedCashSnapshot = {
          accountId: state.accountId,
          currency: state.currency,
          includeCashInPortfolio: state.includeCashInPortfolio,
          isAutomaticOpening: state.isAutomaticOpening,
          revision: state.revision,
          openingBalance: {
            date: civilDate(state.openingDate),
            sequence: 0,
            balance: state.openingBalance.toString()
          },
          events: state.events.map((event) => {
            const position = {
              date: civilDate(event.date),
              sequence: event.sequence
            };

            if (event.type === 'CHECKPOINT') {
              return {
                ...position,
                type: 'CHECKPOINT' as const,
                balance: event.value.toString()
              };
            }

            return {
              ...position,
              type: 'MOVEMENT' as const,
              amount: event.value.toString(),
              fee: event.fee.toString()
            };
          })
        };

        const projection = projectDailyManagedCash({
          snapshot,
          startDate,
          endDate
        });

        return {
          accountId: projection.accountId,
          currency: projection.currency,
          source: 'managed',
          included: projection.included,
          revision: projection.revision,
          balances: projection.balances
        };
      }

      const dailyBalances: Map<string, Big> =
        legacyBalancesByAccount.get(account.id) ?? new Map<string, Big>();

      const balances = [...dailyBalances.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, value]) => ({ date, value }));

      return {
        accountId: account.id,
        currency: account.currency ?? baseCurrency,
        source: 'legacy',
        included: true,
        revision: null,
        balances: projectDailyCashBalances({
          balances,
          startDate,
          endDate
        })
      };
    });

    return {
      userId,
      startDate,
      endDate,
      accounts: result
    };
  }
}
