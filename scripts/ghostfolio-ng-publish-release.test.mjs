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
    assets: assets.map((name, index) => ({
      id: 1000 + index,
      name
    }))
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
  retryAfterUploadFailure = false,
  retryAfterUploadResponseLoss = false,
  remoteAssetTamper = '',
  remoteChecksumTamper = false,
  missingRemoteAsset = '',
  apiFailure = false,
  duplicateRelease = false,
  releaseOnSecondPage = false,
  invalidCreatedTag = false,
  invalidCreatedId = false,
  invalidAssetListing = '',
  uploadHttpStatus = '',
  invalidUploadSize = false,
  uploadResponseLoss = '',
  draftCreationResponseLoss = false,
  retryAfterDraftCreationLoss = false,
  githubToken = 'mock_github_token_for_tests',
  concurrentUpload = '',
  retryAfterConcurrentUpload = false,
  concurrentUploadDifferent = false
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
    const hash = createHash('sha256').update(content.get(name)).digest('hex');

    return `${hash}  ${name}`;
  });

  if (tamperChecksum) {
    checksumLines[0] = `${'0'.repeat(64)}  ${checksummed[0]}`;
  }

  if (!missingAsset || missingAsset !== 'SHA256SUMS') {
    writeFileSync(join(assets, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);
  }

  let initialRelease = existingRelease
    ? structuredClone(existingRelease)
    : null;

  if (extraRemoteAsset && initialRelease) {
    initialRelease.assets.push({ name: 'unexpected.bin' });
  }

  writeFileSync(stateFile, JSON.stringify({ release: initialRelease }));

  // Seed the simulated registry with the existing remote release assets.
  for (const asset of initialRelease?.assets ?? []) {
    const source = join(assets, asset.name);

    if (asset.name !== missingRemoteAsset && existsSync(source)) {
      copyFileSync(source, join(remoteAssets, asset.name));
    }
  }

  const ghMock = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const assetNames = JSON.parse(process.env.MOCK_ASSET_NAMES);
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
  const methodIndex = args.indexOf('--method');
  const method = methodIndex >= 0 ? args[methodIndex + 1] : 'GET';

  if (method === 'POST' && endpoint?.endsWith('/releases')) {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));

    if (state.release) {
      fail('HTTP 422: Release already exists');
    }

    state.release = {
      id: 123456,
      tag_name: payload.tag_name,
      target_commitish: payload.target_commitish,
      name: payload.name,
      body: payload.body,
      draft: payload.draft,
      prerelease: payload.prerelease,
      assets: []
    };

    save();

    if (process.env.MOCK_DRAFT_CREATION_RESPONSE_LOSS === 'true') {
      fail('Simulated lost Draft creation response');
    }

    const response = { ...state.release };

    if (process.env.MOCK_INVALID_CREATED_TAG === 'true') {
      response.tag_name = 'integration-wrong-tag';
    }

    if (process.env.MOCK_INVALID_CREATED_ID === 'true') {
      response.id = null;
    }

    process.stdout.write(JSON.stringify(response));
    process.exit(0);
  }

  if (
    method === 'GET' &&
    /^repos\\/[^/]+\\/[^/]+\\/releases\\/assets\\/[0-9]+$/.test(endpoint ?? '')
  ) {
    const requestedId = Number(endpoint.split('/').at(-1));

    const asset = state.release?.assets.find(
      (item) => item.id === requestedId
    );

    if (!asset) {
      fail('HTTP 404: Release asset ID not found');
    }

    const source = path.join(remoteAssets, asset.name);

    if (!fs.existsSync(source)) {
      fail('Remote asset unavailable: ' + asset.name);
    }

    let content = fs.readFileSync(source);

    if (process.env.MOCK_REMOTE_ASSET_TAMPER === asset.name) {
      content = Buffer.from('tampered remote asset');
    }

    if (
      process.env.MOCK_REMOTE_CHECKSUM_TAMPER === 'true' &&
      asset.name === 'SHA256SUMS'
    ) {
      content = Buffer.concat([
        content,
        Buffer.from('tampered checksum\\n')
      ]);
    }

    process.stdout.write(content);
    process.exit(0);
  }

  if (method === 'PATCH') {
    if (!state.release) fail('HTTP 404');

    state.release.draft = false;
    save();

    if (process.env.MOCK_PATCH_LOSS === 'true') {
      fail('Simulated lost PATCH response');
    }

    process.stdout.write(JSON.stringify(state.release));
    process.exit(0);
  }

  if (method === 'GET' && /^repos\\/[^/]+\\/[^/]+\\/releases\\/[0-9]+$/.test(endpoint ?? '')) {
    const requestedId = Number(endpoint.split('/').at(-1));

    if (!state.release || state.release.id !== requestedId) {
      fail('HTTP 404: Release ID not found');
    }

    process.stdout.write(JSON.stringify(state.release));
    process.exit(0);
  }

  if (
    method === 'GET' &&
    /^repos\\/[^/]+\\/[^/]+\\/releases\\/[0-9]+\\/assets\\?per_page=100$/.test(endpoint ?? '')
  ) {
    const requestedId = Number(
      endpoint.split('/releases/')[1].split('/')[0]
    );

    if (!state.release || state.release.id !== requestedId) {
      fail('HTTP 404: Release assets not found');
    }

    const assets = state.release.assets.map((asset, index) => {
      const file = path.join(remoteAssets, asset.name);

      return {
        id: asset.id ?? 1000 + index,
        name: asset.name,
        size: fs.existsSync(file) ? fs.statSync(file).size : 0,
        state: asset.state ?? 'uploaded'
      };
    });

    const anomaly = process.env.MOCK_INVALID_ASSET_LISTING;

    if (anomaly === 'duplicate-name' && assets.length > 0) {
      assets.push({
        ...assets[0],
        id: 999999
      });
    }

    if (anomaly === 'duplicate-id' && assets.length > 1) {
      assets[1].id = assets[0].id;
    }

    if (anomaly === 'invalid-id' && assets.length > 0) {
      assets[0].id = null;
    }

    if (anomaly === 'invalid-size' && assets.length > 0) {
      assets[0].size = -1;
    }

    if (anomaly === 'incomplete' && assets.length > 0) {
      assets[0].state = 'starter';
    }

    process.stdout.write(JSON.stringify(assets));
    process.exit(0);
  }

  if (endpoint?.includes('/releases?per_page=100')) {
    if (process.env.MOCK_API_FAILURE === 'true') {
      fail('HTTP 500: simulated GitHub API failure');
    }

    const releases = state.release ? [state.release] : [];

    if (
      process.env.MOCK_RELEASE_ON_SECOND_PAGE === 'true' &&
      state.release
    ) {
      process.stdout.write(
        JSON.stringify([{
          ...state.release,
          id: state.release.id + 100,
          tag_name: 'integration-3.93.0-99'
        }]) + '\\n'
      );
    }

    if (process.env.MOCK_DUPLICATE_RELEASE === 'true' && state.release) {
      releases.push({
        ...state.release,
        id: state.release.id + 1
      });
    }

    process.stdout.write(JSON.stringify(releases));
    process.exit(0);
  }

  fail('Unexpected GitHub API GET endpoint: ' + endpoint);
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

  const assetIndex = assetNames.indexOf(name);

  state.release.assets.push({
    id: 1000 + assetIndex,
    name
  });

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

  const curlMock = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const statePath = process.env.MOCK_GITHUB_STATE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const remoteAssets = path.join(path.dirname(statePath), 'remote-assets');
