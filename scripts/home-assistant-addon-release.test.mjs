import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  activateRelease,
  compareVersions,
  createRegistry,
  currentManifest,
  loadRegistry,
  recordImage,
  registryRevision,
  reserveRelease,
  saveRegistry,
  serializeRegistry,
  validateIdentity,
  validateRegistry
} from './home-assistant-addon-release.mjs';

const identity = {
  integration_tag: 'integration-3.97.0-15',
  source_commit: '649d61f90429483cac949c0c97c83d10c13f7c8e',
  source_image:
    'ghcr.io/piggei/ghostfolio-ng@sha256:8ae5031f41e96bebf1fc5a599513c4ba8c0ef33e49171dc45198bcb9cba4e27f',
  ghostfolio_version: '3.97.0',
  addon_source_revision: 'ae29e27d8acb83f02d402ddeaa934aea867e7ea5'
};
const images = {
  amd64: {
    os: 'linux',
    architecture: 'amd64',
    digest: `sha256:${'a'.repeat(64)}`
  },
  aarch64: {
    os: 'linux',
    architecture: 'arm64',
    digest: `sha256:${'b'.repeat(64)}`
  }
};

function release(number, version = '3.97.0') {
  return {
    ...identity,
    integration_tag: `integration-${version}-${number}`,
    ghostfolio_version: version
  };
}

function reserved() {
  return reserveRelease(createRegistry('3.97.0'), identity);
}

function qualify(registry, source = identity) {
  for (const arch of Object.keys(images)) {
    registry = recordImage(registry, source, 'qualified', arch, images[arch]);
  }
  return registry;
}

function publish(registry, source = identity) {
  registry = qualify(registry, source);
  for (const arch of Object.keys(images)) {
    registry = recordImage(registry, source, 'published', arch, images[arch]);
  }
  return registry;
}

test('allocation follows all requested examples and avoids upstream patch collisions', () => {
  let registry = createRegistry('3.97.0');
  const examples = [
    [15, '3.97.0', '3.97.1'],
    [16, '3.97.0', '3.97.2'],
    [17, '3.98.0', '3.98.0'],
    [18, '3.98.0', '3.98.1'],
    [19, '3.98.1', '3.98.2']
  ];
  for (const [number, upstream, expected] of examples) {
    registry = reserveRelease(registry, release(number, upstream));
    assert.equal(registry.releases.at(-1).addon_version, expected);
  }
});

test('numeric comparison handles multi-digit and arbitrarily large components', () => {
  assert.equal(compareVersions('3.100.0', '3.99.9'), 1);
  assert.equal(compareVersions('3.97.0', '3.97.0'), 0);
  assert.equal(compareVersions('3.97.0', '4.0.0'), -1);
  const registry = reserveRelease(
    createRegistry('3.97.99999999999999999999'),
    identity
  );
  assert.equal(
    registry.releases[0].addon_version,
    '3.97.100000000000000000000'
  );
});

for (const version of [
  '3.97',
  'v3.97.0',
  '03.97.0',
  '3.97.0-beta',
  '3.97.0+1',
  '3.97.-1',
  '3.97.0\n',
  '',
  null,
  3.97
]) {
  test(`reject invalid version ${JSON.stringify(version)}`, () => {
    assert.throws(() => createRegistry(version));
  });
}

test('identity accepts only exact immutable contract fields', () => {
  assert.deepEqual(validateIdentity(identity), identity);
  const invalid = [
    { source_commit: identity.source_commit + '\n' },
    { source_image: identity.source_image + '\n' },
    { source_image: 'ghcr.io/piggei/ghostfolio-ng:integration' },
    { source_image: `ghcr.io/other/ghostfolio-ng@sha256:${'a'.repeat(64)}` },
    { source_image: `ghcr.io/piggei/ghostfolio-ng@sha256:${'a'.repeat(63)}` },
    { source_commit: '649d61f90' },
    { addon_source_revision: 'feat/home-assistant-addon' },
    { integration_tag: 'integration-3.98.0-15' },
    { integration_tag: 'integration-3.97.0-015' },
    { integration_tag: 'integration-3.97.0-15.1' },
    { unexpected: true }
  ];
  for (const changes of invalid) {
    assert.throws(() => validateIdentity({ ...identity, ...changes }));
  }
  const incomplete = { ...identity };
  delete incomplete.source_commit;
  assert.throws(() => validateIdentity(incomplete));
});

