// Explicit local-only integration experiment. Never invoked by a release workflow.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  configPath,
  docPaths,
  manifestPath,
  registryPath
} from './home-assistant-addon-github.mjs';
import { Registry } from './home-assistant-addon-oci.mjs';
import {
  candidateTag,
  Docker,
  imageLabels,
  imageRepository,
  Pipeline
} from './home-assistant-addon-pipeline.mjs';
import {
  createRegistry,
  currentManifest,
  serializeRegistry
} from './home-assistant-addon-release.mjs';

const address = process.env.HA_OCI_TEST_REGISTRY;
assert.match(
  address ?? '',
  /^127\.0\.0\.1:[1-9][0-9]{0,4}$/,
  'An explicitly supplied loopback-only disposable registry is required'
);
assert.ok(Number(address.split(':')[1]) <= 65535);
const mode = process.env.HA_OCI_TEST_MODE ?? 'full';
assert.ok(['full', 'metadata'].includes(mode));
const directory = mkdtempSync(join(tmpdir(), 'ha-oci-integration-'));
const evidence = {
  registry: address,
  native_host: process.arch,
  smokes: [],
  writes: []
};
const identity = {
  integration_tag: 'integration-3.97.0-15',
  source_commit: '649d61f90429483cac949c0c97c83d10c13f7c8e',
  source_image:
    'ghcr.io/piggei/ghostfolio-ng@sha256:8ae5031f41e96bebf1fc5a599513c4ba8c0ef33e49171dc45198bcb9cba4e27f',
  ghostfolio_version: '3.97.0',
  addon_source_revision: '4d642df014071b5c72eb731409aef47507cad641'
};
const labels = imageLabels(identity, '3.97.1');
const prefix = 'ghcr.io/piggei/ghostfolio-ng-ha-';
const rewrite = (value) =>
  value.startsWith(prefix) ? value.replace('ghcr.io/', `${address}/`) : value;
