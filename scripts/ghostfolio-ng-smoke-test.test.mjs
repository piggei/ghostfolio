import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ghostfolio-ng-smoke-test.sh');

function runScenario(failure = '') {
  const root = mkdtempSync(join(tmpdir(), 'ghostfolio-ng-unit-'));
  const bin = join(root, 'bin');
  const temporary = join(root, 'temporary');
  const log = join(root, 'docker.log');

  mkdirSync(bin);
  mkdirSync(temporary);

  const mock = `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "$MOCK_DOCKER_LOG"

case " $* " in
  *" config --format json "*)
    printf '{"services":{"ghostfolio":{"image":"ghostfolio-ng:test"},"postgres":{},"redis":{}}}\\n'
    ;;
esac

case " $* " in
  *" pull postgres redis "*) operation=pull ;;
  *" up -d "*) operation=up ;;
  *" exec -T ghostfolio "*) operation=health ;;
  *" down --volumes "*) operation=down ;;
  *) operation=other ;;
esac

if [[ "$operation" == "$MOCK_FAILURE" ]]; then
  exit 42
fi

exit 0
`;

  writeFileSync(join(bin, 'docker'), mock, { mode: 0o755 });

  const result = spawnSync(
    'bash',
    [script, 'ghostfolio-ng:test'],
    {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: temporary,
        MOCK_DOCKER_LOG: log,
        MOCK_FAILURE: failure
      }
    }
  );

  const commands = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n')
    : [];

  const directories = readdirSync(temporary).map((name) =>
    join(temporary, name)
  );

  const credentialsRemain = directories.some((directory) =>
    existsSync(join(directory, '.env'))
  );

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  rmSync(root, { recursive: true, force: true });

  return {
    status: result.status,
    signal: result.signal,
    commands,
    directories,
    credentialsRemain,
    output
  };
}

function hasCommand(commands, fragment) {
  return commands.some((command) => command.includes(fragment));
}

test('rejects an image without a tag', () => {
  const result = spawnSync('bash', [script, 'invalid-image'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
});

for (const failure of ['pull', 'up', 'health']) {
  test(`preserves failure and cleans up after ${failure} error`, () => {
    const result = runScenario(failure);

    assert.equal(result.status, 42);
    assert.equal(result.credentialsRemain, false);
    assert.ok(hasCommand(result.commands, 'down --volumes'));
    assert.ok(!result.output.includes('smoke test: PASS'));
  });
}

test('reports cleanup failure without declaring success', () => {
  const result = runScenario('down');

  assert.notEqual(result.status, 0);
  assert.equal(result.credentialsRemain, false);
  assert.ok(hasCommand(result.commands, 'down --volumes'));
  assert.ok(!result.output.includes('smoke test: PASS'));
});

test('reports success only after successful cleanup', () => {
  const result = runScenario();

  assert.equal(result.status, 0);
  assert.equal(result.credentialsRemain, false);
  assert.equal(result.directories.length, 0);
  assert.ok(hasCommand(result.commands, 'pull postgres redis'));
  assert.ok(hasCommand(result.commands, 'up -d --pull never'));
  assert.ok(hasCommand(result.commands, 'exec -T ghostfolio'));
  assert.ok(hasCommand(result.commands, 'down --volumes'));
  assert.ok(result.output.includes('smoke test: PASS'));
});
