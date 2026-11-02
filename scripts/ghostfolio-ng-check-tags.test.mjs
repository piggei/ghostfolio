import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ghostfolio-ng-check-tags.sh');
const image = 'ghcr.io/piggei/ghostfolio-ng';
const tag = 'integration-test';

function runScenario(scenario, args = [image, tag]) {
  const directory = mkdtempSync(join(tmpdir(), 'ghostfolio-ng-tags-'));
  const temporaryDirectory = join(directory, 'tmp');
  mkdirSync(temporaryDirectory);

  const mock = join(directory, 'docker');
  const log = join(directory, 'docker.log');

  writeFileSync(
    mock,
    `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "$MOCK_DOCKER_LOG"

reference="\${@: -1}"

case "$MOCK_SCENARIO" in
  missing)
    echo "ERROR: $reference: not found" >&2
    exit 1
    ;;
  existing)
    exit 0
    ;;
  forbidden)
    echo "ERROR: authorization failed: 403 Forbidden" >&2
    exit 1
    ;;
  timeout)
    echo "ERROR: context deadline exceeded" >&2
    exit 1
    ;;
  server)
    echo "ERROR: registry returned 500 Internal Server Error" >&2
    exit 1
    ;;
  misleading)
    echo "ERROR: another/image:tag: not found" >&2
    exit 1
    ;;
  *)
    exit 99
    ;;
esac
`,
    { mode: 0o755 }
  );

  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      TMPDIR: temporaryDirectory,
      MOCK_SCENARIO: scenario,
      MOCK_DOCKER_LOG: log
    }
  });

  const commands = (() => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n');
    } catch {
      return [];
    }
  })();

  const temporaryEntries = readdirSync(temporaryDirectory);

  rmSync(directory, { recursive: true, force: true });

  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    commands,
    temporaryEntries
  };
}

test('accepts an explicitly missing tag', () => {
  const result = runScenario('missing');

  assert.equal(result.status, 0);
  assert.match(result.output, /Release tag available/);
  assert.equal(result.commands.length, 1);
});

test('rejects an existing tag', () => {
  const result = runScenario('existing');

  assert.equal(result.status, 1);
  assert.match(result.output, /Release tag already exists/);
});

for (const scenario of ['forbidden', 'timeout', 'server', 'misleading']) {
  test(`fails closed on ${scenario}`, () => {
    const result = runScenario(scenario);

    assert.equal(result.status, 1);
    assert.match(result.output, /Cannot establish tag availability/);
    assert.doesNotMatch(result.output, /Release tag available/);
  });
}

test('rejects an invalid image reference', () => {
  const result = runScenario('missing', [
    'docker.io/example/image',
    tag
  ]);

  assert.equal(result.status, 2);
  assert.match(result.output, /Invalid GHCR image reference/);
  assert.equal(result.commands.length, 0);
});

test('rejects an invalid tag', () => {
  const result = runScenario('missing', [
    image,
    '../invalid'
  ]);

  assert.equal(result.status, 2);
  assert.match(result.output, /Invalid image tag/);
  assert.equal(result.commands.length, 0);
});

test('rejects missing arguments', () => {
  const result = runScenario('missing', []);

  assert.equal(result.status, 2);
  assert.match(result.output, /Usage:/);
  assert.equal(result.commands.length, 0);
});

test('checks multiple missing tags', () => {
  const result = runScenario('missing', [
    image,
    'integration-test-a',
    'integration-test-b'
  ]);

  assert.equal(result.status, 0);
  assert.equal(result.commands.length, 2);
});

test('never accepts an unexpected Docker error', () => {
  const result = runScenario('unexpected');

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.output, /Release tag available/);
});


test('removes temporary registry diagnostics after success and failure', () => {
  for (const scenario of ['missing', 'forbidden']) {
    const result = runScenario(scenario);

    assert.deepEqual(
      result.temporaryEntries,
      [],
      `Temporary files remain after ${scenario}`
    );
  }
});
