import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  changelogPath,
  configPath,
  docPaths,
  manifestPath,
  registryPath
} from './home-assistant-addon-github.mjs';
import { architectures } from './home-assistant-addon-oci.mjs';
import {
  candidateTag,
  imageLabels,
  imageRepository,
  Pipeline
} from './home-assistant-addon-pipeline.mjs';
import {
  createRegistry,
  currentManifest,
  serializeRegistry
} from './home-assistant-addon-release.mjs';
import {
  inputIdentity,
  isTagRecovery,
  testSource
} from './home-assistant-addon-workflow.mjs';

const identity = {
  integration_tag: 'integration-3.97.0-15',
  source_commit: '649d61f90429483cac949c0c97c83d10c13f7c8e',
  source_image: `ghcr.io/piggei/ghostfolio-ng@sha256:${'8'.repeat(64)}`,
  ghostfolio_version: '3.97.0',
  addon_source_revision: 'ae29e27d8acb83f02d402ddeaa934aea867e7ea5'
};
const newer = { ...identity, integration_tag: 'integration-3.97.0-16' };
const encode = (value) => JSON.stringify(value, null, 2) + '\n';

function harness() {
  const initial = createRegistry('3.97.0');
  const initialVersion = currentManifest(initial).addon_version;
  const config = readFileSync(configPath, 'utf8');
  const versionPattern = /^version: "[^"]+"$/gm;

  assert.equal(
    [...config.matchAll(versionPattern)].length,
    1,
    'Expected exactly one add-on version field'
  );

  const initialConfig = config.replace(
    versionPattern,
    `version: "${initialVersion}"`
  );

  const remote = {
    head: '0'.repeat(40),
    files: {
      [registryPath]: serializeRegistry(initial),
      [manifestPath]: encode(currentManifest(initial)),
      [configPath]: initialConfig,
      [changelogPath]: null,
      ...Object.fromEntries(
        docPaths.map((path) => [path, readFileSync(path, 'utf8')])
      )
    },
    commits: [],
    tags: new Map(),
    async headValue() {
      return this.head;
    },
    async snapshot(expected) {
      if (expected)
        assert.equal(this.head, expected, 'Concurrent remote branch update');
      return { head: this.head, files: structuredClone(this.files) };
    },
    async file(filePath, ref, missing = false) {
      assert.equal(ref, this.head, 'Unexpected file snapshot revision');
      const value = this.files[filePath];

      if (value === null || value === undefined) {
        if (missing) return null;
        throw new Error(`Missing remote file: ${filePath}`);
      }

      return value;
    },
    async verifySource(identity, includeReleaseBody = false) {
      if (this.sourceFailure) throw new Error('NG source provenance');

      if (!includeReleaseBody) return undefined;

      this.releaseBodyRequests = (this.releaseBodyRequests ?? 0) + 1;

      if (this.releaseUnavailable)
        throw new Error('NG release unavailable');

      if (this.releaseBodyOverride !== undefined)
        return this.releaseBodyOverride;

      return `Ghostfolio-NG release.

## Official Ghostfolio updates

### Added

- Added test feature.

### Changed

- Improved test feature.

## Integration-specific changes

- Fixed test integration.

## Installation

- Installation instructions must not be included.
`;
    },
    async verifyAddonRevision() {
      if (this.sourceChanged) throw new Error('Add-on source changed');
    },
    async checkTag(record) {
      if (record.state !== 'activated')
        assert.equal(
          this.tags.has(record.addon_version),
          false,
          'Git tag conflict'
        );
    },
    async commit(expected, files, message) {
      if (
        this.concurrent ||
        this.concurrentAt === JSON.parse(this.files[registryPath]).generation
      )
        this.head = 'f'.repeat(40);
      assert.equal(this.head, expected, 'Concurrent remote branch update');
      if (this.commitFailure) throw new Error('GitHub unavailable');
      this.files = { ...this.files, ...files };
      this.head = String(this.commits.length + 1).padStart(40, '0');
      this.commits.push({
        head: this.head,
        files: structuredClone(this.files),
        changed: Object.keys(files),
        message
      });
      return this.head;
    },
    async activationCommit(record) {
      const commit = this.commits.find(
        (c) => c.message === `Activate Home Assistant ${record.addon_version}`
      );
      assert.ok(commit);
      return commit.head;
    },
    async ensureTag(record, commit) {
      if (this.tagFailure) throw new Error('GitHub tag unavailable');
      if (this.tags.has(record.addon_version))
        assert.equal(this.tags.get(record.addon_version), commit);
      this.tags.set(record.addon_version, commit);
    }
  };
  const registry = {
    images: new Map(),
    async source() {
      if (this.sourceFailure) throw new Error('NG digest mismatch');
    },
    async image(repository, ref, arch, labels, missing = false) {
      if (this.failure) throw new Error('GHCR unavailable');
      const image = this.images.get(`${repository}:${ref}`);
      if (!image) {
        if (missing) return null;
        throw new Error('GHCR image missing');
      }
      assert.equal(image.architecture, architectures[arch]);
      assert.deepEqual(image.labels, labels, 'Provenance mismatch');
      return structuredClone(image);
    },
    put(repository, ref, image) {
      this.images.set(`${repository}:${ref}`, structuredClone(image));
      this.images.set(`${repository}:${image.digest}`, structuredClone(image));
    }
  };
  const docker = {
    builds: [],
    tests: [],
    promotions: [],
    pushes: 0,
    smokeReferences: [],
    build(reference, source, version, arch) {
      this.builds.push(arch);
      this.local = {
        os: 'linux',
        architecture: architectures[arch],
        digest: `sha256:${(version === '3.97.1' ? (arch === 'amd64' ? 'a' : 'b') : arch === 'amd64' ? 'e' : 'f').repeat(64)}`,
        config_digest: `sha256:${(arch === 'amd64' ? 'c' : 'd').repeat(64)}`,
        labels: imageLabels(source, version)
      };
    },
    smoke(reference, arch) {
      this.tests.push(arch);
      this.smokeReferences.push(reference);
      if (this.failSmoke === arch) throw new Error('Qualification failed');
      if (this.failRemoteSmoke === arch && reference.includes('@'))
        throw new Error('Remote qualification failed');
    },
    localIdentity(reference, arch, labels) {
      assert.equal(this.local.architecture, architectures[arch]);
      assert.deepEqual(this.local.labels, labels);
      return {
        handle: this.classicId ? this.local.config_digest : this.local.digest,
        config_digest: this.local.config_digest
      };
    },
    assertLocalReference(reference, local) {
      assert.ok(!this.replacedTag, 'Local candidate tag was replaced');
      assert.equal(
        local.handle,
        this.classicId ? this.local.config_digest : this.local.digest
      );
    },
    run(args) {
      if (args[0] === 'image') return this.local.config_digest;
      if (args[0] === 'pull') return '';
      if (args[0] === 'push') {
        this.pushes++;
        const [repository, tag] = args[1].replace('ghcr.io/', '').split(':');
        registry.put(repository, tag, this.local);
        if (this.failPushResponse) throw new Error('Lost push response');
        return '';
      }
      if (args[0] === 'buildx') {
        assert.equal(args[3], '--prefer-index=false');
        const final = args[args.indexOf('--tag') + 1];
        const [repository, tag] = final.replace('ghcr.io/', '').split(':');
        const digest = args.at(-1).split('@')[1];
        assert.ok(digest);
        this.promotions.push(repository);
        if (this.failPromotion === repository)
          throw new Error('Publication interrupted');
        const image = registry.images.get(`${repository}:${digest}`);
        registry.put(repository, tag, image);
        if (this.losePromotionResponse)
          throw new Error('Lost promotion response');
        return '';
      }
      throw new Error(`Unexpected Docker call ${args}`);
    }
  };
  const pipeline = new Pipeline({ github: remote, registry, docker });
  const state = () => JSON.parse(remote.files[registryPath]);
  async function qualified(source = identity) {
    const plan = await pipeline.prepare(source);
    await pipeline.qualify(plan, 'amd64');
    await pipeline.qualify(plan, 'aarch64');
    return plan;
  }
  return { remote, registry, docker, pipeline, state, qualified };
}

