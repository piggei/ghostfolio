import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  configPath,
  docPaths,
  manifestPath,
  registryPath
} from './home-assistant-addon-github.mjs';
import { architectures } from './home-assistant-addon-oci.mjs';
import {
  activateRelease,
  compareVersions,
  currentManifest,
  recordImage,
  registryRevision,
  reserveRelease,
  saveRegistry,
  serializeRegistry,
  validateIdentity,
  validateRegistry
} from './home-assistant-addon-release.mjs';

export const identityHash = (identity) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(Object.entries(validateIdentity(identity)).sort())
      )
    )
    .digest('hex');
export const imageRepository = (arch) => {
  assert.ok(Object.hasOwn(architectures, arch));
  return `piggei/ghostfolio-ng-ha-${arch}`;
};
export const candidateTag = (identity) => `candidate-${identityHash(identity)}`;
export const imageLabels = (identity, version) => ({
  'io.ghostfolio.ha.identity': identityHash(identity),
  'io.ghostfolio.ha.source': identity.source_image,
  'org.opencontainers.image.revision': identity.addon_source_revision,
  'org.opencontainers.image.version': version,
  'org.opencontainers.image.source': 'https://github.com/piggei/ghostfolio'
});
const descriptor = ({ os, architecture, digest }) => ({
  os,
  architecture,
  digest
});
const recordFor = (registry, identity) =>
  registry.releases.find(
    (r) => r.identity.integration_tag === identity.integration_tag
  );
const json = (value) => JSON.stringify(value, null, 2) + '\n';

export function activationFiles(snapshot, registry) {
  const manifest = currentManifest(registry);
  assert.equal(manifest.state, 'activated');
  const config = snapshot.files[configPath];
  assert.equal((config.match(/^version:.*$/gm) ?? []).length, 1);
  const files = {
    [registryPath]: serializeRegistry(registry),
    [manifestPath]: json(manifest),
    [configPath]: config.replace(
      /^version:.*$/m,
      `version: "${manifest.addon_version}"`
    )
  };
  for (const path of docPaths) {
    const original = snapshot.files[path];
    const marker =
      /<!-- release-current:start -->[\s\S]*?<!-- release-current:end -->/g;
    assert.equal(
      [...original.matchAll(marker)].length,
      1,
      `Missing unique current release marker in ${path}`
    );
    files[path] = original.replace(
      marker,
      `<!-- release-current:start -->\nCurrent add-on version: **${manifest.addon_version}**.\nGhostfolio NG: \`${manifest.identity.integration_tag}\`.\nSource image: \`${manifest.identity.source_image}\`.\n<!-- release-current:end -->`
    );
  }
  return files;
}

export class Docker {
  run(args) {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    }).trim();
  }
  build(reference, identity, version, arch) {
    this.run([
      'buildx',
      'build',
      '--load',
      '--provenance=false',
      '--sbom=false',
      '--platform',
      `linux/${architectures[arch]}`,
      '--tag',
      reference,
      '--build-arg',
      `BUILD_ARCH=${arch}`,
      '--build-arg',
      `GHOSTFOLIO_IMAGE=${identity.source_image}`,
      ...Object.entries(imageLabels(identity, version)).flatMap(([k, v]) => [
        '--label',
        `${k}=${v}`
      ]),
      'home-assistant-addon'
    ]);
  }
  smoke(reference, arch) {
    execFileSync(
      'bash',
      [
        'scripts/home-assistant-addon-smoke-test.sh',
        reference,
        architectures[arch]
      ],
      { stdio: 'inherit' }
    );
  }
}

export class Pipeline {
  constructor({ github, registry, docker = new Docker() }) {
    this.github = github;
    this.registry = registry;
    this.docker = docker;
  }

