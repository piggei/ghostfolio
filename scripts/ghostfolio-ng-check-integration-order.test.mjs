import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ghostfolio-ng-check-integration-order.sh');
const currentTag = 'integration-3.94.0-105';
const currentRunId = '9001';

function runScenario({
  tags = [],
  queuedRuns = [],
  inProgressRuns = [],
  apiFailure = '',
  tag = currentTag,
  runId = currentRunId
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ghostfolio-ng-order-'));
  const mock = join(directory, 'gh');
  const log = join(directory, 'gh.log');

  writeFileSync(
    mock,
    `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "$MOCK_GH_LOG"

case "$*" in
  *"releases?per_page="*)
    if [[ "$MOCK_API_FAILURE" == "releases" ]]; then
      echo "HTTP 500: simulated releases API failure" >&2
      exit 1
    fi
    printf '%s\\n' "$MOCK_RELEASE_TAGS"
    ;;
  *"status=queued"*)
    if [[ "$MOCK_API_FAILURE" == "queued" ]]; then
      echo "HTTP 500: simulated queued runs API failure" >&2
      exit 1
    fi
    printf '%s\\n' "$MOCK_QUEUED_RUNS"
    ;;
  *"status=in_progress"*)
    if [[ "$MOCK_API_FAILURE" == "in_progress" ]]; then
      echo "HTTP 500: simulated in-progress runs API failure" >&2
      exit 1
    fi
    printf '%s\\n' "$MOCK_IN_PROGRESS_RUNS"
    ;;
  *)
    echo "Unexpected GitHub API request: $*" >&2
    exit 99
    ;;
esac
`,
    { mode: 0o755 }
  );

  const result = spawnSync('bash', [script, 'piggei/ghostfolio', tag, runId], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      MOCK_GH_LOG: log,
      MOCK_API_FAILURE: apiFailure,
      MOCK_RELEASE_TAGS: tags.join('\n'),
      MOCK_QUEUED_RUNS: queuedRuns.join('\n'),
      MOCK_IN_PROGRESS_RUNS: inProgressRuns.join('\n')
    }
  });

  let commands = [];

  try {
    commands = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    // Invalid arguments must not invoke GitHub CLI.
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  rmSync(directory, { recursive: true, force: true });

  return {
    status: result.status,
    output,
    commands
  };
}

test('allows the first integration release', () => {
  const result = runScenario();

  assert.equal(result.status, 0);
  assert.match(result.output, /ordering verified/);
  assert.equal(result.commands.length, 3);
});

test('queries all published releases regardless of prerelease status', () => {
  const result = runScenario();

  assert.equal(result.status, 0);

  const releaseQuery = result.commands.find((command) =>
    command.includes('releases?per_page=')
  );

  assert.ok(releaseQuery, 'Expected GitHub releases API request');
  assert.match(releaseQuery, /\.draft == false/);
  assert.doesNotMatch(releaseQuery, /\.prerelease/);
});

test('allows a release newer than all published releases', () => {
  const result = runScenario({
    tags: ['integration-3.93.0-90', 'integration-3.94.0-104']
  });

  assert.equal(result.status, 0);
});

test('allows recovery of the same published release', () => {
  const result = runScenario({
    tags: ['integration-3.94.0-105']
  });

  assert.equal(result.status, 0);
});

test('recognizes legacy attempt-suffixed release tags', () => {
  const result = runScenario({
    tags: ['integration-3.94.0-105.2']
  });

  assert.equal(result.status, 0);
});

test('skips integration update when a newer release exists', () => {
  const result = runScenario({
    tags: ['integration-3.94.0-106']
  });

  assert.equal(result.status, 10);
  assert.match(result.output, /Integration channel update skipped/);
});

test('skips update when a newer legacy release exists', () => {
  const result = runScenario({
    tags: ['integration-3.94.0-106.3']
  });

  assert.equal(result.status, 10);
});

test('fails closed when GitHub releases API is unavailable', () => {
  const result = runScenario({
    apiFailure: 'releases'
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /Cannot retrieve published GitHub releases/);
});

test('rejects conflicting tags with the same run number', () => {
  const result = runScenario({
    tags: ['integration-3.95.0-105']
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /Conflicting release tags/);
});

test('rejects an invalid current release tag before API access', () => {
  const result = runScenario({
    tag: 'integration-invalid'
  });

  assert.equal(result.status, 2);
  assert.match(result.output, /Invalid integration release tag/);
  assert.equal(result.commands.length, 0);
});

test('skips update when a newer workflow run is queued', () => {
  const result = runScenario({
    queuedRuns: [`9002\t106`]
  });

  assert.equal(result.status, 10);
  assert.match(result.output, /newer workflow run is queued/);
});

test('skips update when a newer workflow run is in progress', () => {
  const result = runScenario({
    inProgressRuns: [`9003\t107`]
  });

  assert.equal(result.status, 10);
  assert.match(result.output, /newer workflow run is in_progress/);
});

test('does not block on the current workflow run', () => {
  const result = runScenario({
    queuedRuns: [`${currentRunId}\t105`],
    inProgressRuns: [`${currentRunId}\t105`]
  });

  assert.equal(result.status, 0);
});

test('does not block on older active workflow runs', () => {
  const result = runScenario({
    queuedRuns: ['8999\t104'],
    inProgressRuns: ['8998\t103']
  });

  assert.equal(result.status, 0);
});

test('fails closed when active workflow runs API is unavailable', () => {
  const result = runScenario({
    apiFailure: 'queued'
  });

  assert.equal(result.status, 1);
  assert.match(
    result.output,
    /Cannot retrieve workflow runs with status queued/
  );
});

test('rejects an invalid workflow run ID before API access', () => {
  const result = runScenario({
    runId: 'invalid'
  });

  assert.equal(result.status, 2);
  assert.match(result.output, /Invalid current workflow run ID/);
  assert.equal(result.commands.length, 0);
});