test('workflow input contract and CI source reject mutable or inconsistent values', () => {
  const env = Object.fromEntries(
    Object.entries(identity).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v])
  );
  assert.deepEqual(inputIdentity(env), identity);
  for (const change of [
    { INPUT_SOURCE_IMAGE: 'ghcr.io/piggei/ghostfolio-ng:integration' },
    { INPUT_SOURCE_COMMIT: 'main' },
    { INPUT_ADDON_SOURCE_REVISION: 'main' },
    { INPUT_INTEGRATION_TAG: 'integration-3.98.0-15' },
    { INPUT_SOURCE_IMAGE: identity.source_image + '\n' }
  ])
    assert.throws(() => inputIdentity({ ...env, ...change }));
  assert.equal(testSource('', { identity }, {}), identity.source_image);
  assert.equal(testSource('', {}, identity), identity.source_image);
  assert.throws(() => testSource('mutable:tag', { identity }, {}));
});

test('reusable calls retain caller push context without selecting legacy tag recovery', () => {
  const env = Object.fromEntries(
    Object.entries(identity).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v])
  );
  assert.equal(
    isTagRecovery({
      ...env,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/integration/ghostfolio-all-pr'
    }),
    false
  );
  assert.equal(
    isTagRecovery({
      ...env,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/tags/home-assistant-addon/v3.97.1'
    }),
    false
  );
  assert.equal(
    isTagRecovery({
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/tags/home-assistant-addon/v3.97.1'
    }),
    true
  );
  assert.equal(
    isTagRecovery({ GITHUB_EVENT_NAME: 'workflow_dispatch' }),
    false
  );
});