test('allocation also works when the existing patch already exceeds upstream', () => {
  const registry = reserveRelease(createRegistry('3.97.1'), identity);
  assert.equal(registry.releases[0].addon_version, '3.97.2');
});

test('every immutable identity field is protected on retry', () => {
  const registry = reserved();
  for (const changes of [
    { source_commit: 'c'.repeat(40) },
    { source_image: `ghcr.io/piggei/ghostfolio-ng@sha256:${'c'.repeat(64)}` },
    { addon_source_revision: 'c'.repeat(40) },
    { ghostfolio_version: '3.98.0' }
  ])
    assert.throws(() => reserveRelease(registry, { ...identity, ...changes }));
  assert.deepEqual(reserveRelease(registry, identity), registry);
});

test('reservations consume versions even if qualification never completes', () => {
  const registry = reserveRelease(reserved(), release(16));
  assert.equal(registry.releases[1].addon_version, '3.97.2');
  assert.deepEqual(
    currentManifest(registry),
    currentManifest(createRegistry('3.97.0'))
  );
  assert.throws(() => reserveRelease(registry, release(14)), /Older/);
  assert.throws(
    () => reserveRelease(registry, release(17, '3.96.0')),
    /regression/
  );
});

test('partial qualification, partial publication, activation and all retries', () => {
  let registry = reserved();
  const baseline = currentManifest(registry);
  registry = recordImage(
    registry,
    identity,
    'qualified',
    'amd64',
    images.amd64
  );
  assert.equal(registry.releases[0].state, 'reserved');
  assert.throws(() =>
    recordImage(registry, identity, 'published', 'amd64', images.amd64)
  );
  registry = qualify(registry);
  assert.equal(registry.releases[0].state, 'qualified');
  assert.throws(() => activateRelease(registry, identity));
  registry = recordImage(
    registry,
    identity,
    'published',
    'amd64',
    images.amd64
  );
  assert.deepEqual(currentManifest(registry), baseline);
  assert.throws(() => activateRelease(registry, identity));
  assert.deepEqual(
    recordImage(registry, identity, 'published', 'amd64', images.amd64),
    registry
  );
  registry = recordImage(
    registry,
    identity,
    'published',
    'aarch64',
    images.aarch64
  );
  assert.equal(registry.releases[0].state, 'published');
  assert.deepEqual(currentManifest(registry), baseline);
  registry = activateRelease(registry, identity);
  assert.equal(currentManifest(registry).addon_version, '3.97.1');
  assert.equal(currentManifest(registry).state, 'activated');
  assert.deepEqual(activateRelease(registry, identity), registry);
  assert.deepEqual(reserveRelease(registry, identity), registry);
  assert.deepEqual(publish(registry), registry);
});

test('reject architecture mismatches, unexpected platforms and changed digests', () => {
  const registry = qualify(reserved());
  assert.throws(() =>
    recordImage(registry, identity, 'qualified', 'arm64', images.aarch64)
  );
  assert.throws(() =>
    recordImage(registry, identity, 'qualified', 'aarch64', images.amd64)
  );
  assert.throws(() =>
    recordImage(registry, identity, 'qualified', 'amd64', {
      ...images.amd64,
      os: 'windows'
    })
  );
  assert.throws(() =>
    recordImage(registry, identity, 'published', 'amd64', {
      ...images.amd64,
      digest: `sha256:${'c'.repeat(64)}`
    })
  );
  assert.throws(() =>
    recordImage(registry, identity, 'qualified', 'amd64', {
      ...images.amd64,
      digest: `sha256:${'c'.repeat(64)}`
    })
  );
  assert.throws(() =>
    recordImage(registry, identity, 'qualified', 'amd64', {
      ...images.amd64,
      digest: 'bad'
    })
  );
  assert.throws(() =>
    recordImage(registry, release(99), 'qualified', 'amd64', images.amd64)
  );
});

