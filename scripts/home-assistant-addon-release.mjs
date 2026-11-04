import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const identityKeys = [
  'integration_tag',
  'source_commit',
  'source_image',
  'ghostfolio_version',
  'addon_source_revision'
];
const arches = { amd64: 'amd64', aarch64: 'arm64' };
const states = ['reserved', 'qualified', 'published', 'activated'];
const sha = /^[a-f0-9]{40}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function keys(value, expected) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

export function compareVersions(a, b) {
  for (const value of [a, b]) {
    assert.equal(typeof value, 'string');
    assert.ok(!/\s/.test(value), 'Whitespace in version');
    assert.match(value, versionPattern, 'Invalid three-component version');
  }
  const left = a.split('.').map(BigInt);
  const right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function validateIdentity(input) {
  keys(input, identityKeys);
  for (const field of identityKeys) {
    assert.equal(typeof input[field], 'string');
    assert.ok(!/\s/.test(input[field]), 'Whitespace in release identity');
  }
  compareVersions(input.ghostfolio_version, input.ghostfolio_version);
  assert.match(input.source_commit, sha);
  assert.match(input.addon_source_revision, sha);
  assert.match(
    input.source_image,
    /^ghcr\.io\/piggei\/ghostfolio-ng@sha256:[a-f0-9]{64}$/
  );
  const match = /^integration-(\d+\.\d+\.\d+)-([1-9][0-9]*)$/.exec(
    input.integration_tag
  );
  assert.ok(match, 'Unexpected integration release identity');
  assert.equal(match[1], input.ghostfolio_version);
  return input;
}

function order(identity) {
  validateIdentity(identity);
  return BigInt(identity.integration_tag.split('-').at(-1));
}

export function createRegistry(baselineVersion) {
  compareVersions(baselineVersion, baselineVersion);
  return {
    schema_version: 1,
    generation: 0,
    baseline_version: baselineVersion,
    current_release: null,
    releases: []
  };
}

function validateImage(image, arch) {
  keys(image, ['os', 'architecture', 'digest']);
  assert.equal(image.os, 'linux');
  assert.equal(image.architecture, arches[arch], 'Architecture mismatch');
  assert.match(image.digest, digest);
  assert.equal(image.digest.length, 71);
}

function derivedState(record) {
  if (record.state === 'activated') return 'activated';
  if (Object.keys(record.published).length === 2) return 'published';
  if (Object.keys(record.qualified).length === 2) return 'qualified';
  return 'reserved';
}

export function validateRegistry(registry) {
  keys(registry, [
    'schema_version',
    'generation',
    'baseline_version',
    'current_release',
    'releases'
  ]);
  assert.equal(registry.schema_version, 1);
  assert.ok(
    Number.isSafeInteger(registry.generation) && registry.generation >= 0
  );
  compareVersions(registry.baseline_version, registry.baseline_version);
  assert.ok(Array.isArray(registry.releases));
  let previousVersion = registry.baseline_version;
  let previousOrder = 0n;
  let activated = null;
  for (const record of registry.releases) {
    keys(record, [
      'identity',
      'addon_version',
      'state',
      'qualified',
      'published'
    ]);
    validateIdentity(record.identity);
    assert.ok(
      order(record.identity) > previousOrder,
      'Release order regression'
    );
    assert.ok(
      compareVersions(record.addon_version, previousVersion) > 0,
      'Version collision or regression'
    );
    previousVersion = record.addon_version;
    previousOrder = order(record.identity);
    const previous = registry.releases[registry.releases.indexOf(record) - 1];
    if (previous) {
      assert.ok(
        compareVersions(
          record.identity.ghostfolio_version,
          previous.identity.ghostfolio_version
        ) >= 0,
        'Upstream version regression'
      );
    }
    assert.ok(states.includes(record.state), 'Unknown release state');
    for (const field of ['qualified', 'published']) {
      assert.ok(record[field] && typeof record[field] === 'object');
      assert.ok(!Array.isArray(record[field]));
      for (const [arch, image] of Object.entries(record[field])) {
        assert.ok(Object.hasOwn(arches, arch), 'Unexpected architecture');
        validateImage(image, arch);
        if (field === 'published') {
          assert.equal(
            Object.keys(record.qualified).length,
            2,
            'Both images must qualify before publication'
          );
          assert.deepEqual(image, record.qualified[arch], 'Digest mismatch');
        }
      }
    }
    assert.equal(
      record.state,
      derivedState(record),
      'Invalid state transition'
    );
    if (Object.keys(record.qualified).length === 2) {
      assert.notEqual(
        record.qualified.amd64.digest,
        record.qualified.aarch64.digest,
        'Duplicate architecture digest'
      );
    }
    if (record.state === 'activated') {
      assert.equal(Object.keys(record.published).length, 2);
      activated = record.identity.integration_tag;
    }
  }
  assert.equal(registry.current_release, activated, 'Invalid current release');
  return registry;
}

function change(registry, operation) {
  validateRegistry(registry);
  const next = structuredClone(registry);
  operation(next);
  if (JSON.stringify(next) !== JSON.stringify(registry)) next.generation++;
  return validateRegistry(next);
}

function findRecord(registry, identity) {
  validateIdentity(identity);
  const record = registry.releases.find(
    (item) => item.identity.integration_tag === identity.integration_tag
  );
  assert.ok(record, 'Release is not reserved');
  assert.deepEqual(record.identity, identity, 'Conflicting release retry');
  return record;
}

export function reserveRelease(registry, identity) {
  validateIdentity(identity);
  return change(registry, (next) => {
    if (
      next.releases.some(
        (r) => r.identity.integration_tag === identity.integration_tag
      )
    ) {
      findRecord(next, identity);
      return;
    }
    const last = next.releases.at(-1);
    assert.ok(
      !last || order(identity) > order(last.identity),
      'Older release attempt'
    );
    if (last) {
      assert.ok(
        compareVersions(
          identity.ghostfolio_version,
          last.identity.ghostfolio_version
        ) >= 0,
        'Upstream version regression'
      );
    }
    const maximum = last?.addon_version ?? next.baseline_version;
    const parts = maximum.split('.');
    parts[2] = String(BigInt(parts[2]) + 1n);
    const addonVersion =
      compareVersions(identity.ghostfolio_version, maximum) > 0
        ? identity.ghostfolio_version
        : parts.join('.');
    next.releases.push({
      identity: structuredClone(identity),
      addon_version: addonVersion,
      state: 'reserved',
      qualified: {},
      published: {}
    });
  });
}

export function recordImage(registry, identity, stage, arch, image) {
  assert.ok(['qualified', 'published'].includes(stage));
  assert.ok(Object.hasOwn(arches, arch), 'Unexpected architecture');
  validateImage(image, arch);
  return change(registry, (next) => {
    const record = findRecord(next, identity);
    if (record[stage][arch]) {
      assert.deepEqual(record[stage][arch], image, 'Conflicting image retry');
      return;
    }
    assert.notEqual(record.state, 'activated');
    if (stage === 'published') {
      assert.equal(
        Object.keys(record.qualified).length,
        2,
        'Both images must qualify before publication'
      );
      assert.deepEqual(record.qualified[arch], image, 'Digest mismatch');
    }
    record[stage][arch] = structuredClone(image);
    record.state = derivedState(record);
  });
}

export function activateRelease(registry, identity) {
  return change(registry, (next) => {
    const record = findRecord(next, identity);
    // A retry of a historical activation must never move the pointer backwards.
    if (record.state === 'activated') return;
    assert.equal(record.state, 'published', 'Images are not published');
    const current = next.releases.find(
      (r) => r.identity.integration_tag === next.current_release
    );
    assert.ok(
      !current || order(identity) > order(current.identity),
      'Stale metadata activation'
    );
    record.state = 'activated';
    next.current_release = identity.integration_tag;
  });
}

export function currentManifest(registry) {
  validateRegistry(registry);
  const record = registry.releases.find(
    (r) => r.identity.integration_tag === registry.current_release
  );
  return record
    ? { schema_version: 1, ...structuredClone(record) }
    : {
        schema_version: 1,
        addon_version: registry.baseline_version,
        state: 'legacy'
      };
}

export function serializeRegistry(registry) {
  return JSON.stringify(validateRegistry(registry), null, 2) + '\n';
}

export function registryRevision(registry) {
  return createHash('sha256').update(serializeRegistry(registry)).digest('hex');
}

export function loadRegistry(path) {
  return validateRegistry(JSON.parse(readFileSync(path, 'utf8')));
}

// Reconstruct exactly one public state-machine operation from the persisted
// snapshot. A valid destination schema alone does not authorize a transition.
function validatePersistedTransition(current, next) {
  assert.equal(
    next.generation,
    current.generation + 1,
    'Exactly one operation is allowed per generation'
  );
  let expected;
  if (next.releases.length === current.releases.length + 1) {
    expected = reserveRelease(current, next.releases.at(-1).identity);
  } else {
    assert.equal(next.releases.length, current.releases.length);
    const changed = current.releases.filter(
      (record, index) => !isDeepStrictEqual(record, next.releases[index])
    );
    assert.equal(changed.length, 1, 'Exactly one release may change');
    const old = changed[0];
    assert.notEqual(old.state, 'activated', 'Activated release is immutable');
    const updated = next.releases[current.releases.indexOf(old)];
    const additions = [];
    for (const stage of ['qualified', 'published']) {
      for (const arch of Object.keys(updated[stage])) {
        if (!Object.hasOwn(old[stage], arch)) additions.push({ stage, arch });
      }
    }
    if (additions.length === 1) {
      const { stage, arch } = additions[0];
      expected = recordImage(
        current,
        old.identity,
        stage,
        arch,
        updated[stage][arch]
      );
    } else {
      assert.equal(additions.length, 0, 'Exactly one image may be recorded');
      expected = activateRelease(current, old.identity);
    }
  }
  assert.deepEqual(next, expected, 'Snapshot is not one authorized operation');
}

// Local compare-and-swap only. Phase 1B must add remote HEAD checks and commit
// registry, current manifest, config and documentation in one Git commit.
export function saveRegistry(path, expectedRevision, next) {
  validateRegistry(next);
  const lockPath = `${path}.lock`;
  const fd = openSync(lockPath, 'wx', 0o600);
  const temporary = `${lockPath}.json`;
  let temporaryCreated = false;
  try {
    const current = loadRegistry(path);
    assert.equal(
      registryRevision(current),
      expectedRevision,
      'Concurrent registry update'
    );
    if (isDeepStrictEqual(current, next)) return;
    validatePersistedTransition(current, next);
    writeFileSync(temporary, serializeRegistry(next), {
      flag: 'wx',
      mode: 0o600
    });
    temporaryCreated = true;
    const data = openSync(temporary, 'r');
    try {
      fsyncSync(data);
    } finally {
      closeSync(data);
    }
    renameSync(temporary, path);
  } finally {
    closeSync(fd);
    for (const file of [...(temporaryCreated ? [temporary] : []), lockPath]) {
      try {
        unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}
