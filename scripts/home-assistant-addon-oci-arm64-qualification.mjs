// Native ARM64 qualification only. No GitHub publication or release allocation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Registry } from './home-assistant-addon-oci.mjs';
import { Docker, imageLabels } from './home-assistant-addon-pipeline.mjs';

export function validateNativeArm64(architecture, machine, address) {
  assert.equal(architecture, 'arm64', 'Native ARM64 Node is required');
  assert.equal(machine, 'aarch64', 'Native ARM64 host is required');
  assert.equal(typeof address, 'string');
  assert.ok(!/\s/.test(address));
  assert.match(
    address,
    /^127\.0\.0\.1:[1-9][0-9]{0,4}$/,
    'Loopback-only test registry required'
  );
  assert.ok(Number(address.split(':')[1]) <= 65535);
  return address;
}

export async function main(env = process.env) {
  // These checks precede Docker commands, registry requests and image execution.
  assert.equal(process.arch, 'arm64', 'Native ARM64 Node is required');
  const address = validateNativeArm64(
    process.arch,
    execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim(),
    env.HA_OCI_TEST_REGISTRY
  );
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://${address}/v2/`, {
        redirect: 'error',
        signal: AbortSignal.timeout(2000)
      });
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* disposable registry may still be starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Local registry did not become ready');
  const source = JSON.parse(
    readFileSync('home-assistant-addon/test-source.json', 'utf8')
  );
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8'
  }).trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const identity = {
    integration_tag: 'integration-3.97.0-15',
    source_commit: '649d61f90429483cac949c0c97c83d10c13f7c8e',
    source_image: source.source_image,
    ghostfolio_version: '3.97.0',
    addon_source_revision: revision
  };
  // Existing NG image is a read-only test input, never a new release request.
  await new Registry({ token: null }).source(identity);
  const fixtureVersion = '3.97.2';
  const labels = imageLabels(identity, fixtureVersion);
  const repository = 'piggei/ghostfolio-ng-ha-aarch64';
  const tag = 'native-arm64-test-' + randomUUID();
  const candidate = `${address}/${repository}:${tag}`;
  const promoted = `${address}/${repository}:${tag}-promoted`;
  const docker = new Docker();
  const evidence = {
    native_architecture: process.arch,
    registry: address,
    controller_revision: revision,
    source_image: identity.source_image,
    fixture_version: fixtureVersion,
    production_allocation: false,
    smokes: []
  };
  const registry = new Registry({
    token: null,
    fetcher: async (url, options = {}) => {
      assert.equal(options.method ?? 'GET', 'GET');
      const parsed = new URL(url);
      assert.equal(parsed.hostname, 'ghcr.io');
      if (parsed.pathname === '/token')
        return new Response(JSON.stringify({ token: 'local-test-only' }));
      assert.ok(parsed.pathname.startsWith(`/v2/${repository}/`));
      return fetch(`http://${address}${parsed.pathname}${parsed.search}`, {
        ...options,
        redirect: 'error'
      });
    }
  });
  const owned = new Set([candidate, promoted]);
  try {
    assert.equal(await registry.manifest(repository, tag, true), null);
    docker.build(candidate, identity, fixtureVersion, 'aarch64');
    const local = docker.localIdentity(candidate, 'aarch64', labels);
    evidence.local = local;
    docker.smoke(local.handle, 'aarch64');
    evidence.smokes.push({
      reference: local.handle,
      mode: 'native-full-addon'
    });
    docker.assertLocalReference(candidate, local, 'aarch64');
    assert.equal(await registry.manifest(repository, tag, true), null);
    docker.run(['push', candidate]);
    const remote = await registry.image(repository, tag, 'aarch64', labels);
    assert.equal(remote.config_digest, local.config_digest);
    docker.assertLocalReference(candidate, local, 'aarch64');
    const immutable = `${address}/${repository}@${remote.digest}`;
    owned.add(immutable);
    docker.run(['pull', immutable]);
    docker.smoke(immutable, 'aarch64');
    evidence.smokes.push({ reference: immutable, mode: 'native-full-addon' });
    assert.deepEqual(
      await registry.image(repository, remote.digest, 'aarch64', labels),
      remote
    );
    docker.run([
      'buildx',
      'imagetools',
      'create',
      '--prefer-index=false',
      '--tag',
      promoted,
      immutable
    ]);
    const final = await registry.image(
      repository,
      tag + '-promoted',
      'aarch64',
      labels
    );
    assert.deepEqual(final, remote);
    evidence.candidate = remote;
    evidence.promoted = final;
    evidence.success = true;
  } catch (error) {
    evidence.success = false;
    evidence.error = String(error);
    throw error;
  } finally {
    if (env.HA_OCI_ARM64_REPORT)
      writeFileSync(env.HA_OCI_ARM64_REPORT, JSON.stringify(evidence, null, 2));
    for (const reference of owned) {
      try {
        execFileSync('docker', ['image', 'rm', reference], { stdio: 'ignore' });
      } catch {
        /* test references only */
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
