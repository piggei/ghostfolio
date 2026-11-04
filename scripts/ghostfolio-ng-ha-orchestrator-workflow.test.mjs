import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  HA_REVISION,
  HA_WORKFLOW,
  NG_WORKFLOW_NAME,
  REPOSITORY
} from './ghostfolio-ng-ha-orchestrator.mjs';

const yaml = readFileSync(
  '.github/workflows/ghostfolio-ng-ha-orchestrator.yml',
  'utf8'
);
const source = readFileSync(
  'scripts/ghostfolio-ng-ha-orchestrator.mjs',
  'utf8'
);
const pinned = readFileSync(
  resolve(process.env.HA_CONTRACT_DIR ?? 'ha-contract', HA_WORKFLOW),
  'utf8'
);
const resolveJob = yaml.split('  resolve:\n')[1].split('\n  release-ha:')[0];
const releaseJob = yaml.split('  release-ha:\n')[1];
const inputs = [
  'integration_tag',
  'source_commit',
  'source_image',
  'ghostfolio_version',
  'addon_source_revision'
];

test('workflow_run listens only to completed integration releases and provides HA-only recovery', () => {
  assert.ok(yaml.includes(`workflows: [${NG_WORKFLOW_NAME}]`));
  assert.match(yaml, /types: \[completed\]/);
  assert.match(yaml, /branches: \[integration\/ghostfolio-all-pr\]/);
  assert.match(yaml, /workflow_dispatch:\n    inputs:\n      ng_run_id:/);
  assert.ok(!/^  push:/m.test(yaml));
  assert.ok(!/^  pull_request/m.test(yaml));
  assert.match(resolveJob, /github.ref == 'refs\/heads\/main'/);
  assert.match(resolveJob, /github.event.workflow_run.conclusion == 'success'/);
});

test('reusable workflow reference and validator checkout are fixed to the approved HA revision', () => {
  assert.equal(HA_REVISION, 'bfaf9ff86325d3d6fb25c37785e854cc583077df');
  assert.ok(!yaml.includes('4d642df014071b5c72eb731409aef47507cad641'));
  assert.ok(
    releaseJob.includes(`uses: ${REPOSITORY}/${HA_WORKFLOW}@${HA_REVISION}`)
  );
  assert.ok(resolveJob.includes(`ref: ${HA_REVISION}`));
  assert.ok(!releaseJob.includes('uses: ${{'));
  assert.ok(!releaseJob.includes('runs-on:'));
  assert.ok(!releaseJob.includes('steps:'));
  assert.ok(!releaseJob.includes('secrets: inherit'));
  assert.match(pinned, /workflow_call:/);
});

test('five required HA inputs are propagated from validated job outputs with matching names and types', () => {
  const contract = pinned
    .split('  workflow_call:\n')[1]
    .split('    outputs:')[0];
  for (const input of inputs) {
    assert.match(
      contract,
      new RegExp(
        `      ${input}:\\n        description: [^\\n]+\\n        required: true\\n        type: string`
      )
    );
    assert.ok(
      resolveJob.includes(
        input + ': ${{ steps.resolve.outputs.' + input + ' }}'
      )
    );
    assert.ok(
      releaseJob.includes(
        input + ': ${{ needs.resolve.outputs.' + input + ' }}'
      )
    );
  }
  for (const output of [
    'addon_version',
    'amd64_digest',
    'aarch64_digest',
    'metadata_commit',
    'publication_status'
  ]) {
    assert.ok(
      pinned.includes('value: ${{ jobs.publish.outputs.' + output + ' }}')
    );
  }
});

test('publication requires both successful resolution and explicit should_publish approval', () => {
  assert.match(releaseJob, /needs: resolve/);
  assert.match(
    releaseJob,
    /if: needs.resolve.result == 'success' && needs.resolve.outputs.should_publish == 'true'/
  );
  assert.ok(!yaml.includes('continue-on-error'));
  assert.ok(!yaml.includes('always()'));
});

test('validator permissions are read-only and only the reusable publication job receives writes', () => {
  const top = yaml.split('\njobs:')[0];
  assert.match(top, /permissions:\n  contents: read/);
  assert.match(
    resolveJob,
    /contents: read\n      actions: read\n      packages: read/
  );
  assert.ok(!resolveJob.includes(': write'));
  assert.match(
    releaseJob,
    /contents: write\n      actions: read\n      packages: write/
  );
  assert.ok(!yaml.includes('write-all'));
  assert.ok(!yaml.includes('id-token:'));
  assert.ok(!yaml.includes('pull-requests:'));
});

test('parent concurrency is distinct from the immutable HA child and does not cancel publication', () => {
  assert.match(
    yaml,
    /group: ghostfolio-ng-ha-orchestrator\n  cancel-in-progress: false/
  );
  assert.match(
    pinned,
    /group: ghostfolio-home-assistant-release\n  cancel-in-progress: false/
  );
  assert.ok(!yaml.includes('group: ghostfolio-home-assistant-release'));
  assert.ok(!yaml.includes('cancel-in-progress: true'));
  assert.ok(!yaml.includes('group: ${{ github.workflow'));
});

test('no checkout or command is derived from triggering code, and credentials are not persisted', () => {
  const refs = [...yaml.matchAll(/^          ref: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(refs, ['${{ github.sha }}', HA_REVISION]);
  assert.equal((yaml.match(/persist-credentials: false/g) ?? []).length, 2);
  const commands = [...yaml.matchAll(/^        run: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(commands, [
    'node scripts/ghostfolio-ng-ha-orchestrator.mjs'
  ]);
  assert.ok(!yaml.includes('download-artifact'));
  assert.ok(!yaml.includes('cache:'));
  assert.ok(!yaml.includes('github.event.workflow_run.head_sha }}'));
  assert.ok(!source.includes('node:child_process'));
  assert.ok(
    !/\b(?:execFile(?:Sync)?|execSync|spawn(?:Sync)?|eval|Function)\s*\(/.test(
      source
    )
  );
  assert.ok(!source.includes('writeFileSync'));
});

test('only previously approved actions and GITHUB_TOKEN are used', () => {
  const actions = [...yaml.matchAll(/uses: ([^\n]+)/g)].map((m) => m[1]);
  assert.deepEqual(actions, [
    'actions/checkout@v4',
    'actions/checkout@v4',
    'actions/setup-node@v4',
    `${REPOSITORY}/${HA_WORKFLOW}@${HA_REVISION}`
  ]);
  assert.deepEqual(
    [...yaml.matchAll(/secrets\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]),
    ['GITHUB_TOKEN']
  );
  assert.ok(!yaml.includes('docker/login-action'));
  assert.ok(!yaml.includes('build-push-action'));
  assert.ok(!yaml.includes('workflow_dispatch: integration-release'));
});
