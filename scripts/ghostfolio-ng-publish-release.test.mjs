import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ghostfolio-ng-publish-release.sh');

const repository = 'piggei/ghostfolio';
const image = 'ghcr.io/piggei/ghostfolio-ng';
const tag = 'integration-3.94.0-test';
const commit = 'a'.repeat(40);
const digest = `sha256:${'c'.repeat(64)}`;

const assetNames = [
  `ghostfolio-ng-${tag}-linux-amd64.tar.gz`,
  `ghostfolio-ng-${tag}-linux-arm64.tar.gz`,
  'docker-compose.yml',
  'ghostfolio.env.example',
  'SHA256SUMS'
];

function createRelease({
  draft = true,
  commit: target = commit,
  assets = assetNames
} = {}) {
  return {
    id: 123456,
    tag_name: tag,
    target_commitish: target,
    draft,
    prerelease: true,
    assets: assets.map((name) => ({ name }))
  };
}

function runScenario({
  mode = 'prepare',
  existingRelease = null,
  failUpload = '',
  failPatchResponse = false,
  digestMismatch = false,
  tamperChecksum = false,
  missingAsset = '',
  extraRemoteAsset = false,
  retryAfterPatchLoss = false,
  remoteAssetTamper = '',
  remoteChecksumTamper = false,
  missingRemoteAsset = ''
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ghostfolio-ng-publisher-'));
  const bin = join(root, 'bin');
  const assets = join(root, 'assets');
  const remoteAssets = join(root, 'remote-assets');
  const temporaryDirectory = join(root, 'tmp');
  const stateFile = join(root, 'github.json');
  const logFile = join(root, 'commands.log');

  mkdirSync(bin);
  mkdirSync(assets);
  mkdirSync(remoteAssets);
  mkdirSync(temporaryDirectory);

  const content = new Map();

  for (const name of assetNames) {
    content.set(name, `test asset: ${name}`);
  }

  content.set('notes.md', `# Ghostfolio-NG ${tag}`);

  if (missingAsset) {
    content.delete(missingAsset);
  }

  for (const [name, value] of content) {
    if (name !== 'SHA256SUMS') {
      writeFileSync(join(assets, name), value);
    }
  }

  const checksummed = assetNames.filter(
    (name) => name !== 'SHA256SUMS' && content.has(name)
  );

  const checksumLines = checksummed.map((name) => {
    const hash = createHash('sha256')
      .update(content.get(name))
      .digest('hex');

    return `${hash}  ${name}`;
  });

  if (tamperChecksum) {
    checksumLines[0] = `${'0'.repeat(64)}  ${checksummed[0]}`;
  }

  if (!missingAsset || missingAsset !== 'SHA256SUMS') {
    writeFileSync(
      join(assets, 'SHA256SUMS'),
      `${checksumLines.join('\n')}\n`
    );
  }

  let initialRelease = existingRelease
    ? structuredClone(existingRelease)
    : null;

  if (extraRemoteAsset && initialRelease) {
    initialRelease.assets.push({ name: 'unexpected.bin' });
  }

  writeFileSync(
    stateFile,
    JSON.stringify({ release: initialRelease })
  );

  // Seed the simulated registry with the existing remote release assets.
  for (const asset of initialRelease?.assets ?? []) {
    const source = join(assets, asset.name);

    if (
      asset.name !== missingRemoteAsset &&
      existsSync(source)
    ) {
      copyFileSync(source, join(remoteAssets, asset.name));
    }
  }

  const ghMock = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const statePath = process.env.MOCK_GITHUB_STATE;
const remoteAssets = path.join(path.dirname(statePath), 'remote-assets');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

function save() {
  fs.writeFileSync(statePath, JSON.stringify(state));
}

function log() {
  fs.appendFileSync(
    process.env.MOCK_COMMAND_LOG,
    JSON.stringify(['gh', ...args]) + '\\n'
  );
}

function fail(message) {
  process.stderr.write(message + '\\n');
  process.exit(1);
}

log();

if (args[0] === 'api') {
  const endpoint = args.find((value) => value.startsWith('repos/'));

  if (args.includes('--method')) {
    if (!state.release) fail('HTTP 404');

    state.release.draft = false;
    save();

    if (process.env.MOCK_PATCH_LOSS === 'true') {
      fail('Simulated lost PATCH response');
    }

    process.stdout.write(JSON.stringify(state.release));
    process.exit(0);
  }

  if (!state.release) fail('HTTP 404: Not Found');

  process.stdout.write(JSON.stringify(state.release));
  process.exit(0);
}

if (args[0] === 'release' && args[1] === 'create') {
  const releaseTag = args[2];
  const target = args[args.indexOf('--target') + 1];

  state.release = {
    id: 123456,
    tag_name: releaseTag,
    target_commitish: target,
    draft: true,
    prerelease: true,
    assets: []
  };

  save();
  process.exit(0);
}

if (args[0] === 'release' && args[1] === 'upload') {
  const file = args[3];
  const name = path.basename(file);

  if (process.env.MOCK_FAIL_UPLOAD === name) {
    fail('Simulated asset upload failure');
  }

  if (!state.release || !fs.existsSync(file)) {
    fail('Release or asset unavailable');
  }

  state.release.assets = state.release.assets.filter(
    (asset) => asset.name !== name
  );

  state.release.assets.push({ name });
  fs.copyFileSync(file, path.join(remoteAssets, name));
  save();
  process.exit(0);
}

if (args[0] === 'release' && args[1] === 'download') {
  if (!state.release) fail('Release unavailable');

  const directory = args[args.indexOf('--dir') + 1];

  if (!directory) fail('Download directory missing');

  fs.mkdirSync(directory, { recursive: true });

  for (const asset of state.release.assets) {
    const source = path.join(remoteAssets, asset.name);
    const destination = path.join(directory, asset.name);

    if (!fs.existsSync(source)) {
      fail('Remote asset unavailable: ' + asset.name);
    }

    fs.copyFileSync(source, destination);

    if (process.env.MOCK_REMOTE_ASSET_TAMPER === asset.name) {
      fs.writeFileSync(destination, 'tampered remote asset');
    }

    if (
      process.env.MOCK_REMOTE_CHECKSUM_TAMPER === 'true' &&
      asset.name === 'SHA256SUMS'
    ) {
      fs.appendFileSync(destination, 'tampered checksum\\n');
    }
  }

  process.exit(0);
}

fail('Unexpected gh command: ' + args.join(' '));
`;

  const dockerMock = `#!/usr/bin/env node
const args = process.argv.slice(2);

require('node:fs').appendFileSync(
  process.env.MOCK_COMMAND_LOG,
  JSON.stringify(['docker', ...args]) + '\\n'
);

if (
  process.env.MOCK_DIGEST_MISMATCH === 'true'
) {
  process.stdout.write('Name: mock\\nDigest: sha256:' + 'd'.repeat(64) + '\\n');
} else {
  process.stdout.write(
    'Name: mock\\nDigest: ' + process.env.MOCK_SOURCE_DIGEST + '\\n'
  );
}
`;

  writeFileSync(join(bin, 'gh'), ghMock);
  writeFileSync(join(bin, 'docker'), dockerMock);

  chmodSync(join(bin, 'gh'), 0o755);
  chmodSync(join(bin, 'docker'), 0o755);

  const commandLog = () => {
    if (!existsSync(logFile)) return [];

    return readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };

  const state = () =>
    JSON.parse(readFileSync(stateFile, 'utf8'));

  function execute(currentMode) {
    const args = [
      currentMode,
      repository,
      tag,
      commit,
      assets
    ];

    if (currentMode === 'publish') {
      args.push(image, digest);
    }

    const result = spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: temporaryDirectory,
        MOCK_GITHUB_STATE: stateFile,
        MOCK_COMMAND_LOG: logFile,
        MOCK_FAIL_UPLOAD: failUpload,
        MOCK_REMOTE_ASSET_TAMPER: remoteAssetTamper,
        MOCK_REMOTE_CHECKSUM_TAMPER: String(remoteChecksumTamper),
        MOCK_PATCH_LOSS: String(failPatchResponse),
        MOCK_DIGEST_MISMATCH: String(digestMismatch),
        MOCK_SOURCE_DIGEST: digest
      }
    });

    cleanupSnapshots.push(readdirSync(temporaryDirectory));

    return result;
  }

  const cleanupSnapshots = [];
  const first = execute(mode);
  let second = null;

  if (retryAfterPatchLoss) {
    second = execute('publish');
  }

  const finalState = state();
  const commands = commandLog();

  rmSync(root, { recursive: true, force: true });

  return {
    status: first.status,
    output: `${first.stdout ?? ''}\n${first.stderr ?? ''}`,
    secondStatus: second?.status,
    secondOutput: `${second?.stdout ?? ''}\n${second?.stderr ?? ''}`,
    commands,
    release: finalState.release,
    cleanupSnapshots
  };
}

function hasCommand(result, prefix) {
  return result.commands.some(
    (command) => command[0] === prefix
  );
}

test('creates a new Draft Release and uploads five assets', () => {
  const result = runScenario();

  assert.equal(result.status, 0);
  assert.equal(result.release.draft, true);
  assert.equal(result.release.prerelease, true);
  assert.equal(result.release.target_commitish, commit);
  assert.deepEqual(
    result.release.assets.map((asset) => asset.name).sort(),
    [...assetNames].sort()
  );
  assert.equal(hasCommand(result, 'gh'), true);
  assert.match(result.output, /Draft Release prepared/);
});

test('recovers an existing Draft Release from the same commit', () => {
  const result = runScenario({
    existingRelease: createRelease()
  });

  assert.equal(result.status, 0);
  assert.equal(result.release.draft, true);

  const createCommands = result.commands.filter(
    (command) => command[0] === 'gh' &&
      command[1] === 'release' &&
      command[2] === 'create'
  );

  assert.equal(createCommands.length, 0);
});

test('rejects a Draft Release belonging to another commit', () => {
  const result = runScenario({
    existingRelease: createRelease({
      commit: 'b'.repeat(40)
    })
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /different release context/);
});

test('rejects an already published release during prepare', () => {
  const result = runScenario({
    existingRelease: createRelease({ draft: false })
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /already published/);
});

test('keeps Draft Release after interrupted asset upload', () => {
  const result = runScenario({
    failUpload: assetNames[1]
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.release.draft, true);
  assert.ok(result.release.assets.length < 5);
});

test('rejects a corrupted SHA256SUMS file', () => {
  const result = runScenario({
    tamperChecksum: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /FAILED/);
  assert.equal(result.release, null);
});

test('rejects a missing release asset', () => {
  const result = runScenario({
    missingAsset: assetNames[0]
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Missing or invalid release file/);
  assert.equal(result.release, null);
});

test('rejects unexpected remote release assets', () => {
  const result = runScenario({
    existingRelease: createRelease(),
    extraRemoteAsset: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /do not match the expected set/);
});

test('rejects a remote archive whose content differs from the local asset', () => {
  const result = runScenario({
    mode: 'publish',
    existingRelease: createRelease(),
    remoteAssetTamper: assetNames[0]
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /checksum verification failed/);

  const patches = result.commands.filter(
    (command) => command[0] === 'gh' &&
      command.includes('PATCH')
  );

  assert.equal(patches.length, 0);
});

test('rejects a remote SHA256SUMS file that differs from the local one', () => {
  const result = runScenario({
    mode: 'publish',
    existingRelease: createRelease(),
    remoteChecksumTamper: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /SHA256SUMS differs from local release/);
});

test('rejects an unavailable remote release asset', () => {
  const result = runScenario({
    mode: 'publish',
    existingRelease: createRelease(),
    missingRemoteAsset: assetNames[0]
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Cannot download remote release assets/);
});

test('blocks publication when GHCR digest differs', () => {
  const result = runScenario({
    mode: 'publish',
    existingRelease: createRelease(),
    digestMismatch: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /GHCR digest mismatch/);

  const patches = result.commands.filter(
    (command) => command[0] === 'gh' &&
      command.includes('PATCH')
  );

  assert.equal(patches.length, 0);
});

test('publishes a valid Draft Release', () => {
  const result = runScenario({
    mode: 'publish',
    existingRelease: createRelease()
  });

  assert.equal(result.status, 0);
  assert.equal(result.release.draft, false);
  assert.equal(result.release.prerelease, true);
  assert.match(result.output, /release published/);
});

test('recovers when PATCH succeeds but its response is lost', () => {
  const result = runScenario({
    mode: 'publish',
    existingRelease: createRelease(),
    failPatchResponse: true,
    retryAfterPatchLoss: true
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.secondStatus, 0);
  assert.equal(result.release.draft, false);
  assert.match(result.secondOutput, /already published and verified/);
});

test('accepts an already published valid release without modifying it', () => {
  const result = runScenario({
    mode: 'publish',
    existingRelease: createRelease({ draft: false })
  });

  assert.equal(result.status, 0);
  assert.equal(result.release.draft, false);
  assert.match(result.output, /already published and verified/);

  const patches = result.commands.filter(
    (command) => command[0] === 'gh' &&
      command.includes('PATCH')
  );

  assert.equal(patches.length, 0);
});


test('cleans temporary publisher files after success, failure and retry', () => {
  const scenarios = [
    { name: 'prepare success', options: {} },
    {
      name: 'prepare upload failure',
      options: { failUpload: assetNames[0] }
    },
    {
      name: 'publish success',
      options: {
        mode: 'publish',
        existingRelease: createRelease()
      }
    },
    {
      name: 'publish digest mismatch',
      options: {
        mode: 'publish',
        existingRelease: createRelease(),
        digestMismatch: true
      }
    },
    {
      name: 'publish retry after lost PATCH response',
      options: {
        mode: 'publish',
        existingRelease: createRelease(),
        failPatchResponse: true,
        retryAfterPatchLoss: true
      }
    }
  ];

  for (const scenario of scenarios) {
    const result = runScenario(scenario.options);

    assert.ok(
      result.cleanupSnapshots.length >= 1,
      `No cleanup snapshots recorded: ${scenario.name}`
    );

    for (const [index, entries] of result.cleanupSnapshots.entries()) {
      assert.deepEqual(
        entries,
        [],
        `Temporary files remain in ${scenario.name}, attempt ${index + 1}`
      );
    }

    if (scenario.name.includes('retry')) {
      assert.equal(result.cleanupSnapshots.length, 2);
      assert.equal(result.secondStatus, 0);
    }
  }
});