test('old published runs and old activated retries cannot regress current metadata', () => {
  let registry = publish(reserved());
  registry = reserveRelease(registry, release(16));
  registry = activateRelease(publish(registry, release(16)), release(16));
  assert.throws(() => activateRelease(registry, identity), /Stale/);
  let historical = activateRelease(publish(reserved()), identity);
  historical = reserveRelease(historical, release(16));
  historical = activateRelease(publish(historical, release(16)), release(16));
  assert.deepEqual(activateRelease(historical, identity), historical);
  assert.deepEqual(reserveRelease(historical, identity), historical);
});

test('schema rejects corrupt states, duplicate allocations and invalid current pointers', () => {
  for (const corrupt of [
    (r) => {
      r.schema_version = 2;
    },
    (r) => {
      r.generation = -1;
    },
    (r) => {
      r.releases[0].state = 'published';
    },
    (r) => {
      r.releases[0].state = 'activated';
    },
    (r) => {
      r.releases[0].addon_version = '3.97.0';
    },
    (r) => {
      r.current_release = identity.integration_tag;
    },
    (r) => {
      r.releases.push(structuredClone(r.releases[0]));
    },
    (r) => {
      r.releases[0].qualified = [];
    },
    (r) => {
      r.releases[0].extra = true;
    }
  ]) {
    const registry = reserved();
    corrupt(registry);
    assert.throws(() => validateRegistry(registry));
  }
});

test('operations and manifests do not mutate their inputs', () => {
  const registry = reserved();
  const before = serializeRegistry(registry);
  qualify(registry);
  const manifest = currentManifest(registry);
  manifest.addon_version = '999.0.0';
  assert.equal(serializeRegistry(registry), before);
});

test('duplicate architecture digests are rejected', () => {
  const registry = recordImage(
    reserved(),
    identity,
    'qualified',
    'amd64',
    images.amd64
  );
  assert.throws(
    () =>
      recordImage(registry, identity, 'qualified', 'aarch64', {
        ...images.aarch64,
        digest: images.amd64.digest
      }),
    /Duplicate architecture digest/
  );
});

test('missing, invalid JSON and incompatible registries fail closed', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ha-corrupt-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'registry.json');
  assert.throws(() => loadRegistry(path), /ENOENT/);
  for (const content of ['{', '{}', '{"schema_version":2}']) {
    writeFileSync(path, content);
    assert.throws(() => loadRegistry(path));
    assert.equal(readFileSync(path, 'utf8'), content);
  }
});

test('failed persistence leaves registry intact and does not remove abandoned temporary files', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ha-interrupted-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'registry.json');
  const registry = createRegistry('3.97.0');
  writeFileSync(path, serializeRegistry(registry));
  writeFileSync(`${path}.lock.json`, 'interrupted write');
  assert.throws(
    () => saveRegistry(path, registryRevision(registry), reserved()),
    /EEXIST/
  );
  assert.deepEqual(loadRegistry(path), registry);
  assert.equal(readFileSync(`${path}.lock.json`, 'utf8'), 'interrupted write');
  assert.throws(() => readFileSync(`${path}.lock`), /ENOENT/);
});

