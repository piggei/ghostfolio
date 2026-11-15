import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import type {
  CashCsvPreview,
  CashMovementClassification
} from '@ghostfolio/common/interfaces';

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';

import { readCashCsv, writeCashCsv } from './cash-ledger-csv';
import type { CashCsvRow } from './cash-ledger-csv';
import { CashManagementService } from './cash-management.service';

const databaseUrl = process.env.CASH_TEST_DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb('Cash classification CSV compatibility (PostgreSQL)', () => {
  let prisma: PrismaService;
  let cash: CashManagementService;
  let userId: string;
  let accountId: string;
  const users: string[] = [];
  const scope = () => ({ userId, accountId });
  const csv = (rows: Partial<CashCsvRow>[]) =>
    writeCashCsv(
      rows.map((row) => ({
        Version: '2',
        Record: 'EVENT',
        Date: '2026-10-02',
        Operation: 'DEPOSIT',
        Amount: '500',
        Fee: '2',
        Currency: 'EUR',
        Note: 'memo',
        ...row
      }))
    );
  async function create(
    economicClassification: CashMovementClassification | null = 'INCOME'
  ) {
    return cash.createEvent({
      ...scope(),
      expectedRevision: 0,
      event: {
        type: 'MOVEMENT',
        date: '2026-10-02',
        amount: '500',
        fee: '2',
        comment: 'memo',
        economicClassification
      }
    });
  }
  async function commit(
    content: string,
    target = scope(),
    preview?: CashCsvPreview
  ) {
    const plan = preview ?? (await cash.previewCsv(target, content));
    return cash.importCsv(target, {
      csv: content,
      expectedRevision: plan.revision,
      digest: plan.digest
    });
  }
  beforeAll(async () => {
    if (!new URL(databaseUrl).pathname.startsWith('/cash_test_'))
      throw new Error('Disposable database required');
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl, LOG_LEVELS: '[]' })
    );
    await prisma.$connect();
    cash = new CashManagementService(new EventEmitter2(), prisma);
  });
  beforeEach(async () => {
    userId = randomUUID();
    users.push(userId);
    await prisma.user.create({ data: { id: userId } });
    accountId = (
      await prisma.account.create({ data: { userId, currency: 'EUR' } })
    ).id;
    await cash.open({ ...scope(), date: '2026-10-01', balance: '1000' });
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.cashEvent.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
  });

  it('round-trips v2 all categories, null, signs, fees and civil dates without amount changes', async () => {
    const categories: (CashMovementClassification | null)[] = [
      'EXTERNAL_CAPITAL',
      'INCOME',
      'EXPENSE',
      null
    ];
    const amounts = ['100', '20', '-10', '5'];
    let revision = 0;
    for (const [index, economicClassification] of categories.entries()) {
      const result = await cash.createEvent({
        ...scope(),
        expectedRevision: revision,
        event: {
          type: 'MOVEMENT',
          date: `2026-10-${24 + index}`,
          amount: amounts[index],
          fee: index === 0 ? '2' : index === 1 ? '1' : '0',
          economicClassification
        }
      });
      revision = result.revision;
    }
    const original = await cash.getPersisted(scope());
    const exported = (await cash.exportCsv(scope())).csv;
    const rows = readCashCsv(exported);
    expect(rows.every((row) => row.Version === '2')).toBe(true);
    const targetId = (
      await prisma.account.create({ data: { userId, currency: 'EUR' } })
    ).id;
    const target = { userId, accountId: targetId };
    const preview = await cash.previewCsv(target, exported);
    expect(preview.errors).toEqual([]);
    expect(preview.rows.map((row) => row.economicClassification)).toEqual(
      categories
    );
    const restored = await commit(exported, target, preview);
    const financial = (snapshot: typeof original) =>
      snapshot.events.map((event) => ({
        type: event.type,
        date: event.date,
        sequence: event.sequence,
        amount: event.type === 'MOVEMENT' ? event.amount : event.balance,
        fee: event.fee ?? '0',
        economicClassification: event.economicClassification
      }));
    expect(financial(restored)).toEqual(financial(original));
    expect(restored.balances).toEqual(original.balances);
    expect(restored.balances.at(-1).value).toBe('1112');
    expect(
      (await cash.getPersisted(target)).events.map(
        (event) => event.economicClassification
      )
    ).toEqual(categories);
    const beforeRetry = restored.revision;
    expect((await commit(exported, target)).revision).toBe(beforeRetry);
    expect(await prisma.cashEvent.count({ where: target })).toBe(4);
  });

  it.each([
    'Version,Date,Operation,Amount,Fee,Currency\n1,2026-10-02,DEPOSIT,100,2,EUR',
    'Data;Operazione;Importo;Commissione;Valuta\n2026-10-02;Prelievo;100;2;EUR'
  ])(
    'imports old/manual CSV without classifying the principal',
    async (content) => {
      const result = await commit(content);
      expect(result.events[0].economicClassification).toBeNull();
      expect(result.balances.at(-1).value).toBe(
        content.includes('Prelievo') ? '898' : '1098'
      );
    }
  );

  it.each(['legacy', 'blank-v2', 'matching-v2'])(
    'retains category on idempotent %s retry without changing revision',
    async (mode) => {
      const original = await create();
      const content = csv([
        {
          Version: mode === 'legacy' ? '1' : '2',
          Reference: `ledger:${original.events[0].id}`,
          EconomicClassification: mode === 'matching-v2' ? 'INCOME' : ''
        }
      ]);
      const preview = await cash.previewCsv(scope(), content);
      expect(preview.errors).toEqual([]);
      expect(preview.rows[0]).toMatchObject({
        status: 'EXISTING',
        economicClassification: 'INCOME'
      });
      const retried = await commit(content, scope(), preview);
      expect(retried.revision).toBe(original.revision);
      expect(retried.events[0].economicClassification).toBe('INCOME');
      expect(await prisma.cashEvent.count({ where: scope() })).toBe(1);
    }
  );

  it.each(['INCOME', null] as const)(
    'rejects an explicit category conflicting with existing %s without reclassification',
    async (originalCategory) => {
      const original = await create(originalCategory);
      const content = csv([
        {
          Reference: `ledger:${original.events[0].id}`,
          EconomicClassification: 'EXPENSE'
        }
      ]);
      const preview = await cash.previewCsv(scope(), content);
      expect(preview.errors.join()).toContain('classification conflicts');
      await expect(commit(content, scope(), preview)).rejects.toThrow();
      expect((await cash.get(scope())).events[0].economicClassification).toBe(
        originalCategory
      );
      expect((await cash.get(scope())).revision).toBe(original.revision);
      expect(await prisma.cashEvent.count({ where: scope() })).toBe(1);
    }
  );

  it('does not turn category differences into a second movement without a reference', async () => {
    await create();
    const content = csv([{ EconomicClassification: 'EXPENSE' }]);
    const preview = await cash.previewCsv(scope(), content);
    expect(preview.errors.join()).toContain('duplicate');
    await expect(commit(content, scope(), preview)).rejects.toThrow();
    expect(await prisma.cashEvent.count({ where: scope() })).toBe(1);
  });

  it('invalidates preview after classification-only editing', async () => {
    const original = await create(null);
    const content = csv([
      {
        Reference: 'new-row',
        Date: '2026-10-03',
        Amount: '10',
        Fee: '0',
        EconomicClassification: 'INCOME'
      }
    ]);
    const preview = await cash.previewCsv(scope(), content);
    await cash.updateEvent({
      ...scope(),
      eventId: original.events[0].id,
      expectedRevision: original.revision,
      event: {
        type: 'MOVEMENT',
        date: '2026-10-02',
        amount: '500',
        fee: '2',
        comment: 'memo',
        economicClassification: 'INCOME'
      }
    });
    await expect(commit(content, scope(), preview)).rejects.toThrow('changed');
    expect(await prisma.cashEvent.count({ where: scope() })).toBe(1);
  });

  it('rejects an entire batch when a later row conflicts, without saving its valid prefix', async () => {
    const original = await create();
    const content = csv([
      {
        Reference: 'new-row',
        Date: '2026-10-03',
        Amount: '10',
        Fee: '0',
        EconomicClassification: 'EXTERNAL_CAPITAL'
      },
      {
        Reference: `ledger:${original.events[0].id}`,
        EconomicClassification: 'EXPENSE'
      }
    ]);
    const preview = await cash.previewCsv(scope(), content);
    expect(preview.newCount).toBe(1);
    expect(preview.errors.length).toBeGreaterThan(0);
    await expect(commit(content, scope(), preview)).rejects.toThrow();
    const current = await cash.get(scope());
    expect(current.balances).toEqual(original.balances);
    expect(current.revision).toBe(original.revision);
    expect(current.events).toHaveLength(1);
  });

  it('round-trips a fee-only zero principal with CSV v2', async () => {
    const original = await cash.createEvent({
      ...scope(),
      expectedRevision: 0,
      event: {
        type: 'MOVEMENT',
        date: '2026-10-02',
        amount: '0',
        fee: '2',
        economicClassification: 'EXPENSE'
      }
    });
    const content = (await cash.exportCsv(scope())).csv;
    const target = {
      userId,
      accountId: (
        await prisma.account.create({ data: { userId, currency: 'EUR' } })
      ).id
    };
    const result = await commit(content, target);
    expect(result.balances).toEqual(original.balances);
    expect(result.events[0].economicClassification).toBe('EXPENSE');
  });
});
