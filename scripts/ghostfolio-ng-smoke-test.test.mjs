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

function runScenario(failure = '', distributive = false, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ghostfolio-ng-unit-'));
  const bin = join(root, 'bin');
  const temporary = join(root, 'temporary');
  const log = join(root, 'docker.log');
  const composeTemplate = join(root, 'release-compose.yml');

  const sourceImage = 'ghcr.io/piggei/ghostfolio-ng:integration-test';
  const expectedImage = distributive
    ? 'ghcr.io/piggei/ghostfolio-ng:candidate-test'
    : 'ghostfolio-ng:test';

  mkdirSync(bin);
  mkdirSync(temporary);

  if (distributive) {
    writeFileSync(
      composeTemplate,
      [
        'services:',
        '  ghostfolio:',
        `    image: ${sourceImage}`,
        '    ports:',
        '      - 3333:3333',
        '  postgres:',
        '    image: postgres:15-alpine',
        '    volumes:',
        '      - postgres:/var/lib/postgresql/data',
        '  redis:',
        '    image: redis:alpine',
        'volumes:',
        '  postgres:'
      ].join('\n')
    );
  }

  const mock = `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "$MOCK_DOCKER_LOG"

case " $* " in
  *" config --format json "*)
    args=("$@")
    compose_file=''

    for ((i=0; i<\${#args[@]}-1; i++)); do
      if [[ "\${args[i]}" == "-f" ]]; then
        compose_file="\${args[i+1]}"
        break
      fi
    done

    grep -Fq "$MOCK_EXPECTED_IMAGE" "$compose_file" || exit 43

    printf '{"services":{"ghostfolio":{"image":"%s"},"postgres":{},"redis":{}}}\\n' "$MOCK_EXPECTED_IMAGE"
    ;;
esac

case " $* " in
  *" image inspect "*) operation=image-config ;;
  *" pull postgres redis "*) operation=pull ;;
  *" up -d "*) operation=up ;;
  *" exec -T ghostfolio "*"/api/v1/info "*) operation=info ;;
  *" exec -T ghostfolio "*) operation=health ;;
  *" down --volumes "*) operation=down ;;
  *) operation=other ;;
esac

if [[ "$operation" == "$MOCK_FAILURE" ]]; then
  exit 42
fi

case "$operation" in
  image-config) printf '%s\\n' "$MOCK_IMAGE_ENV" ;;
  info) printf '%s\\n' "$MOCK_INFO_BODY" ;;
esac

exit 0
`;

  writeFileSync(join(bin, 'docker'), mock, { mode: 0o755 });

  const args = [
    script,
    expectedImage,
    ...(distributive ? [composeTemplate, sourceImage] : [])
  ];

  const result = spawnSync('bash', args, {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: temporary,
      MOCK_DOCKER_LOG: log,
      MOCK_FAILURE: failure,
      MOCK_EXPECTED_IMAGE: expectedImage,
      EXPECT_GHOSTFOLIO_NG: options.expectNg ?? 'false',
      MOCK_IMAGE_ENV: options.imageEnv ?? '["GHOSTFOLIO_NG=true"]',
      MOCK_INFO_BODY: options.infoBody ?? '{"isGhostfolioNg":true}'
    }
  });

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

test('qualifies distributive Compose using the temporary image', () => {
  const result = runScenario('', true);

  assert.equal(result.status, 0);
  assert.equal(result.credentialsRemain, false);
  assert.equal(result.directories.length, 0);
  assert.ok(hasCommand(result.commands, 'pull postgres redis'));
  assert.ok(hasCommand(result.commands, 'up -d --pull never'));
  assert.ok(hasCommand(result.commands, 'exec -T ghostfolio'));
  assert.ok(hasCommand(result.commands, 'down --volumes'));
  assert.ok(result.output.includes('smoke test: PASS'));
});

test('cleans up after distributive Compose startup failure', () => {
  const result = runScenario('up', true);

  assert.equal(result.status, 42);
  assert.equal(result.credentialsRemain, false);
  assert.ok(hasCommand(result.commands, 'down --volumes'));
  assert.ok(!result.output.includes('smoke test: PASS'));
});