test('persistent CAS rejects stale writers, locks and history rewrites', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ha-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'registry.json');
  const initial = createRegistry('3.97.0');
  writeFileSync(path, serializeRegistry(initial));
  const expected = registryRevision(initial);
  const next = reserveRelease(initial, identity);
  saveRegistry(path, expected, next);
  assert.deepEqual(loadRegistry(path), next);
  assert.throws(
    () => saveRegistry(path, expected, reserveRelease(initial, release(16))),
    /Concurrent/
  );
  assert.deepEqual(loadRegistry(path), next);
  saveRegistry(path, registryRevision(next), next);
  const changed = structuredClone(next);
  changed.generation++;
  changed.releases[0].identity.source_commit = 'c'.repeat(40);
  assert.throws(() => saveRegistry(path, registryRevision(next), changed));
  writeFileSync(`${path}.lock`, 'another writer');
  assert.throws(
    () => saveRegistry(path, registryRevision(next), qualify(next)),
    /EEXIST/
  );
  assert.equal(readFileSync(`${path}.lock`, 'utf8'), 'another writer');
});

test('restart resumes the same allocation and recorded partial image state', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ha-resume-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'registry.json');
  let registry = createRegistry('3.97.0');
  writeFileSync(path, serializeRegistry(registry));
  for (const update of [
    (r) => reserveRelease(r, identity),
    (r) => recordImage(r, identity, 'qualified', 'amd64', images.amd64),
    (r) => recordImage(r, identity, 'qualified', 'aarch64', images.aarch64),
    (r) => recordImage(r, identity, 'published', 'amd64', images.amd64),
    (r) => recordImage(r, identity, 'published', 'aarch64', images.aarch64),
    (r) => activateRelease(r, identity)
  ]) {
    const next = update(registry);
    saveRegistry(path, registryRevision(registry), next);
    registry = loadRegistry(path);
    assert.deepEqual(reserveRelease(registry, identity), registry);
    assert.equal(registry.releases[0].addon_version, '3.97.1');
  }
});

// This immutable initial-state fixture is independent of the evolving repository.
const bootstrapFixture = Object.freeze({
  schema_version: 1,
  generation: 0,
  baseline_version: '3.97.0',
  current_release: null,
  releases: Object.freeze([])
});
const bootstrapManifest = Object.freeze({
  schema_version: 1,
  addon_version: '3.97.0',
  state: 'legacy'
});

function assertMetadataConsistency(registry, manifest, config) {
  validateRegistry(registry);
  assert.deepEqual(currentManifest(registry), manifest);
  assert.deepEqual(config.match(/^version:.*$/gm), [
    `version: "${manifest.addon_version}"`
  ]);
}

function partiallyQualifiedFixture() {
  let registry = reserveRelease(bootstrapFixture, identity);
  registry = reserveRelease(registry, release(16));
  return recordImage(registry, release(16), 'qualified', 'amd64', images.amd64);
}

test('immutable bootstrap has no allocations, evidence or fabricated activation', () => {
  assert.deepEqual(createRegistry('3.97.0'), bootstrapFixture);
  assertMetadataConsistency(
    bootstrapFixture,
    bootstrapManifest,
    'version: "3.97.0"\n'
  );
  assert.equal(bootstrapFixture.current_release, null);
  assert.equal(bootstrapFixture.generation, 0);
  assert.deepEqual(bootstrapFixture.releases, []);
});

test('checked-in registry satisfies schema, state and advertised metadata invariants', () => {
  const registry = loadRegistry(
    new URL('../home-assistant-addon/releases/registry.json', import.meta.url)
  );
  const manifest = JSON.parse(
    readFileSync(
      new URL('../home-assistant-addon/release.json', import.meta.url)
    )
  );
  const config = readFileSync(
    new URL('../home-assistant-addon/config.yaml', import.meta.url),
    'utf8'
  );
  assertMetadataConsistency(registry, manifest, config);
});

