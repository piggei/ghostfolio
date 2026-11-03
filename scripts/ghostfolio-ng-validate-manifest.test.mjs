import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateManifest } from './ghostfolio-ng-validate-manifest.mjs';

const AMD64 = `sha256:${'a'.repeat(64)}`;
const ARM64 = `sha256:${'b'.repeat(64)}`;
const OTHER = `sha256:${'c'.repeat(64)}`;

const OCI = 'application/vnd.oci.image.index.v1+json';
const DOCKER = 'application/vnd.docker.distribution.manifest.list.v2+json';

function executable(architecture, digest, os = 'linux') {
  return {
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    digest,
    platform: { os, architecture }
  };
}

function attestation(digest = OTHER) {
  return {
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    digest,
    platform: { os: 'unknown', architecture: 'unknown' },
    annotations: {
      'vnd.docker.reference.type': 'attestation-manifest',
      'vnd.docker.reference.digest': AMD64
    }
  };
}

function index(manifests, mediaType = OCI) {
  return { schemaVersion: 2, mediaType, manifests };
}

function valid() {
  return index([executable('amd64', AMD64), executable('arm64', ARM64)]);
}

function check(manifest, amd64 = AMD64, arm64 = ARM64) {
  return validateManifest(manifest, amd64, arm64);
}

test('accepts valid OCI index', () => {
  assert.equal(check(valid()), true);
});

test('accepts Docker manifest list', () => {
  const value = valid();
  value.mediaType = DOCKER;
  assert.equal(check(value), true);
});

test('accepts reversed architecture order', () => {
  const value = valid();
  value.manifests.reverse();
  assert.equal(check(value), true);
});

test('accepts recognized OCI attestation', () => {
  const value = valid();
  value.manifests.push(attestation());
  assert.equal(check(value), true);
});

test('rejects missing AMD64', () => {
  assert.throws(
    () => check(index([executable('arm64', ARM64)])),
    /Missing required architecture/
  );
});

test('rejects missing ARM64', () => {
  assert.throws(
    () => check(index([executable('amd64', AMD64)])),
    /Missing required architecture/
  );
});

test('rejects duplicate architecture', () => {
  const value = valid();
  value.manifests.push(executable('amd64', AMD64));
  assert.throws(() => check(value), /Duplicate platform/);
});

test('rejects additional architecture', () => {
  const value = valid();
  value.manifests.push(executable('ppc64le', OTHER));
  assert.throws(() => check(value), /Unexpected executable platform/);
});

test('rejects unexpected operating system', () => {
  const value = valid();
  value.manifests.push(executable('amd64', OTHER, 'windows'));
  assert.throws(() => check(value), /Unexpected executable platform/);
});

test('rejects incorrect AMD64 digest', () => {
  const value = valid();
  value.manifests[0].digest = OTHER;
  assert.throws(() => check(value), /Unexpected digest for linux\/amd64/);
});

test('rejects incorrect ARM64 digest', () => {
  const value = valid();
  value.manifests[1].digest = OTHER;
  assert.throws(() => check(value), /Unexpected digest for linux\/arm64/);
});

test('rejects duplicate expected digests', () => {
  assert.throws(
    () => check(valid(), AMD64, AMD64),
    /Invalid or duplicate expected digest/
  );
});

test('rejects malformed expected digest', () => {
  assert.throws(
    () => check(valid(), 'invalid', ARM64),
    /Invalid or duplicate expected digest/
  );
});

test('rejects unsupported index type', () => {
  const value = valid();
  value.mediaType = 'application/json';
  assert.throws(() => check(value), /Invalid multi-platform image index/);
});

test('rejects malformed index structure', () => {
  assert.throws(
    () => check({ mediaType: OCI }),
    /Invalid multi-platform image index/
  );
});

test('rejects unrecognized unknown-platform manifest', () => {
  const value = valid();
  value.manifests.push({
    digest: OTHER,
    platform: { os: 'unknown', architecture: 'unknown' }
  });
  assert.throws(() => check(value), /Unexpected unknown-platform manifest/);
});

test('rejects invalid attestation digest', () => {
  const value = valid();
  value.manifests.push(attestation('invalid'));
  assert.throws(() => check(value), /Invalid attestation digest/);
});

test('rejects empty index', () => {
  assert.throws(() => check(index([])), /Missing required architecture/);
});

test('rejects attestation referencing an unknown digest', () => {
  const value = valid();
  const entry = attestation();

  entry.annotations['vnd.docker.reference.digest'] = OTHER;
  value.manifests.push(entry);

  assert.throws(() => check(value), /Invalid attestation reference/);
});

test('rejects attestation without reference digest', () => {
  const value = valid();
  const entry = attestation();

  delete entry.annotations['vnd.docker.reference.digest'];
  value.manifests.push(entry);

  assert.throws(() => check(value), /Invalid attestation reference/);
});

test('accepts attestation referencing ARM64', () => {
  const value = valid();
  const entry = attestation();

  entry.annotations['vnd.docker.reference.digest'] = ARM64;
  value.manifests.push(entry);

  assert.equal(check(value), true);
});
