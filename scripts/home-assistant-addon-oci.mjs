import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const architectures = { amd64: 'amd64', aarch64: 'arm64' };
export const sha256 = (bytes) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const accept = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json'
].join(', ');

export class Registry {
  constructor({
    fetcher = fetch,
    actor = process.env.GITHUB_ACTOR,
    token = process.env.GH_TOKEN
  } = {}) {
    this.fetcher = fetcher;
    this.actor = actor;
    this.token = token;
    this.tokens = new Map();
  }

  async request(repository, resource, missing = false) {
    assert.match(
      repository,
      /^piggei\/ghostfolio-ng(?:-ha-(?:amd64|aarch64))?$/
    );
    if (!this.tokens.has(repository)) {
      const headers = {};
      if (this.token)
        headers.Authorization = `Basic ${Buffer.from(`${this.actor}:${this.token}`).toString('base64')}`;
      const response = await this.fetcher(
        `https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`,
        { headers, signal: AbortSignal.timeout(30000) }
      );
      assert.equal(response.status, 200, `GHCR token HTTP ${response.status}`);
      const body = await response.json();
      assert.equal(typeof body.token, 'string');
      this.tokens.set(repository, body.token);
    }
    const response = await this.fetcher(
      `https://ghcr.io/v2/${repository}/${resource}`,
      {
        headers: {
          Authorization: `Bearer ${this.tokens.get(repository)}`,
          Accept: accept
        },
        signal: AbortSignal.timeout(30000)
      }
    );
    if (response.status === 404 && missing) return null;
    assert.equal(response.status, 200, `GHCR HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = sha256(bytes);
    const header = response.headers.get('docker-content-digest');
    if (header) assert.equal(header, actual, 'Registry digest header mismatch');
    const requested = resource.split('/').at(-1);
    if (requested.startsWith('sha256:'))
      assert.equal(actual, requested, 'Content digest mismatch');
    return { digest: actual, body: JSON.parse(bytes.toString()) };
  }

  manifest(repository, reference, missing = false) {
    assert.match(
      reference,
      /^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127})$/
    );
    return this.request(repository, `manifests/${reference}`, missing);
  }

  async image(repository, reference, arch, labels = {}, missing = false) {
    assert.ok(Object.hasOwn(architectures, arch));
    const manifest = await this.manifest(repository, reference, missing);
    if (!manifest) return null;
    assert.equal(manifest.body.schemaVersion, 2);
    assert.ok(!manifest.body.manifests, 'Expected single-platform candidate');
    assert.match(manifest.body.config.digest, digestPattern);
    const config = await this.request(
      repository,
      `blobs/${manifest.body.config.digest}`
    );
    assert.equal(config.body.os, 'linux');
    assert.equal(
      config.body.architecture,
      architectures[arch],
      'Architecture mismatch'
    );
    for (const [key, value] of Object.entries(labels)) {
      assert.equal(
        config.body.config?.Labels?.[key],
        value,
        `Image provenance mismatch: ${key}`
      );
    }
    return {
      os: 'linux',
      architecture: architectures[arch],
      digest: manifest.digest,
      config_digest: config.digest
    };
  }

  async source(identity) {
    const repository = 'piggei/ghostfolio-ng';
    const expected = identity.source_image.split('@')[1];
    const index = await this.manifest(repository, expected);
    assert.equal(index.body.schemaVersion, 2);
    assert.ok(
      Array.isArray(index.body.manifests),
      'Expected multiarchitecture source'
    );
    const runnable = [];
    for (const item of index.body.manifests) {
      if (
        item.platform?.os === 'unknown' &&
        item.platform?.architecture === 'unknown' &&
        item.annotations?.['vnd.docker.reference.type'] ===
          'attestation-manifest'
      )
        continue;
      assert.equal(item.platform?.os, 'linux');
      assert.ok(
        ['amd64', 'arm64'].includes(item.platform?.architecture),
        'Unexpected source platform'
      );
      runnable.push(item);
    }
    assert.deepEqual(runnable.map((m) => m.platform.architecture).sort(), [
      'amd64',
      'arm64'
    ]);
    for (const item of runnable) {
      await this.image(
        repository,
        item.digest,
        item.platform.architecture === 'amd64' ? 'amd64' : 'aarch64',
        {
          'org.opencontainers.image.revision': identity.source_commit
        }
      );
    }
    for (const tag of [
      identity.integration_tag,
      `sha-${identity.source_commit}`
    ]) {
      assert.equal(
        (await this.manifest(repository, tag)).digest,
        expected,
        'NG tag digest mismatch'
      );
    }
  }
}