const owned = new Set();
class LocalDocker extends Docker {
  run(args) {
    const mapped = args.map(rewrite);
    if (
      args[0] === 'push' ||
      (args[0] === 'buildx' && args[1] === 'imagetools')
    ) {
      const destination =
        args[0] === 'push' ? mapped[1] : mapped[mapped.indexOf('--tag') + 1];
      assert.ok(destination.startsWith(`${address}/piggei/ghostfolio-ng-ha-`));
      evidence.writes.push(destination);
      if (args[0] === 'push') owned.add(destination);
    }
    if (args[0] === 'pull' && mapped[1].startsWith(`${address}/`))
      owned.add(mapped[1]);
    return super.run(mapped);
  }
  build(reference, source, version, arch) {
    owned.add(rewrite(reference));
    if (arch === 'amd64') return super.build(reference, source, version, arch);
    // This cross-build proves metadata/controller behavior only. It cannot stand
    // in for native ARM execution; no production evidence is written by this test.
    const context = join(directory, 'arm-context');
    this.run([
      'buildx',
      'build',
      '--load',
      '--provenance=false',
      '--sbom=false',
      '--platform',
      'linux/arm64',
      '--tag',
      reference,
      ...Object.entries(labels).flatMap(([key, value]) => [
        '--label',
        `${key}=${value}`
      ]),
      context
    ]);
  }
  smoke(reference, arch) {
    if (arch === 'amd64') {
      assert.equal(process.arch, 'x64', 'AMD64 smoke must run natively');
      super.smoke(rewrite(reference), arch);
      evidence.smokes.push({ reference, arch, mode: 'native-full-addon' });
    } else {
      const snapshot = this.localIdentity(rewrite(reference), arch, labels);
      evidence.smokes.push({
        reference,
        arch,
        mode: 'metadata-only',
        snapshot
      });
    }
  }
}
const docker = new LocalDocker();
const sourceRegistry = new Registry({ token: null });
const registry = new Registry({
  token: null,
  fetcher: async (url, options = {}) => {
    assert.equal(options.method ?? 'GET', 'GET');
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'ghcr.io');
    if (parsed.pathname === '/token')
      return new Response(JSON.stringify({ token: 'local-test-only' }));
    assert.ok(parsed.pathname.startsWith('/v2/piggei/ghostfolio-ng-ha-'));
    return fetch(`http://${address}${parsed.pathname}${parsed.search}`, {
      ...options,
      redirect: 'error'
    });
  }
});
registry.source = (value) => sourceRegistry.source(value); // GHCR source reads only.
const initial = createRegistry('3.97.0');
const github = {
  head: '0'.repeat(40),
  commits: [],
  tags: new Map(),
  files: {
    [registryPath]: serializeRegistry(initial),
    [manifestPath]: JSON.stringify(currentManifest(initial), null, 2) + '\n',
    [configPath]: readFileSync(configPath, 'utf8'),
    ...Object.fromEntries(
      docPaths.map((path) => [path, readFileSync(path, 'utf8')])
    )
  },
  async verifySource(value) {
    assert.deepEqual(value, identity);
  },
  async verifyAddonRevision(value) {
    assert.equal(value, identity.addon_source_revision);
  },
  async snapshot(expected) {
    if (expected) assert.equal(expected, this.head);
    return { head: this.head, files: structuredClone(this.files) };
  },
  async checkTag(record) {
    assert.equal(this.tags.has(record.addon_version), false);
  },
  async commit(expected, files, message) {
    assert.equal(expected, this.head);
    this.files = { ...this.files, ...files };
    this.head = String(this.commits.length + 1).padStart(40, '0');
    this.commits.push({ sha: this.head, message, files: Object.keys(files) });
    return this.head;
  },
  async activationCommit() {
    return this.commits.find(
      (c) => c.message === 'Activate Home Assistant 3.97.1'
    ).sha;
  },
  async ensureTag(record, commit) {
    this.tags.set(record.addon_version, commit);
  }
};
try {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(directory, 'arm-context'));
  writeFileSync(
    join(directory, 'arm-context', 'Dockerfile'),
    'FROM scratch\nCOPY payload /payload\n'
  );
  writeFileSync(
    join(directory, 'arm-context', 'payload'),
    'ARM64 metadata fixture only\n'
  );
  const info = JSON.parse(docker.run(['info', '--format', '{{json .}}']));
  evidence.docker = {
    version: info.ServerVersion,
    driver: info.Driver,
    driver_status: info.DriverStatus,
    architecture: info.Architecture
  };
  if (mode === 'metadata') {
    const socket = process.env.HA_OCI_TEST_CLASSIC_HOST;
    assert.match(
      socket ?? '',
      /^unix:\/\/\/tmp\/ghostfolio-task04e-classic-[A-Za-z0-9_-]+\/docker\.sock$/
    );
    class ClassicDocker extends Docker {
      run(args) {
        return execFileSync('docker', ['--host', socket, ...args], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024
        }).trim();
      }
    }
    const classic = new ClassicDocker();
    const classicInfo = JSON.parse(
      classic.run(['info', '--format', '{{json .}}'])
    );
    assert.equal(classicInfo.Driver, 'vfs');
    evidence.classic = {
      version: classicInfo.ServerVersion,
      driver: classicInfo.Driver
    };
    evidence.metadata_matrix = [];
    for (const arch of ['amd64', 'aarch64']) {
      const repository = imageRepository(arch);
      const tag = 'metadata-' + directory.split('/').at(-1) + '-' + arch;
      const reference = address + '/' + repository + ':' + tag;
      owned.add(reference);
      docker.run([
        'buildx',
        'build',
        '--load',
        '--provenance=false',
        '--sbom=false',
        '--platform',
        'linux/' + (arch === 'amd64' ? 'amd64' : 'arm64'),
        '--tag',
        reference,
        ...Object.entries(labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]),
        join(directory, 'arm-context')
      ]);
      const original = docker.localIdentity(reference, arch, labels);
      const archive = join(directory, arch + '.tar');
      docker.run(['image', 'save', '--output', archive, reference]);
      classic.run(['image', 'load', '--input', archive]);
      for (const [name, engine] of [
        ['containerd', docker],
        ['classic', classic]
      ]) {
        const local = engine.localIdentity(reference, arch, labels);
        assert.equal(local.config_digest, original.config_digest);
        const destination = reference + '-' + name;
        try {
          engine.run(['tag', reference, destination]);
          assert.ok(destination.startsWith(address + '/'));
          engine.run(['push', destination]);
          const remote = await registry.image(
            repository,
            tag + '-' + name,
            arch,
            labels
          );
          assert.equal(remote.config_digest, local.config_digest);
          engine.run([
            'pull',
            address + '/' + repository + '@' + remote.digest
          ]);
          evidence.metadata_matrix.push({
            store: name,
            arch,
            local,
            remote,
            native_execution: false
          });
        } finally {
          try {
            engine.run(['image', 'rm', destination]);
          } catch {}
        }
      }
      classic.run(['image', 'rm', reference]);
    }
    evidence.success = true;
  } else {
    const pipeline = new Pipeline({ github, registry, docker });
    let plan = await pipeline.prepare(identity);
    await pipeline.qualify(plan, 'amd64');
    const digest = JSON.parse(github.files[registryPath]).releases[0].qualified
      .amd64.digest;
    const written = evidence.writes.length;
    plan = await pipeline.prepare(identity);
    await pipeline.qualify(plan, 'amd64'); // Recovery must re-smoke, not rebuild/push.
    assert.equal(evidence.writes.length, written);
    assert.equal(JSON.parse(github.files[registryPath]).generation, 2);
    await pipeline.qualify(plan, 'aarch64');
    const result = await pipeline.publish(plan);
    assert.equal(result.publication_status, 'activated');
    const final = JSON.parse(github.files[registryPath]);
    assert.equal(final.releases[0].published.amd64.digest, digest);
    assert.equal(final.generation, 6);
    assert.equal(final.releases.length, 1);
    evidence.final_registry = final;
    evidence.commits = github.commits;
    evidence.result = result;
    for (const arch of ['amd64', 'aarch64']) {
      const candidate = await registry.image(
        imageRepository(arch),
        candidateTag(identity),
        arch,
        labels
      );
      const published = await registry.image(
        imageRepository(arch),
        '3.97.1',
        arch,
        labels
      );
      assert.deepEqual(candidate, published);
      evidence[arch] = { candidate, published };
    }
    evidence.success = true;
  }
} catch (error) {
  evidence.success = false;
  evidence.error = String(error);
  throw error;
} finally {
  const destination = process.env.HA_OCI_TEST_REPORT;
  if (destination)
    writeFileSync(destination, JSON.stringify(evidence, null, 2));
  for (const reference of owned) {
    try {
      execFileSync('docker', ['image', 'rm', reference], { stdio: 'ignore' });
    } catch {
      /* only owned test references, possibly already removed */
    }
  }
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  mode === 'full'
    ? 'Local registry E2E PASS; AMD64 native full add-on; ARM64 metadata only.'
    : 'Real classic/containerd metadata and local push/pull matrix PASS; no native execution.'
);