const assetNames = JSON.parse(process.env.MOCK_ASSET_NAMES);

// Consume the configuration without logging credentials.
const config = fs.readFileSync(0, 'utf8');

if (!config.includes('Authorization: Bearer ')) {
  process.stderr.write('Missing authorization header\\n');
  process.exit(1);
}

fs.appendFileSync(
  process.env.MOCK_COMMAND_LOG,
  JSON.stringify(['curl', ...args]) + '\\n'
);

function argument(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const url = argument('--url');
const fileArgument = argument('--data-binary');
const outputFile = argument('--output');

if (!url || !fileArgument?.startsWith('@') || !outputFile) {
  process.stderr.write('Invalid upload arguments\\n');
  process.exit(1);
}

const parsed = new URL(url);
const name = parsed.searchParams.get('name');
const match = parsed.pathname.match(/\\/releases\\/([0-9]+)\\/assets$/);

if (
  parsed.hostname !== 'uploads.github.com' ||
  !match ||
  Number(match[1]) !== state.release?.id ||
  !assetNames.includes(name)
) {
  process.stderr.write('Invalid upload destination\\n');
  process.exit(1);
}

const source = fileArgument.slice(1);

if (process.env.MOCK_FAIL_UPLOAD === name) {
  process.stderr.write('Simulated curl upload interruption\\n');
  process.exit(7);
}

if (!fs.existsSync(source)) {
  process.stderr.write('Missing upload file\\n');
  process.exit(1);
}

if (process.env.MOCK_UPLOAD_HTTP_STATUS) {
  const status = process.env.MOCK_UPLOAD_HTTP_STATUS;

  fs.writeFileSync(
    outputFile,
    JSON.stringify({ message: 'Simulated HTTP ' + status })
  );

  process.stdout.write(status);
  process.exit(0);
}

if (process.env.MOCK_CONCURRENT_UPLOAD === name &&
    !state.release.assets.some((asset) => asset.name === name)) {
  const index = assetNames.indexOf(name);

  if (process.env.MOCK_CONCURRENT_UPLOAD_DIFFERENT === 'true') {
    fs.writeFileSync(
      path.join(remoteAssets, name),
      'different concurrent asset content'
    );
  } else {
    fs.copyFileSync(source, path.join(remoteAssets, name));
  }

  state.release.assets.push({
    id: 1000 + index,
    name,
    size: fs.statSync(source).size,
    state: 'uploaded'
  });

  fs.writeFileSync(statePath, JSON.stringify(state));
}

if (state.release.assets.some((asset) => asset.name === name)) {
  fs.writeFileSync(
    outputFile,
    JSON.stringify({ message: 'Asset already exists' })
  );
  process.stdout.write('422');
  process.exit(0);
}

const index = assetNames.indexOf(name);
const asset = {
  id: 1000 + index,
  name,
  size: fs.statSync(source).size,
  state: 'uploaded'
};

fs.copyFileSync(source, path.join(remoteAssets, name));
state.release.assets.push(asset);
fs.writeFileSync(statePath, JSON.stringify(state));

if (process.env.MOCK_UPLOAD_RESPONSE_LOSS === name) {
  process.stderr.write('Simulated lost upload response\\n');
  process.exit(56);
}

const response = { ...asset };

if (process.env.MOCK_INVALID_UPLOAD_SIZE === 'true') {
  response.size += 1;
}

fs.writeFileSync(outputFile, JSON.stringify(response));

process.stdout.write('201');
`;

  writeFileSync(join(bin, 'gh'), ghMock);
  writeFileSync(join(bin, 'docker'), dockerMock);
  writeFileSync(join(bin, 'curl'), curlMock);

  chmodSync(join(bin, 'gh'), 0o755);
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);

  const commandLog = () => {
    if (!existsSync(logFile)) return [];

    return readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };

  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));

  function execute(
    currentMode,
    currentFailUpload = failUpload,
    currentResponseLoss = uploadResponseLoss,
    currentDraftLoss = draftCreationResponseLoss,
    currentConcurrentUpload = concurrentUpload
  ) {
    const args = [currentMode, repository, tag, commit, assets];

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
        GH_TOKEN: githubToken,
        MOCK_GITHUB_STATE: stateFile,
        MOCK_ASSET_NAMES: JSON.stringify(assetNames),
        MOCK_COMMAND_LOG: logFile,
        MOCK_FAIL_UPLOAD: currentFailUpload,
        MOCK_REMOTE_ASSET_TAMPER: remoteAssetTamper,
        MOCK_REMOTE_CHECKSUM_TAMPER: String(remoteChecksumTamper),
        MOCK_PATCH_LOSS: String(failPatchResponse),
        MOCK_DIGEST_MISMATCH: String(digestMismatch),
        MOCK_SOURCE_DIGEST: digest,
        MOCK_API_FAILURE: String(apiFailure),
        MOCK_DUPLICATE_RELEASE: String(duplicateRelease),
        MOCK_RELEASE_ON_SECOND_PAGE: String(releaseOnSecondPage),
        MOCK_INVALID_CREATED_TAG: String(invalidCreatedTag),
        MOCK_INVALID_CREATED_ID: String(invalidCreatedId),
        MOCK_INVALID_ASSET_LISTING: invalidAssetListing,
        MOCK_CONCURRENT_UPLOAD: currentConcurrentUpload,
        MOCK_CONCURRENT_UPLOAD_DIFFERENT: String(concurrentUploadDifferent),
        MOCK_UPLOAD_HTTP_STATUS: uploadHttpStatus,
        MOCK_INVALID_UPLOAD_SIZE: String(invalidUploadSize),
        MOCK_UPLOAD_RESPONSE_LOSS: currentResponseLoss,
        MOCK_DRAFT_CREATION_RESPONSE_LOSS: String(currentDraftLoss)
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
  } else if (retryAfterUploadFailure) {
    second = execute('prepare', '');
  } else if (retryAfterUploadResponseLoss) {
    second = execute('prepare', '', '');
  } else if (retryAfterDraftCreationLoss) {
    second = execute('prepare', '', '', false);
  } else if (retryAfterConcurrentUpload) {
    second = execute('prepare', '', '', false, '');
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
  return result.commands.some((command) => command[0] === prefix);
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

test('rejects a created Draft Release with an unexpected tag', () => {
  const result = runScenario({
    invalidCreatedTag: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /tag does not match requested tag/);

  const uploads = result.commands.filter(
    (command) => command[1] === 'release' && command[2] === 'upload'
  );

  assert.equal(uploads.length, 0);
});

test('rejects a created Draft Release with an invalid ID', () => {
  const result = runScenario({
    invalidCreatedId: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Invalid GitHub Release ID/);

  const uploads = result.commands.filter(
    (command) => command[1] === 'release' && command[2] === 'upload'
  );

  assert.equal(uploads.length, 0);
});

test('recovers an existing Draft Release from the same commit', () => {
  const result = runScenario({
    existingRelease: createRelease()
  });

  assert.equal(result.status, 0);
  assert.equal(result.release.draft, true);

  const createCommands = result.commands.filter(
    (command) =>
      command[0] === 'gh' && command[1] === 'release' && command[2] === 'create'
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

test('recovers an interrupted upload without replacing existing assets', () => {
  const result = runScenario({
    failUpload: assetNames[1],
    retryAfterUploadFailure: true
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.secondStatus, 0);
  assert.equal(result.release.draft, true);

  assert.deepEqual(
    result.release.assets.map((asset) => asset.name).sort(),
    [...assetNames].sort()
  );

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  const uploadedNames = uploads.map((command) => {
    const urlIndex = command.indexOf('--url');
    const url = command[urlIndex + 1];

    return new URL(url).searchParams.get('name');
  });

  assert.equal(
    uploadedNames.filter((name) => name === assetNames[0]).length,
    1,
    'The first successfully uploaded asset must not be uploaded again'
  );

  assert.equal(
    uploadedNames.filter((name) => name === assetNames[1]).length,
    2,
    'The interrupted asset must be retried once'
  );

  for (const name of assetNames.slice(2)) {
    assert.equal(
      uploadedNames.filter((uploaded) => uploaded === name).length,
      1,
      `Unexpected upload count for ${name}`
    );
  }

  assert.match(result.secondOutput, /Existing draft recovered/);
  assert.match(result.secondOutput, /Draft Release prepared/);
});

test('rejects a different existing asset before uploading missing assets', () => {
  const result = runScenario({
    existingRelease: createRelease({
      assets: [assetNames[0]]
    }),
    remoteAssetTamper: assetNames[0]
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Existing release asset differs from local file/);

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  assert.equal(
    uploads.length,
    0,
    'No missing asset may be uploaded before existing assets are verified'
  );

  assert.equal(result.release.draft, true);
  assert.deepEqual(
    result.release.assets.map((asset) => asset.name),
    [assetNames[0]]
  );
});

test('rejects GitHub asset upload HTTP failures', () => {
  for (const status of ['401', '403', '422', '500']) {
    const result = runScenario({
      uploadHttpStatus: status
    });

    assert.notEqual(result.status, 0, status);
    assert.match(
      result.output,
      new RegExp('GitHub asset upload returned HTTP ' + status),
      status
    );

    assert.equal(result.release.draft, true, status);
    assert.equal(result.release.assets.length, 0, status);

    const uploads = result.commands.filter((command) => command[0] === 'curl');

    assert.equal(uploads.length, 1, status);
  }
});

test('recovers an asset saved before its upload response was lost', () => {
  const result = runScenario({
    uploadResponseLoss: assetNames[0],
    retryAfterUploadResponseLoss: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /GitHub asset upload transport failed/);

  assert.equal(result.secondStatus, 0);
  assert.equal(result.release.draft, true);

  assert.deepEqual(
    result.release.assets.map((asset) => asset.name).sort(),
    [...assetNames].sort()
  );

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  const uploadedNames = uploads.map((command) => {
    const index = command.indexOf('--url');
    assert.notEqual(index, -1);
    return new URL(command[index + 1]).searchParams.get('name');
  });

  assert.equal(
    uploadedNames.filter((name) => name === assetNames[0]).length,
    1,
    'An asset saved before response loss must not be uploaded again'
  );

  for (const name of assetNames.slice(1)) {
    assert.equal(
      uploadedNames.filter((uploaded) => uploaded === name).length,
      1,
      'Each remaining asset must be uploaded exactly once'
    );
  }

  assert.match(result.secondOutput, /Existing draft recovered/);
  assert.match(result.secondOutput, /Existing release asset verified/);
  assert.match(result.secondOutput, /Draft Release prepared/);
});

test('recovers a Draft created before its POST response was lost', () => {
  const result = runScenario({
    draftCreationResponseLoss: true,
    retryAfterDraftCreationLoss: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Simulated lost Draft creation response/);

  assert.equal(result.secondStatus, 0);
  assert.equal(result.release.draft, true);

  const creations = result.commands.filter(
    (command) =>
      command[0] === 'gh' &&
      command[1] === 'api' &&
      command.includes('POST') &&
      command.includes('repos/piggei/ghostfolio/releases')
  );

  assert.equal(creations.length, 1);

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  assert.equal(uploads.length, assetNames.length);

  assert.deepEqual(
    result.release.assets.map((asset) => asset.name).sort(),
    [...assetNames].sort()
  );

  assert.match(result.secondOutput, /Existing draft recovered/);
  assert.match(result.secondOutput, /Draft Release prepared/);
});

test('does not expose GitHub credentials in command logs or output', () => {
  const result = runScenario();

  assert.equal(result.status, 0);

  const secret = 'mock_github_token_for_tests';
  const commands = JSON.stringify(result.commands);

  assert.equal(commands.includes(secret), false);
  assert.equal(result.output.includes(secret), false);

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  assert.equal(uploads.length, assetNames.length);

  for (const command of uploads) {
    assert.equal(command.includes(secret), false);
    assert.equal(command.includes('Authorization: Bearer'), false);
    assert.ok(command.includes('--config'));
    assert.ok(command.includes('--disable'));
  }
});

test('rejects HTTP 201 with incorrect asset size', () => {
  const result = runScenario({
    invalidUploadSize: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Invalid GitHub asset upload response/);

  assert.equal(result.release.draft, true);
  assert.equal(result.release.assets.length, 1);

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  assert.equal(uploads.length, 1);
});

test('rejects a concurrent asset upload without overwriting it', () => {
  const result = runScenario({
    concurrentUpload: assetNames[0]
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /GitHub asset upload returned HTTP 422/);

  assert.equal(result.release.draft, true);

  assert.deepEqual(
    result.release.assets.map((asset) => asset.name),
    [assetNames[0]]
  );

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  assert.equal(uploads.length, 1);
});

test('recovers a concurrent identical asset without reuploading it', () => {
  const result = runScenario({
    concurrentUpload: assetNames[0],
    retryAfterConcurrentUpload: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /HTTP 422/);

  assert.equal(result.secondStatus, 0);
  assert.equal(result.release.draft, true);

  assert.deepEqual(
    result.release.assets.map((asset) => asset.name).sort(),
    [...assetNames].sort()
  );

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  const uploadedNames = uploads.map((command) => {
    const index = command.indexOf('--url');
    assert.notEqual(index, -1);

    return new URL(command[index + 1]).searchParams.get('name');
  });

  for (const name of assetNames) {
    assert.equal(
      uploadedNames.filter((uploaded) => uploaded === name).length,
      1,
      'Unexpected upload count for ' + name
    );
  }

  assert.match(result.secondOutput, /Existing draft recovered/);
  assert.match(result.secondOutput, /Existing release asset verified/);
  assert.match(result.secondOutput, /Draft Release prepared/);
});

test('rejects a different concurrent asset on retry without further uploads', () => {
  const result = runScenario({
    concurrentUpload: assetNames[0],
    concurrentUploadDifferent: true,
    retryAfterConcurrentUpload: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /HTTP 422/);

  assert.notEqual(result.secondStatus, 0);
  assert.match(
    result.secondOutput,
    /Existing release asset differs from local file/
  );

  assert.equal(result.release.draft, true);

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  assert.equal(
    uploads.length,
    1,
    'Retry must not upload assets when an existing asset differs'
  );

  assert.deepEqual(
    result.release.assets.map((asset) => asset.name),
    [assetNames[0]]
  );
});

test('accepts supported GitHub token characters without exposing credentials', () => {
  const githubToken = 'mock-token.with/special+characters=and:values';
  const result = runScenario({ githubToken });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.release.draft, true);
  assert.deepEqual(
    result.release.assets.map((asset) => asset.name).sort(),
    [...assetNames].sort()
  );

  assert.equal(result.output.includes(githubToken), false);
  assert.equal(JSON.stringify(result.commands).includes(githubToken), false);

  const uploads = result.commands.filter((command) => command[0] === 'curl');

  assert.equal(uploads.length, assetNames.length);

  for (const command of uploads) {
    assert.ok(command.includes('--config'));
    assert.ok(command.includes('--disable'));
    assert.equal(command.includes(githubToken), false);
  }
});

test('rejects unsafe GitHub tokens before invoking curl', () => {
  const invalidTokens = [
    'invalid"token',
    'invalid\\ntoken',
    'invalid\\rtoken',
    'invalid token',
    'invalid\\\\token'
  ];

  for (const githubToken of invalidTokens) {
    const result = runScenario({ githubToken });

    assert.notEqual(result.status, 0);
    assert.match(result.output, /GH_TOKEN contains unsupported characters/);

    assert.equal(result.output.includes(githubToken), false);
    assert.equal(JSON.stringify(result.commands).includes(githubToken), false);

    const uploads = result.commands.filter((command) => command[0] === 'curl');

    assert.equal(uploads.length, 0);
    assert.equal(result.release.draft, true);
    assert.equal(result.release.assets.length, 0);
  }
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

test('rejects malformed GitHub release asset listings before upload', () => {
  const anomalies = [
    'duplicate-name',
    'duplicate-id',
    'invalid-id',
    'invalid-size',
    'incomplete'
  ];

  for (const anomaly of anomalies) {
    const result = runScenario({
      existingRelease: createRelease(),
      invalidAssetListing: anomaly
    });

    assert.notEqual(result.status, 0, anomaly);
    assert.match(
      result.output,
      /Invalid GitHub Release asset listing/,
      anomaly
    );

    const uploads = result.commands.filter(
      (command) =>
        command[0] === 'gh' &&
        command[1] === 'release' &&
        command[2] === 'upload'
    );

    assert.equal(uploads.length, 0, anomaly);
  }
});

test('rejects unexpected remote release assets', () => {
  const result = runScenario({
    existingRelease: createRelease(),
    extraRemoteAsset: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Invalid GitHub Release asset listing/);

  const uploads = result.commands.filter(
    (command) =>
      command[0] === 'gh' && command[1] === 'release' && command[2] === 'upload'
  );

  assert.equal(uploads.length, 0);
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
    (command) => command[0] === 'gh' && command.includes('PATCH')
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
  assert.match(result.output, /Cannot download remote release asset:/);
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
    (command) => command[0] === 'gh' && command.includes('PATCH')
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
    (command) => command[0] === 'gh' && command.includes('PATCH')
  );

  assert.equal(patches.length, 0);
});

test('finds the matching Draft Release on a subsequent API page', () => {
  const result = runScenario({
    existingRelease: createRelease(),
    releaseOnSecondPage: true
  });

  assert.equal(result.status, 0);
  assert.equal(result.release.id, 123456);
  assert.equal(result.release.draft, true);
  assert.match(result.output, /Existing draft recovered/);

  const createCommands = result.commands.filter(
    (command) => command[1] === 'release' && command[2] === 'create'
  );

  assert.equal(createCommands.length, 0);
});

test('fails closed when the GitHub releases API returns HTTP 500', () => {
  const result = runScenario({
    apiFailure: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Cannot retrieve GitHub Release/);
  assert.match(result.output, /HTTP 500/);

  const createCommands = result.commands.filter(
    (command) => command[1] === 'release' && command[2] === 'create'
  );

  assert.equal(createCommands.length, 0);
});

test('rejects multiple GitHub Releases with the same tag', () => {
  const result = runScenario({
    existingRelease: createRelease(),
    duplicateRelease: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Multiple GitHub Releases found/);

  const uploadCommands = result.commands.filter(
    (command) => command[1] === 'release' && command[2] === 'upload'
  );

  const createCommands = result.commands.filter(
    (command) => command[1] === 'release' && command[2] === 'create'
  );

  assert.equal(uploadCommands.length, 0);
  assert.equal(createCommands.length, 0);
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