test('generation-three fixture accepts two reservations and legitimate partial AMD64 qualification', () => {
  const registry = partiallyQualifiedFixture();
  assert.equal(registry.generation, 3);
  assert.equal(registry.releases.length, 2);
  assert.equal(registry.releases[1].state, 'reserved');
  assert.deepEqual(registry.releases[1].qualified, { amd64: images.amd64 });
  assert.deepEqual(registry.releases[1].published, {});
  assertMetadataConsistency(registry, bootstrapManifest, 'version: "3.97.0"\n');
  assert.deepEqual(createRegistry('3.97.0'), bootstrapFixture);
});

test('metadata consistency accepts each legitimate transition including final activation', () => {
  let registry = reserveRelease(bootstrapFixture, identity);
  for (const operation of [
    (r) => recordImage(r, identity, 'qualified', 'amd64', images.amd64),
    (r) => recordImage(r, identity, 'qualified', 'aarch64', images.aarch64),
    (r) => recordImage(r, identity, 'published', 'amd64', images.amd64),
    (r) => recordImage(r, identity, 'published', 'aarch64', images.aarch64),
    (r) => activateRelease(r, identity)
  ]) {
    registry = operation(registry);
    const manifest = currentManifest(registry);
    assertMetadataConsistency(
      registry,
      manifest,
      `version: "${manifest.addon_version}"\n`
    );
  }
  assert.equal(registry.releases[0].state, 'activated');
  assert.equal(currentManifest(registry).addon_version, '3.97.1');
});

test('evolved registry consistency rejects invalid schema, states, evidence and current pointer', () => {
  for (const corrupt of [
    (r) => {
      r.schema_version = 2;
    },
    (r) => {
      r.generation = -1;
    },
    (r) => {
      r.releases[1].state = 'qualified';
    },
    (r) => {
      r.releases[1].qualified.amd64.architecture = 'arm64';
    },
    (r) => {
      r.releases[1].published.amd64 = images.amd64;
    },
    (r) => {
      r.current_release = r.releases[1].identity.integration_tag;
    }
  ]) {
    const registry = partiallyQualifiedFixture();
    corrupt(registry);
    assert.throws(() =>
      assertMetadataConsistency(
        registry,
        bootstrapManifest,
        'version: "3.97.0"\n'
      )
    );
  }
});

test('evolved registry rejects inconsistent manifest, premature version and duplicate advertised version', () => {
  const registry = partiallyQualifiedFixture();
  for (const [manifest, config] of [
    [{ ...bootstrapManifest, state: 'activated' }, 'version: "3.97.0"\n'],
    [{ ...bootstrapManifest, addon_version: '3.97.2' }, 'version: "3.97.2"\n'],
    [bootstrapManifest, 'version: "3.97.2"\n'],
    [bootstrapManifest, 'version: "3.97.0"\nversion: "3.97.2"\n']
  ])
    assert.throws(() => assertMetadataConsistency(registry, manifest, config));
});

test('evolved persistence still rejects identity changes, evidence replacement and skipped transitions', (t) => {
  const registry = partiallyQualifiedFixture();
  for (const corrupt of [
    (r) => {
      r.releases[1].identity.source_commit = 'f'.repeat(40);
    },
    (r) => {
      r.releases[1].qualified.amd64.digest = `sha256:${'c'.repeat(64)}`;
    },
    (r) => {
      r.releases[1].qualified.aarch64 = images.aarch64;
      r.releases[1].published = structuredClone(images);
      r.releases[1].state = 'published';
    }
  ]) {
    const next = structuredClone(registry);
    next.generation++;
    corrupt(next);
    rejectsSave(t, registry, next);
  }
});

