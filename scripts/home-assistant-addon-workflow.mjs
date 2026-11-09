import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { GitHub, manifestPath } from './home-assistant-addon-github.mjs';
import { Registry, architectures } from './home-assistant-addon-oci.mjs';
import { Docker, Pipeline } from './home-assistant-addon-pipeline.mjs';
import { validateIdentity } from './home-assistant-addon-release.mjs';

export function inputIdentity(env) {
  return validateIdentity(
    Object.fromEntries(
      [
        'integration_tag',
        'source_commit',
        'source_image',
        'ghostfolio_version',
        'addon_source_revision'
      ].map((key) => [key, env[`INPUT_${key.toUpperCase()}`] ?? ''])
    )
  );
}

export function isTagRecovery(env) {
  // A reusable workflow retains its caller's event (often an integration push).
  // Explicit inputs always take precedence over the legacy tag entry point.
  const supplied = [
    'integration_tag',
    'source_commit',
    'source_image',
    'ghostfolio_version',
    'addon_source_revision'
  ].some((key) => env[`INPUT_${key.toUpperCase()}`]);
  return (
    !supplied &&
    env.GITHUB_EVENT_NAME === 'push' &&
    Boolean(env.GITHUB_REF?.startsWith('refs/tags/home-assistant-addon/v'))
  );
}

export function testSource(input, manifest, fallback) {
  const source =
    input || manifest.identity?.source_image || fallback.source_image;
  assert.equal(typeof source, 'string');
  assert.match(source, /^ghcr\.io\/piggei\/ghostfolio-ng@sha256:[a-f0-9]{64}$/);
  assert.equal(
    source.length,
    'ghcr.io/piggei/ghostfolio-ng@sha256:'.length + 64
  );
  return source;
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  for (const [key, value] of Object.entries(values)) {
    assert.ok(!/[\r\n]/.test(String(value)));
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

export async function main(command, planPath, arch) {
  const github = new GitHub();
  const registry = new Registry();
  const pipeline = new Pipeline({ github, registry });
  if (command === 'test') {
    assert.ok(Object.hasOwn(architectures, planPath));

    execFileSync(
      process.execPath,
      ['--test', 'scripts/home-assistant-addon-ingress-rewrite.test.mjs'],
      { stdio: 'inherit' }
    );

    const source = testSource(
      process.env.SOURCE_IMAGE,
      JSON.parse(readFileSync(manifestPath)),
      JSON.parse(readFileSync('home-assistant-addon/test-source.json'))
    );
    const docker = new Docker();
    const image = `ghostfolio-ng-ha:${planPath}-test`;
    docker.run([
      'buildx',
      'build',
      '--load',
      '--provenance=false',
      '--sbom=false',
      '--platform',
      `linux/${architectures[planPath]}`,
      '--tag',
      image,
      '--build-arg',
      `BUILD_ARCH=${planPath}`,
      '--build-arg',
      `GHOSTFOLIO_IMAGE=${source}`,
      'home-assistant-addon'
    ]);
    docker.smoke(image, planPath);
    return;
  }
  assert.equal(process.env.GITHUB_REPOSITORY, 'piggei/ghostfolio');
  assert.ok(process.env.GH_TOKEN, 'GH_TOKEN is required');
  let plan;
  if (command === 'prepare') {
    let identity;
    const tag = isTagRecovery(process.env)
      ? process.env.GITHUB_REF_NAME
      : undefined;
    if (tag) {
      assert.match(tag, /^home-assistant-addon\/v[0-9]+\.[0-9]+\.[0-9]+$/);
      const commit = await github.resolveTag(tag);
      assert.equal(commit, process.env.GITHUB_SHA);
      const manifest = JSON.parse(await github.file(manifestPath, commit));
      assert.equal(
        manifest.state,
        'activated',
        'Legacy tag has no release contract; use explicit recovery inputs'
      );
      identity = validateIdentity(manifest.identity);
    } else identity = inputIdentity(process.env);
    plan = await pipeline.prepare(identity, tag);
    output({
      addon_source_revision: identity.addon_source_revision,
      addon_version: plan.addon_version,
      terminal: plan.terminal
    });
  } else {
    plan = JSON.parse(readFileSync(planPath));
    validateIdentity(plan.identity);
    assert.equal(plan.schema_version, 1);
    assert.match(plan.head, /^[a-f0-9]{40}$/);
    if (command === 'qualify') await pipeline.qualify(plan, arch);
    else if (command === 'publish') output(await pipeline.publish(plan));
    else throw new Error('Unknown workflow command');
  }
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(...process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