  async snapshot(plan) {
    const snapshot = await this.github.snapshot(plan?.head);
    snapshot.registry = validateRegistry(
      JSON.parse(snapshot.files[registryPath])
    );
    assert.deepEqual(
      JSON.parse(snapshot.files[manifestPath]),
      currentManifest(snapshot.registry),
      'Current manifest does not match registry'
    );
    const advertised = currentManifest(snapshot.registry).addon_version;
    assert.ok(
      snapshot.files[configPath].includes(`version: "${advertised}"`),
      'Advertised version mismatch'
    );
    return snapshot;
  }

  async verify(identity) {
    validateIdentity(identity);
    await this.github.verifySource(identity);
    await this.registry.source(identity);
  }

  async persist(plan, operation, activation = false) {
    const snapshot = await this.snapshot(plan);
    const next = operation(snapshot.registry);
    if (isDeepStrictEqual(next, snapshot.registry)) return snapshot.registry;
    await this.github.verifyAddonRevision(
      plan.identity.addon_source_revision,
      snapshot.head
    );
    const temporary = mkdtempSync(join(tmpdir(), 'ha-transition-'));
    try {
      const path = join(temporary, 'registry.json');
      writeFileSync(path, serializeRegistry(snapshot.registry));
      saveRegistry(path, registryRevision(snapshot.registry), next);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    const record = recordFor(next, plan.identity);
    const files = activation
      ? activationFiles(snapshot, next)
      : { [registryPath]: serializeRegistry(next) };
    plan.head = await this.github.commit(
      snapshot.head,
      files,
      activation
        ? `Activate Home Assistant ${record.addon_version}`
        : `Record Home Assistant ${record.addon_version} ${next.generation}`
    );
    return next;
  }

  async prepare(identity, tag) {
    await this.verify(identity);
    const snapshot = await this.snapshot();
    if (!snapshot.registry.releases.length) {
      assert.ok(
        compareVersions(
          identity.ghostfolio_version,
          snapshot.registry.baseline_version
        ) >= 0,
        'Initial upstream regression'
      );
    }
    const proposed = reserveRelease(snapshot.registry, identity);
    const record = recordFor(proposed, identity);
    await this.github.checkTag(record);
    if (record.state !== 'activated')
      await this.github.verifyAddonRevision(
        identity.addon_source_revision,
        snapshot.head
      );
    if (tag) {
      assert.equal(tag, `home-assistant-addon/v${record.addon_version}`);
      assert.equal(
        record.state,
        'activated',
        'Tag entry point requires an activated manifest'
      );
    }
    const plan = {
      schema_version: 1,
      identity,
      head: snapshot.head,
      addon_version: record.addon_version,
      terminal: record.state === 'activated'
    };
    await this.persist(plan, (r) => reserveRelease(r, identity));
    return plan;
  }

  async qualify(plan, arch) {
    await this.verify(plan.identity);
    const snapshot = await this.snapshot(plan);
    const record = recordFor(snapshot.registry, plan.identity);
    assert.ok(record);
    assert.deepEqual(record.identity, plan.identity);
    assert.equal(record.addon_version, plan.addon_version);
    if (record.state === 'activated') return;
    const repository = imageRepository(arch);
    const labels = imageLabels(plan.identity, record.addon_version);
    const tag = candidateTag(plan.identity);
    let image = record.qualified[arch]
      ? await this.registry.image(
          repository,
          record.qualified[arch].digest,
          arch,
          labels
        )
      : await this.registry.image(repository, tag, arch, labels, true);
    let reference;
    if (image) {
      if (record.qualified[arch])
        assert.deepEqual(descriptor(image), record.qualified[arch]);
      reference = `ghcr.io/${repository}@${image.digest}`;
      this.docker.run(['pull', reference]);
      this.docker.smoke(reference, arch);
    } else {
      reference = `ghcr.io/${repository}:${tag}`;
      this.docker.build(reference, plan.identity, record.addon_version, arch);
      this.docker.smoke(reference, arch);
      const localConfig = this.docker.run([
        'image',
        'inspect',
        reference,
        '--format',
        '{{.Id}}'
      ]);
      // Recheck immediately before writing; never replace an existing candidate.
      image = await this.registry.image(repository, tag, arch, labels, true);
      if (!image) {
        try {
          this.docker.run(['push', reference]);
        } catch (error) {
          image = await this.registry.image(
            repository,
            tag,
            arch,
            labels,
            true
          );
          if (!image) throw error;
        }
      }
      image ??= await this.registry.image(repository, tag, arch, labels);
      assert.equal(
        image.config_digest,
        localConfig,
        'Uploaded candidate differs from tested local image'
      );
    }
    await this.persist(plan, (r) =>
      recordImage(r, plan.identity, 'qualified', arch, descriptor(image))
    );
  }

  async publish(plan) {
    await this.verify(plan.identity);
    let snapshot = await this.snapshot(plan);
    let record = recordFor(snapshot.registry, plan.identity);
    assert.ok(record);
    assert.deepEqual(record.identity, plan.identity);
    assert.equal(record.addon_version, plan.addon_version);
    const labels = imageLabels(plan.identity, record.addon_version);
    await this.github.checkTag(record);
    assert.ok(
      ['qualified', 'published', 'activated'].includes(record.state),
      'Both architectures must be qualified'
    );
    for (const arch of Object.keys(architectures)) {
      assert.ok(record.qualified[arch], 'Both architectures must be qualified');
      assert.deepEqual(
        descriptor(
          await this.registry.image(
            imageRepository(arch),
            record.qualified[arch].digest,
            arch,
            labels
          )
        ),
        record.qualified[arch]
      );
    }
    for (const arch of Object.keys(architectures)) {
      const repository = imageRepository(arch);
      assert.ok(record.qualified[arch], 'Both architectures must be qualified');
      const expected = record.qualified[arch];
      assert.deepEqual(
        descriptor(
          await this.registry.image(repository, expected.digest, arch, labels)
        ),
        expected
      );
      let final = await this.registry.image(
        repository,
        record.addon_version,
        arch,
        labels,
        true
      );
      if (!final) {
        assert.notEqual(
          record.state,
          'activated',
          'Activated image is missing; manual intervention required'
        );
        await this.github.snapshot(plan.head);
        try {
          this.docker.run([
            'buildx',
            'imagetools',
            'create',
            '--prefer-index=false',
            '--tag',
            `ghcr.io/${repository}:${record.addon_version}`,
            `ghcr.io/${repository}@${expected.digest}`
          ]);
        } catch (error) {
          final = await this.registry.image(
            repository,
            record.addon_version,
            arch,
            labels,
            true
          );
          if (!final) throw error;
        }
        final ??= await this.registry.image(
          repository,
          record.addon_version,
          arch,
          labels
        );
      }
      assert.deepEqual(
        descriptor(final),
        expected,
        'Conflicting final image digest'
      );
      if (record.published[arch])
        assert.deepEqual(record.published[arch], expected);
      const registry = await this.persist(plan, (r) =>
        recordImage(r, plan.identity, 'published', arch, descriptor(final))
      );
      record = recordFor(registry, plan.identity);
    }
    // Verify both final tags again immediately before the metadata transaction.
    for (const arch of Object.keys(architectures)) {
      assert.deepEqual(
        descriptor(
          await this.registry.image(
            imageRepository(arch),
            record.addon_version,
            arch,
            labels
          )
        ),
        record.published[arch]
      );
    }
    const already = record.state === 'activated';
    const registry = await this.persist(
      plan,
      (r) => activateRelease(r, plan.identity),
      true
    );
    record = recordFor(registry, plan.identity);
    const metadataCommit = await this.github.activationCommit(record);
    await this.github.ensureTag(record, metadataCommit);
    return {
      addon_version: record.addon_version,
      amd64_digest: record.published.amd64.digest,
      aarch64_digest: record.published.aarch64.digest,
      metadata_commit: metadataCommit,
      publication_status: already ? 'already_activated' : 'activated'
    };
  }
}