// Every rejected save must leave the original file byte-for-byte intact,
// including when the forged destination is a valid standalone registry.
function rejectsSave(t, current, next, validSchema = true) {
  const directory = mkdtempSync(join(tmpdir(), 'ha-forged-transition-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'registry.json');
  const original = serializeRegistry(current);
  writeFileSync(path, original);
  if (validSchema) validateRegistry(next);
  assert.throws(() => saveRegistry(path, registryRevision(current), next));
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.deepEqual(loadRegistry(path), current);
}

for (const [from, to] of [
  ['reserved', 'activated'],
  ['reserved', 'published'],
  ['qualified', 'activated']
]) {
  test(`persistence rejects forged ${from} to ${to} with a valid schema`, (t) => {
    const current = from === 'reserved' ? reserved() : qualify(reserved());
    const next =
      to === 'published'
        ? publish(current)
        : activateRelease(publish(current), identity);
    next.generation = current.generation + 1;
    rejectsSave(t, current, next);
  });
}

test('persistence rejects publication evidence before qualification completes', (t) => {
  const current = recordImage(
    reserved(),
    identity,
    'qualified',
    'amd64',
    images.amd64
  );
  const next = structuredClone(current);
  next.generation++;
  next.releases[0].published.amd64 = structuredClone(images.amd64);
  rejectsSave(t, current, next, false);
});

test('persistence rejects qualification completion and publication in one generation', (t) => {
  const current = recordImage(
    reserved(),
    identity,
    'qualified',
    'amd64',
    images.amd64
  );
  const next = recordImage(
    qualify(current),
    identity,
    'published',
    'amd64',
    images.amd64
  );
  next.generation = current.generation + 1;
  rejectsSave(t, current, next);
});

for (const stage of ['qualified', 'published']) {
  test(`persistence rejects replacing existing ${stage} evidence`, (t) => {
    const current = publish(reserved());
    const next = structuredClone(current);
    next.generation++;
    // Keep the destination schema valid by changing both matching descriptors.
    next.releases[0].qualified.amd64.digest = `sha256:${'c'.repeat(64)}`;
    next.releases[0].published.amd64.digest = `sha256:${'c'.repeat(64)}`;
    if (stage === 'published') {
      // Also try to conceal the rewrite inside an otherwise legal activation.
      next.releases[0].state = 'activated';
      next.current_release = identity.integration_tag;
    }
    rejectsSave(t, current, next);
  });
}

for (const field of ['identity', 'evidence', 'version']) {
  test(`persistence rejects retroactive activated ${field} changes`, (t) => {
    const current = activateRelease(publish(reserved()), identity);
    const next = structuredClone(current);
    next.generation++;
    if (field === 'identity')
      next.releases[0].identity.source_commit = 'c'.repeat(40);
    if (field === 'version') next.releases[0].addon_version = '3.97.2';
    if (field === 'evidence') {
      next.releases[0].qualified.amd64.digest = `sha256:${'c'.repeat(64)}`;
      next.releases[0].published.amd64.digest = `sha256:${'c'.repeat(64)}`;
    }
    rejectsSave(t, current, next);
  });
}

test('persistence rejects pointer-only activation and pointer regression', (t) => {
  const current = publish(reserved());
  const next = structuredClone(current);
  next.generation++;
  next.current_release = identity.integration_tag;
  rejectsSave(t, current, next, false);

  let historical = activateRelease(current, identity);
  historical = reserveRelease(historical, release(16));
  historical = activateRelease(publish(historical, release(16)), release(16));
  const regressed = structuredClone(historical);
  regressed.generation++;
  regressed.current_release = identity.integration_tag;
  // Rewriting the newer activation makes the forged snapshot valid alone.
  regressed.releases[1].state = 'published';
  rejectsSave(t, historical, regressed);
});

test('persistence rejects multiple operations, even with a forged generation', (t) => {
  const current = reserved();
  const combined = qualify(current);
  rejectsSave(t, current, combined);
  combined.generation = current.generation + 1;
  rejectsSave(t, current, combined);

  const empty = createRegistry('3.97.0');
  const prequalified = qualify(reserveRelease(empty, identity));
  prequalified.generation = empty.generation + 1;
  rejectsSave(t, empty, prequalified);
});

test('persistence rejects modifying two releases in one generation', (t) => {
  const current = reserveRelease(reserved(), release(16));
  let next = recordImage(current, identity, 'qualified', 'amd64', images.amd64);
  next = recordImage(next, release(16), 'qualified', 'amd64', images.amd64);
  next.generation = current.generation + 1;
  rejectsSave(t, current, next);
});

test('persistence rejects fabricated allocation and generation-only changes', (t) => {
  const current = createRegistry('3.97.0');
  const wrongVersion = reserveRelease(current, identity);
  wrongVersion.releases[0].addon_version = '3.97.9';
  rejectsSave(t, current, wrongVersion);
  const generationOnly = structuredClone(current);
  generationOnly.generation++;
  rejectsSave(t, current, generationOnly);
});

test('each architecture evidence can persist individually in either order', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ha-single-operation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const order of [
    ['amd64', 'aarch64'],
    ['aarch64', 'amd64']
  ]) {
    const path = join(directory, `${order[0]}.json`);
    let current = createRegistry('3.97.0');
    writeFileSync(path, serializeRegistry(current));
    const operations = [
      (r) => reserveRelease(r, identity),
      ...['qualified', 'published'].flatMap((stage) =>
        order.map(
          (arch) => (r) => recordImage(r, identity, stage, arch, images[arch])
        )
      ),
      (r) => activateRelease(r, identity)
    ];
    for (const operation of operations) {
      const next = operation(current);
      assert.equal(next.generation, current.generation + 1);
      saveRegistry(path, registryRevision(current), next);
      current = loadRegistry(path);
      const bytes = readFileSync(path, 'utf8');
      saveRegistry(path, registryRevision(current), operation(current));
      assert.equal(readFileSync(path, 'utf8'), bytes);
    }
    assert.equal(current.releases[0].state, 'activated');
  }
});