test('rejects a missing distributive Compose template', () => {
  const result = spawnSync(
    'bash',
    [
      script,
      'ghostfolio-ng:test',
      '/tmp/nonexistent-release-compose.yml',
      'ghcr.io/example/app:old'
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Compose template not found/);
});

test('rejects incomplete distributive Compose arguments', () => {
  const root = mkdtempSync(join(tmpdir(), 'ghostfolio-ng-invalid-'));
  const template = join(root, 'compose.yml');

  try {
    writeFileSync(template, 'services: {}');

    const result = spawnSync(
      'bash',
      [script, 'ghostfolio-ng:test', template, ''],
      { encoding: 'utf8' }
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Source image reference is required/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('pulls the temporary Ghostfolio image in distributive mode', () => {
  const result = runScenario('', true);

  assert.equal(result.status, 0);
  assert.ok(hasCommand(result.commands, 'pull ghostfolio'));
});

test('does not pull the local Ghostfolio image in candidate mode', () => {
  const result = runScenario();

  assert.equal(result.status, 0);
  assert.ok(!hasCommand(result.commands, 'pull ghostfolio'));
});

for (const distributive of [false, true]) {
  test(`qualifies NG image metadata and anonymous info API (distributive=${distributive})`, () => {
    const result = runScenario('', distributive, { expectNg: 'true' });

    assert.equal(result.status, 0, result.output);
    assert.equal(result.credentialsRemain, false);
    assert.equal(result.directories.length, 0);
    const inspect = result.commands.findIndex((c) =>
      c.includes('image inspect')
    );
    const startup = result.commands.findIndex((c) => c.includes('up -d'));
    const info = result.commands.find((c) => c.includes('/api/v1/info'));
    assert.ok(inspect >= 0 && inspect < startup);
    if (distributive) {
      assert.ok(
        result.commands.findIndex((c) => c.includes('pull ghostfolio')) <
          inspect
      );
    }
    assert.ok(info?.includes('exec -T ghostfolio curl --fail'));
    assert.ok(info.includes('--max-time 30'));
    assert.doesNotMatch(info, /Authorization|Bearer|--user|--cookie/);
    assert.ok(result.output.includes('smoke test: PASS'));
  });

  test(`leaves NG checks optional (distributive=${distributive})`, () => {
    const result = runScenario('', distributive, {
      imageEnv: '["GHOSTFOLIO_NG=false"]',
      infoBody: 'invalid JSON'
    });

    assert.equal(result.status, 0, result.output);
    assert.ok(!hasCommand(result.commands, 'image inspect'));
    assert.ok(!hasCommand(result.commands, '/api/v1/info'));
  });
}

for (const imageEnv of [
  '["GHOSTFOLIO_NG=false"]',
  '[]',
  '["GHOSTFOLIO_NG=true","GHOSTFOLIO_NG=false"]',
  'null',
  'invalid JSON'
]) {
  test(`rejects NG image configuration ${imageEnv}`, () => {
    const result = runScenario('', false, { expectNg: 'true', imageEnv });

    assert.notEqual(result.status, 0);
    assert.ok(!hasCommand(result.commands, 'up -d'));
    assert.ok(hasCommand(result.commands, 'down --volumes'));
    assert.equal(result.credentialsRemain, false);
    assert.ok(!result.output.includes('smoke test: PASS'));
  });
}

for (const infoBody of [
  '{"isGhostfolioNg":false}',
  '{"isGhostfolioNg":"true"}',
  '{"isGhostfolioNg":1}',
  '{"isGhostfolioNg":null}',
  '{}',
  'null',
  '[]',
  'invalid JSON',
  '',
  '{"isGhostfolioNg":true}\n{"isGhostfolioNg":true}'
]) {
  test(`rejects invalid NG info response ${JSON.stringify(infoBody)}`, () => {
    const result = runScenario('', false, { expectNg: 'true', infoBody });

    assert.notEqual(result.status, 0);
    assert.ok(hasCommand(result.commands, '/api/v1/info'));
    assert.ok(hasCommand(result.commands, 'down --volumes'));
    assert.equal(result.credentialsRemain, false);
    assert.ok(!result.output.includes('smoke test: PASS'));
  });
}

for (const failure of ['image-config', 'info']) {
  test(`cleans up and fails when NG ${failure} command fails`, () => {
    const result = runScenario(failure, false, { expectNg: 'true' });

    assert.notEqual(result.status, 0);
    assert.ok(hasCommand(result.commands, 'down --volumes'));
    assert.equal(result.credentialsRemain, false);
    assert.ok(!result.output.includes('smoke test: PASS'));
  });
}

test('rejects invalid NG option before invoking Docker', () => {
  const result = runScenario('', false, { expectNg: 'yes' });

  assert.equal(result.status, 2);
  assert.deepEqual(result.commands, []);
  assert.match(result.output, /EXPECT_GHOSTFOLIO_NG must be true or false/);
});
