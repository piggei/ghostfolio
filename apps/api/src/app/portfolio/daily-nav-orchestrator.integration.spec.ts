import { CashManagementService } from '@ghostfolio/api/app/account-balance/cash-management.service';
import { DailyCashClassificationReader } from '@ghostfolio/api/app/account-balance/daily-cash-classification-reader.service';
import { DailyCashPersistedReader } from '@ghostfolio/api/app/account-balance/daily-cash-persisted-reader.service';
import { ActivitiesService } from '@ghostfolio/api/services/activities/activities.service';
import { AssetProfileSplitService } from '@ghostfolio/api/services/asset-profile-split/asset-profile-split.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { SymbolProfileService } from '@ghostfolio/api/services/symbol-profile/symbol-profile.service';

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AssetClass, AssetSubClass, DataSource, Type } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { DailyNavOrchestratorService } from './daily-nav-orchestrator.service';

const databaseUrl = process.env.CASH_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const BASELINE_DATE = '2026-10-01';
const START_DATE = '2026-10-02';
const END_DATE = '2026-10-03';

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

describeDatabase('Daily NAV orchestrator (PostgreSQL)', () => {
  let prisma: PrismaService;
  let orchestrator: DailyNavOrchestratorService;
  let cashManagement: CashManagementService;

  const users: string[] = [];
  const symbols: string[] = [];
  const marketDataIds: string[] = [];

  beforeAll(async () => {
    const url = new URL(databaseUrl);

    if (
      url.protocol !== 'postgresql:' ||
      !url.pathname.startsWith('/cash_test_') ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '5433'
    ) {
      throw new Error(
        'CASH_TEST_DATABASE_URL must target a local disposable cash_test_ database on port 5433'
      );
    }

    prisma = new PrismaService(
      new ConfigService({
        DATABASE_URL: databaseUrl,
        LOG_LEVELS: '[]'
      })
    );

    await prisma.$connect();

    const result = await prisma.$queryRaw<{ database: string; port: number }[]>`
      SELECT
        current_database() AS database,
        inet_server_port() AS port
    `;

    if (
      result[0]?.database !== url.pathname.slice(1) ||
      Number(result[0]?.port) !== 5432
    ) {
      throw new Error('Unexpected PostgreSQL server or database');
    }

    const dataProviderService = {
      getDataSourceForExchangeRates: jest.fn().mockReturnValue(DataSource.YAHOO)
    } as unknown as DataProviderService;

    const marketDataService = new MarketDataService(prisma);
    const symbolProfileService = new SymbolProfileService(prisma);
    const assetProfileSplitService = new AssetProfileSplitService(prisma);
    const propertyService = new PropertyService(prisma);

    const exchangeRateDataService = new ExchangeRateDataService(
      dataProviderService,
      marketDataService,
      prisma,
      propertyService
    );

    const eventEmitter = new EventEmitter2();

    cashManagement = new CashManagementService(
      eventEmitter,
      prisma,
      exchangeRateDataService
    );

    const activitiesService = new ActivitiesService(
      null,
      null,
      assetProfileSplitService,
      null,
      null,
      dataProviderService,
      eventEmitter,
      exchangeRateDataService,
      marketDataService,
      prisma,
      symbolProfileService,
      null,
      cashManagement
    );

    const classificationReader = new DailyCashClassificationReader(prisma);
    const persistedCashReader = new DailyCashPersistedReader(prisma);

    orchestrator = new DailyNavOrchestratorService(
      activitiesService,
      classificationReader,
      dataProviderService,
      marketDataService,
      persistedCashReader,
      prisma
    );
  }, 30000);

  afterAll(async () => {
    if (prisma) {
      try {
        if (marketDataIds.length > 0) {
          await prisma.marketData.deleteMany({
            where: { id: { in: marketDataIds } }
          });
        }

        if (symbols.length > 0) {
          await prisma.marketData.deleteMany({
            where: {
              dataSource: DataSource.MANUAL,
              symbol: { in: symbols }
            }
          });
        }

        if (users.length > 0) {
          await prisma.cashEvent.deleteMany({
            where: { userId: { in: users } }
          });

          await prisma.user.deleteMany({
            where: { id: { in: users } }
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    }
  }, 30000);

  it('calculates NAV and PnL from persisted securities, cash and external flows', async () => {
    const userId = randomUUID();
    const symbol = `GF_PNL_${randomUUID()}`;

    users.push(userId);
    symbols.push(symbol);

    await prisma.user.create({
      data: { id: userId }
    });

    const account = await prisma.account.create({
      data: {
        userId,
        currency: 'EUR',
        name: 'Daily NAV integration test'
      }
    });

    // Opening cash represents the portfolio baseline.
    const opening = await cashManagement.open({
      userId,
      accountId: account.id,
      date: BASELINE_DATE,
      balance: '3000'
    });

    const profile = await prisma.symbolProfile.create({
      data: {
        userId,
        dataSource: DataSource.MANUAL,
        symbol,
        name: 'Daily NAV integration asset',
        currency: 'EUR',
        assetClass: AssetClass.EQUITY,
        assetSubClass: AssetSubClass.STOCK
      }
    });

    const order = await prisma.$transaction(async (transaction) => {
      const created = await transaction.order.create({
        data: {
          userId,
          accountId: account.id,
          accountUserId: userId,
          symbolProfileId: profile.id,
          date: new Date(`${START_DATE}T12:00:00.000Z`),
          type: Type.BUY,
          quantity: 10,
          unitPrice: 100,
          fee: 0,
          tax: 0,
          currency: 'EUR'
        },
        include: {
          SymbolProfile: {
            select: { currency: true }
          }
        }
      });

      await cashManagement.synchronizeOrder(transaction, created, {
        enabled: true
      });

      return created;
    });

    // The BUY must reduce managed cash by exactly EUR 1,000.
    const afterPurchase = await cashManagement.get({
      userId,
      accountId: account.id
    });

    expect(afterPurchase.revision).toBeGreaterThan(opening.revision);

    expect(
      afterPurchase.balances.find(({ date }) => date === START_DATE)?.value
    ).toBe('2000');

    // Persist historical closing prices.
    await prisma.marketData.createMany({
      data: [
        {
          dataSource: DataSource.MANUAL,
          symbol,
          date: day(START_DATE),
          marketPrice: 100,
          state: 'CLOSE'
        },
        {
          dataSource: DataSource.MANUAL,
          symbol,
          date: day(END_DATE),
          marketPrice: 110,
          state: 'CLOSE'
        }
      ]
    });

    // External capital is recorded through the public cash ledger API.
    await cashManagement.createEvent({
      userId,
      accountId: account.id,
      expectedRevision: afterPurchase.revision,
      event: {
        date: END_DATE,
        type: 'MOVEMENT',
        amount: '500',
        economicClassification: 'EXTERNAL_CAPITAL'
      }
    });

    // Confirm that the fixture is fully persisted before calculation.
    expect(
      await prisma.order.count({
        where: { userId, id: order.id }
      })
    ).toBe(1);

    expect(
      await prisma.marketData.count({
        where: {
          dataSource: DataSource.MANUAL,
          symbol
        }
      })
    ).toBe(2);

    const persistedEvents = await prisma.cashEvent.findMany({
      where: { userId, accountId: account.id },
      orderBy: [{ date: 'asc' }, { sequence: 'asc' }]
    });

    expect(persistedEvents).toHaveLength(2);
    expect(
      persistedEvents
        .find(({ orderId }) => orderId === order.id)
        ?.value.toString()
    ).toBe('-1000');

    expect(
      persistedEvents
        .find(
          ({ economicClassification }) =>
            economicClassification === 'EXTERNAL_CAPITAL'
        )
        ?.value.toString()
    ).toBe('500');

    const result = await orchestrator.calculateDailyPerformance({
      userId,
      startDate: START_DATE,
      endDate: END_DATE,
      baseCurrency: 'EUR'
    });

    expect(result.days).toHaveLength(2);

    expect(result.days[0]).toMatchObject({
      date: START_DATE,
      nav: {
        status: 'available',
        nav: '3000'
      },
      pnl: {
        status: 'available',
        dailyPnl: '0'
      }
    });

    expect(result.days[1]).toMatchObject({
      date: END_DATE,
      nav: {
        status: 'available',
        nav: '3600'
      },
      pnl: {
        status: 'available',
        dailyPnl: '100'
      }
    });
  }, 30000);

  it('calculates USD securities and cash using persisted historical FX', async () => {
    const userId = randomUUID();
    const symbol = `GF_PNL_USD_${randomUUID()}`;

    users.push(userId);
    symbols.push(symbol);

    await prisma.user.create({
      data: { id: userId }
    });

    const account = await prisma.account.create({
      data: {
        userId,
        currency: 'USD',
        name: 'Daily NAV USD integration test'
      }
    });

    // Baseline: USD 1,000 converted at 0.90 USD/EUR.
    await cashManagement.open({
      userId,
      accountId: account.id,
      date: BASELINE_DATE,
      balance: '1000'
    });

    const profile = await prisma.symbolProfile.create({
      data: {
        userId,
        dataSource: DataSource.MANUAL,
        symbol,
        name: 'Daily NAV USD integration asset',
        currency: 'USD',
        assetClass: AssetClass.EQUITY,
        assetSubClass: AssetSubClass.STOCK
      }
    });

    const order = await prisma.$transaction(async (transaction) => {
      const created = await transaction.order.create({
        data: {
          userId,
          accountId: account.id,
          accountUserId: userId,
          symbolProfileId: profile.id,
          date: new Date(`${START_DATE}T12:00:00.000Z`),
          type: Type.BUY,
          quantity: 10,
          unitPrice: 100,
          fee: 0,
          tax: 0,
          currency: 'USD'
        },
        include: {
          SymbolProfile: {
            select: { currency: true }
          }
        }
      });

      await cashManagement.synchronizeOrder(transaction, created, {
        enabled: true
      });

      return created;
    });

    const afterPurchase = await cashManagement.get({
      userId,
      accountId: account.id
    });

    expect(
      afterPurchase.balances.find(({ date }) => date === START_DATE)?.value
    ).toBe('0');

    // Securities closing prices, persisted independently from FX.
    await prisma.marketData.createMany({
      data: [
        {
          dataSource: DataSource.MANUAL,
          symbol,
          date: day(START_DATE),
          marketPrice: 100,
          state: 'CLOSE'
        },
        {
          dataSource: DataSource.MANUAL,
          symbol,
          date: day(END_DATE),
          marketPrice: 110,
          state: 'CLOSE'
        }
      ]
    });

    // Protect existing Yahoo FX records before inserting test quotes.
    const fxDates = [BASELINE_DATE, START_DATE, END_DATE];

    const existingFx = await prisma.marketData.findMany({
      where: {
        dataSource: DataSource.YAHOO,
        symbol: 'USDEUR',
        date: { in: fxDates.map(day) }
      },
      select: {
        id: true,
        date: true
      }
    });

    if (existingFx.length !== 0) {
      throw new Error(
        'USDEUR test dates are not available; existing market data was preserved'
      );
    }

    const fxQuotes = [
      { date: BASELINE_DATE, marketPrice: 0.9 },
      { date: START_DATE, marketPrice: 0.9 },
      { date: END_DATE, marketPrice: 0.95 }
    ];

    for (const quote of fxQuotes) {
      const created = await prisma.marketData.create({
        data: {
          dataSource: DataSource.YAHOO,
          symbol: 'USDEUR',
          date: day(quote.date),
          marketPrice: quote.marketPrice,
          state: 'CLOSE',
          isCarriedForward: false
        }
      });

      marketDataIds.push(created.id);
    }

    expect(
      await prisma.marketData.count({
        where: {
          dataSource: DataSource.YAHOO,
          symbol: 'USDEUR',
          date: { in: fxDates.map(day) }
        }
      })
    ).toBe(3);

    // Confirm the real order and its associated cash effect.
    expect(
      await prisma.order.count({
        where: { userId, id: order.id }
      })
    ).toBe(1);

    const persistedEvents = await prisma.cashEvent.findMany({
      where: { userId, accountId: account.id }
    });

    expect(persistedEvents).toHaveLength(1);
    expect(persistedEvents[0].value.toString()).toBe('-1000');

    const result = await orchestrator.calculateDailyPerformance({
      userId,
      startDate: START_DATE,
      endDate: END_DATE,
      baseCurrency: 'EUR'
    });

    expect(result.days).toHaveLength(2);

    expect(result.days[0]).toMatchObject({
      date: START_DATE,
      nav: {
        status: 'available',
        nav: '900'
      },
      pnl: {
        status: 'available',
        dailyPnl: '0'
      }
    });

    expect(result.days[1]).toMatchObject({
      date: END_DATE,
      nav: {
        status: 'available',
        nav: '1045'
      },
      pnl: {
        status: 'available',
        dailyPnl: '145'
      }
    });
  }, 30000);
});