test('historical activated retries persist as no-ops after a newer activation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ha-historical-retry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'registry.json');
  let current = activateRelease(publish(reserved()), identity);
  current = reserveRelease(current, release(16));
  current = activateRelease(publish(current, release(16)), release(16));
  writeFileSync(path, serializeRegistry(current));
  for (const retry of [
    (r) => reserveRelease(r, identity),
    (r) => recordImage(r, identity, 'qualified', 'amd64', images.amd64),
    (r) => recordImage(r, identity, 'published', 'aarch64', images.aarch64),
    (r) => activateRelease(r, identity)
  ]) {
    const before = readFileSync(path, 'utf8');
    saveRegistry(path, registryRevision(current), retry(current));
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.equal(
      loadRegistry(path).current_release,
      release(16).integration_tag
    );
  }
});

test('an incomplete reservation does not block a newer identity or recycle its version', () => {
  const original = reserved();
  const abandonedRecord = structuredClone(original.releases[0]);
  const before = JSON.stringify(original);
  for (const [version, expected] of [
    ['3.97.0', '3.97.2'],
    ['3.97.1', '3.97.2'],
    ['3.98.0', '3.98.0']
  ]) {
    const nextIdentity = {
      ...release(16, version),
      source_commit: 'c'.repeat(40),
      source_image: `ghcr.io/piggei/ghostfolio-ng@sha256:${'d'.repeat(64)}`,
      addon_source_revision: 'e'.repeat(40)
    };
    let next = reserveRelease(original, nextIdentity);
    assert.equal(next.generation, 2);
    assert.equal(next.releases[1].addon_version, expected);
    assert.equal(currentManifest(next).addon_version, '3.97.0');
    assert.deepEqual(reserveRelease(next, nextIdentity), next);
    next = activateRelease(publish(next, nextIdentity), nextIdentity);
    assert.equal(currentManifest(next).addon_version, expected);
    assert.equal(next.current_release, nextIdentity.integration_tag);
    assert.equal(next.generation, 7);
    assert.deepEqual(next.releases[0], abandonedRecord);
  }
  assert.equal(JSON.stringify(original), before);
  assert.throws(() =>
    reserveRelease(original, {
      ...identity,
      addon_source_revision: 'f'.repeat(40)
    })
  );
});
