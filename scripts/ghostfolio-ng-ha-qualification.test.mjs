// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const yaml = readFileSync(
  '.github/workflows/ghostfolio-ng-ha-qualification.yml',
  'utf8'
);
const toolingDir = process.env.QUALIFICATION_TOOLS_DIR;

assert.ok(
  toolingDir,
  'QUALIFICATION_TOOLS_DIR must point to the immutable H tooling checkout'
);

const digest = (path) =>
  createHash('sha256')
    .update(readFileSync(resolve(toolingDir, path)))
    .digest('hex');

test('harness is branch-isolated, read-only and cannot dispatch a release', () => {
  assert.match(
    yaml,
    /branches: \[test\/ghostfolio-ng-ha-orchestrator-controller-d-ci\]/
  );
  assert.match(yaml, /permissions:\n  contents: read/);
  assert.equal((yaml.match(/permissions:/g) ?? []).length, 1);
  assert.match(yaml, /runs-on: ubuntu-24.04\n    timeout-minutes: 15/);
  for (const forbidden of [
    'workflow_run:',
    'workflow_dispatch:',
    'secrets:',
    ': write',
    'home-assistant-addon.yml@',
    'docker ',
    'gh ',
    'curl ',
    'wget ',
    'npm ',
    'npx ',
    'git push',
    'git tag',
    'git commit',
    'github.event',
    'github.sha',
    'node scripts/ghostfolio-ng-ha-orchestrator.mjs',
    'home-assistant-addon-workflow.mjs'
  ]) {
    assert.ok(!yaml.includes(forbidden), forbidden);
  }
  assert.ok(!/\bnode\s+scripts\//.test(yaml));
});

test('Q/D/H are literal immutable subjects and workflow-revision data is independently hash-bound', () => {
  const actions = [...yaml.matchAll(/uses: (.+)/g)].map((m) => m[1]);
  assert.deepEqual(
    actions,
    Array(4).fill('actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683')
  );
  assert.deepEqual(
    [...yaml.matchAll(/          ref: (.+)/g)].map((m) => m[1]),
    [
      '9c7823d1a47087aa82be6b6877efafd08d84814c',
      'a695d99ca3593a02c95c78f096b3ebb930fb13e8',
      '7788e4eaa028d1d748cf29870f4eebd1d646d402',
      '${{ github.workflow_sha }}'
    ]
  );
  assert.equal((yaml.match(/persist-credentials: false/g) ?? []).length, 4);
  assert.match(yaml, /EXPECTED_WORKFLOW_SHA: \$\{\{ github.workflow_sha \}\}/);
  assert.match(
    yaml,
    /test "\$\(git -C qualification-harness rev-parse HEAD\)" = "\$EXPECTED_WORKFLOW_SHA"/
  );
  const bootstrap = yaml
    .split('      - name: Verify independent hash pins')[1]
    .split('      - name: Orchestrator tests')[0];
  for (const [source, checked] of [
    [
      'ci-tooling/payload.tar.xz',
      'qualification-tools/ci-tooling/payload.tar.xz'
    ],
    [
      'ci-tooling/inventory.json',
      'qualification-tools/ci-tooling/inventory.json'
    ]
  ]) {
    assert.ok(bootstrap.includes(`'${digest(source)}' '${checked}'`));
  }

  const securityHash = createHash('sha256')
    .update(readFileSync('scripts/ghostfolio-ng-ha-qualification.test.mjs'))
    .digest('hex');

  assert.ok(
    bootstrap.includes(
      `'${securityHash}' 'qualification-harness/scripts/ghostfolio-ng-ha-qualification.test.mjs'`
    )
  );
  const hashCheck = bootstrap.indexOf('sha256sum --check --strict');
  const extraction = bootstrap.indexOf('tar -xJf');
  const firstCode = bootstrap.indexOf('"$bundle/bin/node"');
  assert.ok(hashCheck > 0 && extraction > hashCheck && firstCode > extraction);
  assert.match(bootstrap, /git -C qualification-tools rev-parse HEAD/);
  assert.match(bootstrap, /wrappers\/verify-inventory.mjs/);
  assert.ok(!bootstrap.includes('verify-and-extract.sh'));
});

test('all 344 tests and offline static checks are mandatory before clean-state success', () => {
  for (const count of [110, 231, 3]) {
    assert.ok(yaml.includes(`# tests ${count}`));
    assert.ok(yaml.includes(`# pass ${count}`));
  }
  for (const kind of ['fail', 'skipped', 'cancelled', 'todo']) {
    assert.equal((yaml.match(new RegExp(`# ${kind} 0`, 'g')) ?? []).length, 3);
  }
  assert.equal((yaml.match(/set -euo pipefail/g) ?? []).length, 5);
  for (const path of [
    'bin/actionlint',
    'wrappers/yaml-unique.mjs',
    'wrappers/prettier-check.mjs'
  ])
    assert.ok(yaml.includes(path));
  assert.match(yaml, /git -C ha-contract status --porcelain/);
  assert.match(yaml, /git -C qualification-harness status --porcelain/);
  assert.ok(!yaml.includes('BLOCKED'));
  assert.ok(!yaml.includes('continue-on-error'));
  assert.ok(!yaml.includes('always()'));
  assert.ok(!/\|\|\s*true/.test(yaml));
});