test('both native qualifications and digest promotion precede a single atomic metadata activation', async () => {
  const h = harness();
  const original = h.remote.files[configPath];
  const plan = await h.qualified();

  assert.equal(plan.release_notes.length, 2);
  assert.ok(plan.release_notes[0].includes('- Added test feature.'));
  assert.ok(plan.release_notes[1].includes('- Fixed test integration.'));

  assert.deepEqual(h.docker.tests, ['amd64', 'amd64', 'aarch64', 'aarch64']);
  assert.equal(h.remote.files[configPath], original);
  assert.equal(h.remote.files[changelogPath], null);

  const result = await h.pipeline.publish(plan);
  assert.equal(result.addon_version, '3.97.1');
  assert.equal(result.publication_status, 'activated');

  const changelog = h.remote.files[changelogPath];

  assert.ok(changelog);
  assert.match(changelog, /## 3\.97\.1/);
  assert.match(changelog, /### Official Ghostfolio updates/);
  assert.match(changelog, /#### Added/);
  assert.match(changelog, /#### Changed/);
  assert.match(changelog, /### Integration-specific changes/);
  assert.ok(!changelog.includes('Installation instructions'));

  const activation = h.remote.commits.find(
    (commit) => commit.message === 'Activate Home Assistant 3.97.1'
  );

  assert.ok(activation);
  assert.ok(activation.changed.includes(changelogPath));

  assert.match(result.amd64_digest, /^sha256:a{64}$/);
  assert.match(result.aarch64_digest, /^sha256:b{64}$/);
  assert.equal(
    h.remote.files[configPath].replace('3.97.1', '3.97.0'),
    original
  );
  assert.deepEqual(
    h.remote.commits.map(
      (c) => JSON.parse(c.files[registryPath]).releases[0].state
    ),
    ['reserved', 'reserved', 'qualified', 'qualified', 'published', 'activated']
  );
  for (const [index, commit] of h.remote.commits
    .slice(0, -1)
    .entries()) {
    const expected = index === 0
      ? [
          registryPath,
          `home-assistant-addon/releases/notes/${identity.integration_tag}.json`
        ]
      : [registryPath];

    assert.deepEqual(commit.changed.sort(), expected.sort());
    assert.equal(commit.files[configPath], original);
  }
  assert.deepEqual(
    h.remote.commits.at(-1).changed.sort(),
    [registryPath, manifestPath, configPath, changelogPath, ...docPaths].sort()
  );
  for (const doc of docPaths)
    assert.ok(h.remote.files[doc].includes('**3.97.1**'));
});

test('archives verified releases even when they have no selected notes', async () => {
  const h = harness();
  h.remote.releaseBodyOverride = 'Release without selected changelog sections.';

  const plan = await h.pipeline.prepare(identity);
  const archivePath =
    `home-assistant-addon/releases/notes/${identity.integration_tag}.json`;

  assert.deepEqual(plan.release_notes, []);
  assert.deepEqual(JSON.parse(h.remote.files[archivePath]).sections, []);
  assert.equal(h.remote.releaseBodyRequests, 1);

  h.remote.releaseUnavailable = true;
  h.remote.releaseBodyOverride = undefined;

  const recovered = await h.pipeline.prepare(identity);

  assert.deepEqual(recovered.release_notes, []);
  assert.equal(h.remote.releaseBodyRequests, 1);
});

test('new workflow recovers archived NG notes after release deletion', async () => {
  const h = harness();

  const firstPlan = await h.pipeline.prepare(identity);
  const originalNotes = structuredClone(firstPlan.release_notes);

  const archivePath =
    `home-assistant-addon/releases/notes/${identity.integration_tag}.json`;

  const archive = h.remote.files[archivePath];

  assert.ok(archive);
  assert.deepEqual(JSON.parse(archive).identity, identity);
  assert.deepEqual(JSON.parse(archive).sections, originalNotes);
  assert.equal(h.remote.releaseBodyRequests, 1);

  // Simulate a completely new workflow execution.
  h.remote.releaseUnavailable = true;

  const secondPlan = await h.pipeline.prepare(identity);

  assert.deepEqual(secondPlan.release_notes, originalNotes);
  assert.equal(h.remote.releaseBodyRequests, 1);

  assert.equal(secondPlan.head, h.remote.head);
});

test('prepared release survives NG GitHub Release deletion', async () => {
  const h = harness();

  const plan = await h.pipeline.prepare(identity);
  const originalNotes = structuredClone(plan.release_notes);

  assert.equal(h.remote.releaseBodyRequests, 1);
  assert.equal(originalNotes.length, 2);

  // Simulate deletion of the NG GitHub Release after preparation.
  h.remote.releaseUnavailable = true;

  await h.pipeline.qualify(plan, 'amd64');
  await h.pipeline.qualify(plan, 'aarch64');

  assert.deepEqual(plan.release_notes, originalNotes);

  const result = await h.pipeline.publish(plan);

  assert.equal(result.publication_status, 'activated');
  assert.equal(h.remote.releaseBodyRequests, 1);

  const changelog = h.remote.files[changelogPath];

  assert.ok(changelog);
  assert.ok(changelog.includes('- Added test feature.'));
  assert.ok(changelog.includes('- Improved test feature.'));
  assert.ok(changelog.includes('- Fixed test integration.'));
  assert.ok(!changelog.includes('Installation instructions'));
});

for (const arch of ['amd64', 'aarch64']) {
  test(`${arch} qualification failure preserves metadata and supports retry`, async () => {
    const h = harness();
    let plan = await h.pipeline.prepare(identity);
    if (arch === 'aarch64') await h.pipeline.qualify(plan, 'amd64');
    h.docker.failSmoke = arch;
    await assert.rejects(h.pipeline.qualify(plan, arch), /Qualification/);
    assert.equal(currentManifest(h.state()).addon_version, '3.97.0');
    assert.equal(h.docker.promotions.length, 0);
    h.docker.failSmoke = undefined;
    plan = await h.qualified();
    assert.equal(plan.addon_version, '3.97.1');
    assert.equal(
      (await h.pipeline.publish(plan)).publication_status,
      'activated'
    );
  });
}

test('one qualified architecture never permits any final publication', async () => {
  const h = harness();
  const plan = await h.pipeline.prepare(identity);
  await h.pipeline.qualify(plan, 'amd64');
  await assert.rejects(h.pipeline.publish(plan), /Both architectures/);
  assert.equal(h.docker.promotions.length, 0);
});

test('partial publication resumes without rebuilding or replacing the first final image', async () => {
  const h = harness();
  let plan = await h.qualified();
  h.docker.failPromotion = imageRepository('aarch64');
  await assert.rejects(h.pipeline.publish(plan), /Publication/);
  assert.equal(h.state().releases[0].state, 'qualified');
  assert.deepEqual(Object.keys(h.state().releases[0].published), ['amd64']);
  assert.equal(currentManifest(h.state()).addon_version, '3.97.0');
  h.docker.failPromotion = undefined;
  plan = await h.qualified();
  await h.pipeline.publish(plan);
  assert.equal(h.docker.builds.length, 2);
  assert.equal(
    h.docker.promotions.filter((r) => r === imageRepository('amd64')).length,
    1
  );
});

test('existing identical finals and lost publication responses recover safely', async () => {
  const h = harness();
  h.docker.failPushResponse = true;
  const plan = await h.qualified();
  h.docker.losePromotionResponse = true;
  const result = await h.pipeline.publish(plan);
  const commits = h.remote.commits.length;
  const retry = await h.pipeline.prepare(identity);
  await h.pipeline.qualify(retry, 'amd64');
  await h.pipeline.qualify(retry, 'aarch64');
  assert.equal(
    (await h.pipeline.publish(retry)).metadata_commit,
    result.metadata_commit
  );
  assert.equal(h.remote.commits.length, commits);
  assert.equal(h.docker.promotions.length, 2);
  assert.equal(h.remote.tags.size, 1);
});

test('conflicting final tags never overwrite or activate metadata', async () => {
  const h = harness();
  const plan = await h.qualified();
  const repository = imageRepository('amd64');
  const image = structuredClone(
    h.registry.images.get(`${repository}:${candidateTag(identity)}`)
  );
  image.digest = `sha256:${'e'.repeat(64)}`;
  h.registry.put(repository, plan.addon_version, image);
  await assert.rejects(h.pipeline.publish(plan), /Conflicting final/);
  assert.equal(h.docker.promotions.length, 0);
  assert.equal(currentManifest(h.state()).addon_version, '3.97.0');
});

test('GHCR failure retries without allocating another version', async () => {
  const h = harness();
  const plan = await h.qualified();
  h.registry.failure = true;
  await assert.rejects(h.pipeline.publish(plan), /GHCR/);
  h.registry.failure = false;
  const retry = await h.pipeline.prepare(identity);
  assert.equal(retry.addon_version, plan.addon_version);
  await h.pipeline.publish(retry);
});

test('lost GitHub progress and tag failure recover from persisted remote state', async () => {
  const h = harness();
  let plan = await h.pipeline.prepare(identity);
  h.remote.commitFailure = true;
  await assert.rejects(h.pipeline.qualify(plan, 'amd64'), /GitHub/);
  assert.deepEqual(h.state().releases[0].qualified, {});
  h.remote.commitFailure = false;
  plan = await h.qualified();
  assert.equal(h.docker.builds.length, 2);
  h.remote.tagFailure = true;
  await assert.rejects(h.pipeline.publish(plan), /tag unavailable/);
  assert.equal(h.state().releases[0].state, 'activated');
  const commits = h.remote.commits.length;
  h.remote.tagFailure = false;
  const result = await h.pipeline.publish(await h.pipeline.prepare(identity));
  assert.equal(result.publication_status, 'already_activated');
  assert.equal(h.remote.commits.length, commits);
});

test('remote concurrent commit prevents evidence persistence without overwriting', async () => {
  const h = harness();
  const plan = await h.pipeline.prepare(identity);
  const before = structuredClone(h.remote.files);
  h.remote.concurrent = true;
  await assert.rejects(h.pipeline.qualify(plan, 'amd64'), /Concurrent/);
  assert.deepEqual(h.remote.files, before);
  assert.equal(h.remote.head, 'f'.repeat(40));
});

test('concurrent update immediately before activation preserves old metadata and supports recovery', async () => {
  const h = harness();
  const plan = await h.qualified();
  const originalConfig = h.remote.files[configPath];
  h.remote.concurrentAt = 5;
  await assert.rejects(h.pipeline.publish(plan), /Concurrent/);
  assert.equal(h.state().releases[0].state, 'published');
  assert.equal(h.remote.files[configPath], originalConfig);
  assert.equal(currentManifest(h.state()).addon_version, '3.97.0');
  h.remote.concurrentAt = undefined;
  await h.pipeline.publish(await h.pipeline.prepare(identity));
  assert.equal(h.docker.promotions.length, 2);
  assert.equal(currentManifest(h.state()).addon_version, '3.97.1');
});

test('source mismatches fail before reservation and conflicting Git tags before qualification', async () => {
  for (const field of ['sourceFailure', 'sourceChanged']) {
    const h = harness();
    h.remote[field] = true;
    await assert.rejects(h.pipeline.prepare(identity));
    assert.equal(h.remote.commits.length, 0);
  }
  const h = harness();
  h.registry.sourceFailure = true;
  await assert.rejects(h.pipeline.prepare(identity));
  assert.equal(h.remote.commits.length, 0);
  h.registry.sourceFailure = false;
  h.remote.tags.set('3.97.1', 'f'.repeat(40));
  await assert.rejects(h.pipeline.prepare(identity), /tag conflict/);
  assert.equal(h.remote.commits.length, 0);
});

test('historical activation recovery never changes a newer advertised version', async () => {
  const h = harness();
  await h.pipeline.publish(await h.qualified());
  await h.pipeline.publish(await h.qualified(newer));
  const before = structuredClone(h.remote.files);
  const result = await h.pipeline.publish(
    await h.pipeline.prepare(identity, 'home-assistant-addon/v3.97.1')
  );
  assert.equal(result.publication_status, 'already_activated');
  assert.deepEqual(h.remote.files, before);
  assert.equal(currentManifest(h.state()).addon_version, '3.97.2');
});

for (const arch of ['amd64', 'aarch64']) {
  test(`registered ${arch} candidate digest mismatch is rejected despite matching OCI labels`, async () => {
    const h = harness();
    const plan = await h.qualified();
    const expected = h.state().releases[0].qualified[arch];
    const key = `${imageRepository(arch)}:${expected.digest}`;
    h.registry.images.get(key).digest = `sha256:${'9'.repeat(64)}`;
    const before = structuredClone(h.remote.files);
    const builds = h.docker.builds.length;
    const smokes = h.docker.tests.length;
    await assert.rejects(h.pipeline.qualify(plan, arch));
    await assert.rejects(h.pipeline.publish(plan));
    assert.deepEqual(h.remote.files, before);
    assert.equal(h.docker.builds.length, builds);
    assert.equal(h.docker.tests.length, smokes);
    assert.equal(h.docker.promotions.length, 0);
  });
}

test('registered candidate recovery pins the original digest and reruns smoke even if its mutable tag moved', async () => {
  const h = harness();
  const plan = await h.qualified();
  const expected = h.state().releases[0].qualified.amd64;
  const repository = imageRepository('amd64');
  const replacement = structuredClone(
    h.registry.images.get(`${repository}:${expected.digest}`)
  );
  replacement.digest = `sha256:${'9'.repeat(64)}`;
  h.registry.put(repository, candidateTag(identity), replacement);
  const references = [];
  const originalSmoke = h.docker.smoke;
  h.docker.smoke = function (reference, arch) {
    references.push(reference);
    return originalSmoke.call(this, reference, arch);
  };
  const before = structuredClone(h.remote.files);
  await h.pipeline.qualify(plan, 'amd64');
  assert.deepEqual(references, [`ghcr.io/${repository}@${expected.digest}`]);
  assert.deepEqual(h.remote.files, before);
  assert.equal(h.docker.builds.length, 2);
  assert.equal(h.docker.tests.length, 5);
});

test('an uploaded but unregistered candidate is not qualified by its labels when recovered smoke fails', async () => {
  const h = harness();
  let plan = await h.pipeline.prepare(identity);
  h.remote.commitFailure = true;
  await assert.rejects(h.pipeline.qualify(plan, 'amd64'), /GitHub/);
  h.remote.commitFailure = false;
  h.docker.failSmoke = 'amd64';
  plan = await h.pipeline.prepare(identity);
  const before = structuredClone(h.remote.files);
  await assert.rejects(h.pipeline.qualify(plan, 'amd64'), /Qualification/);
  assert.deepEqual(h.remote.files, before);
  assert.deepEqual(h.state().releases[0].qualified, {});
  assert.equal(h.docker.builds.length, 1);
  assert.equal(h.docker.pushes, 1);
  assert.equal(h.docker.tests.length, 3);
});

test('AArch64 final with matching labels but a conflicting digest cannot activate metadata', async () => {
  const h = harness();
  const plan = await h.qualified();
  const repository = imageRepository('aarch64');
  const existing = structuredClone(
    h.registry.images.get(`${repository}:${candidateTag(identity)}`)
  );
  existing.digest = `sha256:${'9'.repeat(64)}`;
  h.registry.put(repository, plan.addon_version, existing);
  await assert.rejects(h.pipeline.publish(plan), /Conflicting final/);
  assert.equal(
    h.registry.images.get(`${repository}:${plan.addon_version}`).digest,
    existing.digest
  );
  assert.equal(currentManifest(h.state()).addon_version, '3.97.0');
  assert.ok(
    !h.remote.commits.some((commit) => commit.message.startsWith('Activate '))
  );
});

test('final digest drift after publication evidence is recorded still blocks activation', async () => {
  const h = harness();
  const plan = await h.qualified();
  const originalImage = h.registry.image.bind(h.registry);
  let finalReads = 0;
  h.registry.image = async (...args) => {
    const image = await originalImage(...args);
    if (
      args[0] === imageRepository('amd64') &&
      args[1] === plan.addon_version &&
      ++finalReads === 3
    ) {
      image.digest = `sha256:${'9'.repeat(64)}`;
    }
    return image;
  };
  await assert.rejects(h.pipeline.publish(plan));
  assert.equal(h.state().releases[0].state, 'published');
  assert.equal(currentManifest(h.state()).addon_version, '3.97.0');
  assert.ok(
    !h.remote.commits.some((commit) => commit.message.startsWith('Activate '))
  );
});

for (const arch of ['amd64', 'aarch64']) {
  for (const classicId of [false, true]) {
    test(`${arch} qualification binds config with ${classicId ? 'classic' : 'containerd'} handle and smokes remote digest`, async () => {
      const h = harness();
      h.docker.classicId = classicId;
      const plan = await h.pipeline.prepare(identity);
      await h.pipeline.qualify(plan, arch);
      const image = h.registry.images.get(
        `${imageRepository(arch)}:${candidateTag(identity)}`
      );
      assert.notEqual(image.digest, image.config_digest);
      assert.deepEqual(h.docker.smokeReferences, [
        classicId ? image.config_digest : image.digest,
        `ghcr.io/${imageRepository(arch)}@${image.digest}`
      ]);
      assert.equal(h.state().releases[0].qualified[arch].digest, image.digest);
      assert.equal(h.state().generation, 2);
    });
  }
  test(`${arch} remote smoke failure preserves reservation and uploaded candidate`, async () => {
    const h = harness();
    const plan = await h.pipeline.prepare(identity);
    const original = structuredClone(h.remote.files);
    h.docker.failRemoteSmoke = arch;
    await assert.rejects(
      h.pipeline.qualify(plan, arch),
      /Remote qualification/
    );
    assert.deepEqual(h.remote.files, original);
    assert.equal(h.docker.pushes, 1);
    assert.ok(
      h.registry.images.get(
        `${imageRepository(arch)}:${candidateTag(identity)}`
      )
    );
    h.docker.failRemoteSmoke = undefined;
    await h.pipeline.qualify(plan, arch);
    assert.equal(h.docker.pushes, 1);
    assert.equal(h.docker.builds.length, 1);
    assert.equal(h.state().releases[0].addon_version, '3.97.1');
  });
  test(`${arch} local tag replacement fails before push or evidence`, async () => {
    const h = harness();
    const plan = await h.pipeline.prepare(identity);
    const before = structuredClone(h.remote.files);
    h.docker.replacedTag = true;
    await assert.rejects(h.pipeline.qualify(plan, arch), /Local candidate tag/);
    assert.equal(h.docker.pushes, 0);
    assert.deepEqual(h.remote.files, before);
  });
  test(`${arch} valid remote manifest with incompatible config cannot be qualified`, async () => {
    const h = harness();
    const plan = await h.pipeline.prepare(identity);
    const before = structuredClone(h.remote.files);
    const original = h.docker.run;
    h.docker.run = function (args) {
      const result = original.call(this, args);
      if (args[0] === 'push') {
        const image = h.registry.images.get(
          `${imageRepository(arch)}:${candidateTag(identity)}`
        );
        image.config_digest = `sha256:${'9'.repeat(64)}`;
      }
      return result;
    };
    await assert.rejects(
      h.pipeline.qualify(plan, arch),
      /Uploaded candidate differs/
    );
    assert.deepEqual(h.remote.files, before);
    assert.equal(h.docker.tests.length, 1);
  });
}

test('a conflicting candidate appearing after local smoke is never overwritten', async () => {
  const h = harness();
  const plan = await h.pipeline.prepare(identity);
  const before = structuredClone(h.remote.files);
  const smoke = h.docker.smoke;
  const conflictingDigest = `sha256:${'7'.repeat(64)}`;
  h.docker.smoke = function (reference, arch) {
    smoke.call(this, reference, arch);
    if (!reference.includes('@')) {
      h.registry.put(imageRepository(arch), candidateTag(identity), {
        ...structuredClone(this.local),
        digest: conflictingDigest,
        config_digest: `sha256:${'6'.repeat(64)}`
      });
    }
  };
  await assert.rejects(
    h.pipeline.qualify(plan, 'amd64'),
    /Uploaded candidate differs/
  );
  assert.equal(h.docker.pushes, 0);
  assert.deepEqual(h.remote.files, before);
  assert.equal(
    h.registry.images.get(
      `${imageRepository('amd64')}:${candidateTag(identity)}`
    ).digest,
    conflictingDigest
  );
});

test('fresh preparation preserves generation3 and requalifies recorded AMD64 without another commit', async () => {
  const h = harness();
  await h.pipeline.prepare(identity);
  const plan = await h.pipeline.prepare(newer);
  await h.pipeline.qualify(plan, 'amd64');
  assert.equal(h.state().generation, 3);
  const preserved = structuredClone(h.remote.files);
  const commits = h.remote.commits.length;
  const builds = h.docker.builds.length;
  const tests = h.docker.tests.length;
  const fresh = await h.pipeline.prepare(newer);
  assert.equal(fresh.head, h.remote.head);
  await h.pipeline.qualify(fresh, 'amd64');
  assert.deepEqual(h.remote.files, preserved);
  assert.equal(h.state().generation, 3);
  assert.equal(h.remote.commits.length, commits);
  assert.equal(h.docker.builds.length, builds);
  assert.equal(h.docker.tests.length, tests + 1);
  assert.equal(h.state().releases[1].state, 'reserved');
  assert.deepEqual(h.state().releases[1].published, {});
});
