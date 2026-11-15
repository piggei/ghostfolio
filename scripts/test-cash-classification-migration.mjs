import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';

// Requires an EMPTY disposable database. Never reset or clear a shared schema.
const url = new URL(process.env.CASH_TEST_DATABASE_URL ?? '');
assert.match(url.pathname, /^\/cash_test_/);
const root = process.cwd();
const migration = '20261111000000_manual_cash_movement_classification';
const temporary = mkdtempSync(join(tmpdir(), 'pnl-b1-migration-'));
const client = new pg.Client({ connectionString: url.toString() });

function deploy(config) {
  const result = spawnSync(
    process.execPath,
    [
      resolve('node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--config',
      config
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        DIRECT_URL: url.toString()
      }
    }
  );
  assert.equal(result.status, 0, 'Migration deploy failed');
}

try {
  await client.connect();
  assert.equal(
    (
      await client.query(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
      )
    ).rows[0].count,
    '0',
    'Database must be empty'
  );
  for (const entry of readdirSync('prisma/migrations')) {
    if (entry !== migration)
      cpSync(
        join('prisma/migrations', entry),
        join(temporary, 'migrations', entry),
        { recursive: true }
      );
  }
  const config = join(temporary, 'prisma.config.mjs');
  writeFileSync(
    config,
    `export default ${JSON.stringify({ datasource: { url: url.toString() }, schema: join(root, 'prisma/schema.prisma'), migrations: { path: join(temporary, 'migrations') } })};`
  );
  deploy(config);
  const user = randomUUID();
  const account = randomUUID();
  await client.query('INSERT INTO "User" (id,"updatedAt") VALUES ($1,NOW())', [
    user
  ]);
  await client.query(
    'INSERT INTO "Account" (id,"userId",currency,"updatedAt") VALUES ($1,$2,\'EUR\',NOW())',
    [account, user]
  );
  await client.query(
    'INSERT INTO "AccountCashState" ("accountId","userId",currency,"openingDate","openingBalance","updatedAt") VALUES ($1,$2,\'EUR\',\'2026-10-01\',1000,NOW())',
    [account, user]
  );
  for (const [index, type, value, fee] of [
    [1, 'MOVEMENT', '500.00000000000000000001', '2'],
    [2, 'MOVEMENT', '-100', '0'],
    [3, 'CHECKPOINT', '1200', '0']
  ]) {
    await client.query(
      'INSERT INTO "CashEvent" (id,"accountId","userId",date,sequence,type,value,fee,"updatedAt") VALUES ($1,$2,$3,\'2026-10-02\',$4,$5,$6,$7,NOW())',
      [randomUUID(), account, user, index, type, value, fee]
    );
  }
  const before = (
    await client.query('SELECT * FROM "CashEvent" ORDER BY sequence')
  ).rows;
  deploy(resolve('.config/prisma.ts'));
  const after = (
    await client.query('SELECT * FROM "CashEvent" ORDER BY sequence')
  ).rows;
  assert.deepEqual(
    after.map(({ economicClassification, ...event }) => {
      assert.equal(economicClassification, null);
      return event;
    }),
    before
  );
  const column = (
    await client.query(
      "SELECT column_default,is_nullable FROM information_schema.columns WHERE table_name='CashEvent' AND column_name='economicClassification'"
    )
  ).rows[0];
  assert.deepEqual(column, { column_default: null, is_nullable: 'YES' });
  for (const category of ['EXTERNAL_CAPITAL', 'INCOME', 'EXPENSE']) {
    await client.query(
      'UPDATE "CashEvent" SET "economicClassification"=$1 WHERE id=$2',
      [category, before[0].id]
    );
  }
  const invalid = [
    ['type', 'CHECKPOINT'],
    ['orderId', randomUUID()],
    ['transferId', randomUUID()],
    ['transferCounterpartyAccountId', randomUUID()],
    ['transferCounterpartyMode', 'LEGACY'],
    ['transferCounterpartyAmount', '10'],
    ['transferCounterpartyCurrency', 'EUR']
  ];
  for (const [field, value] of invalid) {
    await assert.rejects(
      client.query(`UPDATE "CashEvent" SET "${field}"=$1, fee=0 WHERE id=$2`, [
        value,
        before[0].id
      ]),
      (error) =>
        error.code === '23514' &&
        error.constraint === 'CashEvent_economicClassification_check'
    );
  }
  await assert.rejects(
    client.query(
      'UPDATE "CashEvent" SET "economicClassification"=\'UNKNOWN\' WHERE id=$1',
      [before[0].id]
    ),
    (error) => error.code === '22P02'
  );
  assert.equal(
    (await client.query('SELECT count(*) FROM "CashEvent"')).rows[0].count,
    '3'
  );
  console.log(
    'PASS: baseline upgrade, exact historical row preservation, nullable/no default, all categories, 7 eligibility constraints and invalid enum rejection.'
  );
} finally {
  await client.end();
  rmSync(temporary, { recursive: true, force: true });
}
