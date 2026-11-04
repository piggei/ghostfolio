import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPOSITORY = 'piggei/ghostfolio';
export const DEFAULT_BRANCH = 'main';
export const NG_BRANCH = 'integration/ghostfolio-all-pr';
export const NG_WORKFLOW = '.github/workflows/integration-release.yml';
export const NG_WORKFLOW_NAME = 'Publish integration Docker release';
export const HA_REVISION = '4d642df014071b5c72eb731409aef47507cad641';
export const HA_WORKFLOW = '.github/workflows/home-assistant-addon.yml';
export const SOURCE_REPOSITORY = 'piggei/ghostfolio-ng';

function positive(value) {
  assert.ok(
    Number.isSafeInteger(value) && value > 0,
    'Invalid positive integer'
  );
  return value;
}

function sha(value) {
  assert.equal(typeof value, 'string', 'Invalid commit');
  assert.equal(value.length, 40, 'Invalid commit length');
  assert.match(value, /^[a-f0-9]{40}$/, 'Invalid commit');
  return value;
}

export function runIdentity(run, workflowId) {
  assert.ok(run && typeof run === 'object', 'Missing workflow run');
  assert.equal(
    run.head_repository?.full_name,
    REPOSITORY,
    'Unexpected source repository'
  );
  if (run.repository !== undefined)
    assert.equal(
      run.repository.full_name,
      REPOSITORY,
      'Unexpected run repository'
    );
  assert.equal(run.head_branch, NG_BRANCH, 'Unexpected source branch');
  assert.equal(run.path, NG_WORKFLOW, 'Unexpected source workflow');
  assert.equal(run.name, NG_WORKFLOW_NAME, 'Unexpected workflow name');
  assert.ok(
    ['push', 'workflow_dispatch'].includes(run.event),
    'Unexpected NG trigger'
  );
  assert.equal(run.status, 'completed', 'NG run is incomplete');
  assert.equal(run.conclusion, 'success', 'NG run did not succeed');
  positive(run.workflow_id);
  if (workflowId !== undefined)
    assert.equal(run.workflow_id, workflowId, 'Unexpected workflow ID');
  return {
    id: positive(run.id),
    attempt: positive(run.run_attempt),
    number: positive(run.run_number),
    commit: sha(run.head_sha),
    workflow_id: run.workflow_id
  };
}

export function eventRequest(event, eventName, context = {}) {
  assert.equal(context.repository, REPOSITORY, 'Unexpected caller repository');
  assert.equal(
    context.ref,
    `refs/heads/${DEFAULT_BRANCH}`,
    'Orchestrator must run on fork default branch'
  );
  sha(context.sha);
  assert.equal(
    event.repository?.full_name,
    REPOSITORY,
    'Unexpected event repository'
  );
  assert.equal(
    event.repository?.default_branch,
    DEFAULT_BRANCH,
    'Unexpected default branch'
  );
  if (eventName === 'workflow_run') {
    assert.equal(event.action, 'completed', 'Unexpected workflow_run action');
    const run = runIdentity(event.workflow_run);
    if (event.workflow !== undefined && event.workflow !== null) {
      assert.equal(
        event.workflow.path,
        NG_WORKFLOW,
        'Inconsistent event workflow'
      );
      assert.equal(
        event.workflow.name,
        NG_WORKFLOW_NAME,
        'Inconsistent event workflow name'
      );
      assert.equal(
        event.workflow.id,
        run.workflow_id,
        'Inconsistent event workflow ID'
      );
    }
    return { ...run, recovery: false };
  }
  assert.equal(
    eventName,
    'workflow_dispatch',
    'Unexpected orchestrator trigger'
  );
  const input = event.inputs?.ng_run_id;
  assert.equal(typeof input, 'string', 'Missing recovery run ID');
  assert.ok(
    /^[1-9][0-9]*$/.test(input) && !/\s/.test(input),
    'Invalid recovery run ID'
  );
  return { id: positive(Number(input)), recovery: true };
}

export function releaseIdentity(version, run, release) {
  assert.equal(typeof version, 'string');
  assert.ok(
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) &&
      !/\s/.test(version),
    'Invalid application version'
  );
  const tag = `integration-${version}-${run.number}`;
  assert.equal(release?.tag_name, tag, 'Release tag does not match run');
  assert.equal(release.draft, false, 'Draft release');
  assert.equal(release.prerelease, false, 'Unexpected prerelease');
  assert.equal(
    release.target_commitish,
    run.commit,
    'Release target does not match run'
  );
  assert.equal(
    typeof release.published_at,
    'string',
    'Release is not published'
  );
  assert.ok(
    Number.isFinite(Date.parse(release.published_at)),
    'Invalid publication date'
  );
  assert.equal(typeof release.body, 'string', 'Missing release metadata');
  const metadata = [
    `- Source commit: [${run.commit.slice(0, 9)}](https://github.com/${REPOSITORY}/commit/${run.commit})`,
    `- Docker image: \`ghcr.io/${SOURCE_REPOSITORY}:${tag}\``,
    `- Immutable commit tag: \`ghcr.io/${SOURCE_REPOSITORY}:sha-${run.commit}\``,
    '- Supported architectures: Linux AMD64 and ARM64'
  ];
  const lines = release.body.split(/\r?\n/);
  for (const line of metadata) {
    const field = line.slice(0, line.indexOf(':') + 1);
    assert.deepEqual(
      lines.filter((value) => value.trimStart().startsWith(field)),
      [line],
      'Missing, conflicting or ambiguous release metadata'
    );
  }
  // Digest is filled from GHCR only after the GitHub release has been bound.
  return {
    integration_tag: tag,
    source_commit: run.commit,
    ghostfolio_version: version,
    addon_source_revision: HA_REVISION
  };
}

export function disposition(registry, identity, contract) {
  contract.validateRegistry(registry);
  contract.validateIdentity(identity);
  const number = (tag) => BigInt(tag.split('-').at(-1));
  const existing = registry.releases.find(
    (r) => r.identity.integration_tag === identity.integration_tag
  );
  if (existing)
    assert.deepEqual(
      existing.identity,
      identity,
      'Conflicting HA release identity'
    );
  const latest = registry.releases.at(-1);
  if (
    latest &&
    number(latest.identity.integration_tag) === number(identity.integration_tag)
  ) {
    assert.equal(
      latest.identity.integration_tag,
      identity.integration_tag,
      'Conflicting NG run number'
    );
  }
  if (existing?.state === 'activated') return 'recover_activated';
  if (
    latest &&
    number(identity.integration_tag) < number(latest.identity.integration_tag)
  )
    return 'superseded';
  if (!latest)
    assert.ok(
      contract.compareVersions(
        identity.ghostfolio_version,
        registry.baseline_version
      ) >= 0,
      'Initial application regression'
    );
  // Plan through the approved machine without saving or allocating anything.
  contract.reserveRelease(registry, identity);
  return existing ? 'resume' : 'new_release';
}

export function readOnlyFetch(fetcher = fetch) {
  return async (url, options = {}) => {
    assert.equal(
      options.method ?? 'GET',
      'GET',
      'Validator cannot mutate remote state'
    );
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.ok(
      ['api.github.com', 'ghcr.io'].includes(parsed.hostname),
      'Unexpected API host'
    );
    assert.equal(parsed.username, '');
    assert.equal(parsed.password, '');
    assert.equal(parsed.port, '');
    assert.equal(parsed.hash, '');
    if (parsed.hostname === 'api.github.com')
      assert.ok(
        parsed.pathname.startsWith(`/repos/${REPOSITORY}/`),
        'Unexpected API repository'
      );
    else
      assert.ok(
        parsed.pathname === '/token' ||
          parsed.pathname.startsWith(`/v2/${SOURCE_REPOSITORY}/`),
        'Unexpected registry path'
      );
    assert.equal(options.body, undefined, 'Read-only request has a body');
    // Redirects are unnecessary for the GitHub/manifest endpoints. Config blobs
    // may redirect inside GHCR; validate the target and strip credentials there.
    const response = await fetcher(url, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    assert.equal(parsed.hostname, 'ghcr.io', 'Unexpected GitHub redirect');
    assert.ok(
      parsed.pathname.startsWith(`/v2/${SOURCE_REPOSITORY}/blobs/`),
      'Unexpected manifest redirect'
    );
    const location = response.headers.get('location');
    assert.ok(
      typeof location === 'string' && location.length > 0,
      'Missing redirect location'
    );
    const target = new URL(location, url);
    assert.equal(target.protocol, 'https:');
    assert.ok(
      target.hostname === 'ghcr.io' ||
        target.hostname === 'pkg-containers.githubusercontent.com',
      'Unexpected blob redirect host'
    );
    assert.equal(target.username, '');
    assert.equal(target.password, '');
    assert.equal(target.port, '');
    assert.equal(target.hash, '');
    return fetcher(target.href, {
      method: 'GET',
      redirect: 'error',
      signal: options.signal
    });
  };
}

export async function loadContract(
  directory = 'ha-contract',
  fetcher = fetch,
  env = process.env
) {
  const moduleAt = (name) =>
    import(pathToFileURL(resolve(directory, 'scripts', name)).href);
  const [{ GitHub }, { Registry }, contract] = await Promise.all([
    moduleAt('home-assistant-addon-github.mjs'),
    moduleAt('home-assistant-addon-oci.mjs'),
    moduleAt('home-assistant-addon-release.mjs')
  ]);
  const transport = readOnlyFetch(fetcher);
  return {
    github: new GitHub({ fetcher: transport, token: env.GH_TOKEN }),
    registry: new Registry({
      fetcher: transport,
      token: env.GH_TOKEN,
      actor: env.GITHUB_ACTOR
    }),
    contract
  };
}

export async function resolveRelease({
  event,
  eventName,
  context,
  github,
  registry,
  contract
}) {
  const request = eventRequest(event, eventName, context);
  const workflow = await github.api(
    'actions/workflows/integration-release.yml'
  );
  assert.equal(workflow.path, NG_WORKFLOW);
  assert.equal(workflow.name, NG_WORKFLOW_NAME);
  positive(workflow.id);
  const readRun = async () => {
    const value = await github.api(`actions/runs/${request.id}`);
    const bound = runIdentity(value, workflow.id);
    assert.equal(
      value.repository?.full_name,
      REPOSITORY,
      'Unexpected canonical repository'
    );
    assert.equal(bound.id, request.id, 'Wrong canonical run ID');
    if (!request.recovery)
      assert.deepEqual(
        bound,
        {
          id: request.id,
          attempt: request.attempt,
          number: request.number,
          commit: request.commit,
          workflow_id: request.workflow_id
        },
        'Event does not match current NG attempt'
      );
    return bound;
  };
  const run = await readRun();
  const version = JSON.parse(
    await github.file('package.json', run.commit)
  ).version;
  // This route is constructed only after validating both number and version.
  assert.equal(typeof version, 'string');
  assert.ok(
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) &&
      !/\s/.test(version),
    'Invalid application version'
  );
  const tag = `integration-${version}-${run.number}`;
  const release = await github.api(`releases/tags/${tag}`);
  const partial = releaseIdentity(version, run, release);
  assert.equal(
    await github.resolveTag(tag),
    run.commit,
    'Git tag source mismatch'
  );
  const manifest = await registry.manifest(SOURCE_REPOSITORY, tag);
  assert.ok(manifest && typeof manifest.digest === 'string');
  assert.equal(manifest.digest.length, 71);
  assert.match(manifest.digest, /^sha256:[a-f0-9]{64}$/);
  const identity = {
    ...partial,
    source_image: `ghcr.io/${SOURCE_REPOSITORY}@${manifest.digest}`
  };
  contract.validateIdentity(identity);
  // Reuse the approved provenance/attempt and OCI validators at the fixed HA SHA.
  await github.verifySource(identity);
  await registry.source(identity);
  const snapshot = await github.snapshot();
  const allocations = contract.validateRegistry(
    JSON.parse(snapshot.files['home-assistant-addon/releases/registry.json'])
  );
  const current = contract.currentManifest(allocations);
  assert.deepEqual(
    JSON.parse(snapshot.files['home-assistant-addon/release.json']),
    current,
    'HA manifest drift'
  );
  const advertised = snapshot.files['home-assistant-addon/config.yaml'];
  assert.equal((advertised.match(/^version:.*$/gm) ?? []).length, 1);
  assert.ok(
    advertised.includes(`version: "${current.addon_version}"`),
    'HA advertised version drift'
  );
  const status = disposition(allocations, identity, contract);
  if (status !== 'superseded' && status !== 'recover_activated')
    await github.verifyAddonRevision(HA_REVISION, snapshot.head);
  releaseIdentity(version, run, await github.api(`releases/tags/${tag}`));
  assert.equal(
    await github.resolveTag(tag),
    run.commit,
    'Git tag changed during resolution'
  );
  assert.deepEqual(
    await readRun(),
    run,
    'NG attempt changed during resolution'
  );
  return {
    ...identity,
    ng_run_id: String(run.id),
    ng_run_attempt: String(run.attempt),
    should_publish: status === 'superseded' ? 'false' : 'true',
    resolution: status
  };
}

export function outputs(result) {
  const keys = [
    'integration_tag',
    'source_commit',
    'source_image',
    'ghostfolio_version',
    'addon_source_revision',
    'ng_run_id',
    'ng_run_attempt',
    'should_publish',
    'resolution'
  ];
  assert.deepEqual(Object.keys(result).sort(), [...keys].sort());
  for (const key of keys)
    assert.ok(
      typeof result[key] === 'string' && !/[\r\n]/.test(result[key]),
      'Unsafe workflow output'
    );
  sha(result.source_commit);
  assert.match(
    result.ghostfolio_version,
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
  );
  const tag = /^integration-(\d+\.\d+\.\d+)-([1-9][0-9]*)$/.exec(
    result.integration_tag
  );
  assert.ok(tag, 'Invalid output release tag');
  assert.equal(tag[1], result.ghostfolio_version);
  positive(Number(tag[2]));
  assert.equal(result.addon_source_revision, HA_REVISION);
  assert.equal(
    result.source_image.length,
    `ghcr.io/${SOURCE_REPOSITORY}@sha256:`.length + 64
  );
  assert.match(
    result.source_image,
    /^ghcr\.io\/piggei\/ghostfolio-ng@sha256:[a-f0-9]{64}$/
  );
  for (const key of ['ng_run_id', 'ng_run_attempt']) {
    assert.match(result[key], /^[1-9][0-9]*$/);
    positive(Number(result[key]));
  }
  assert.ok(
    ['new_release', 'resume', 'recover_activated', 'superseded'].includes(
      result.resolution
    )
  );
  assert.equal(
    result.should_publish,
    result.resolution === 'superseded' ? 'false' : 'true'
  );
  return keys.map((key) => `${key}=${result[key]}\n`).join('');
}

export async function main(env = process.env, fetcher = fetch) {
  // Gate event fields before loading credentials or making network requests.
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const context = {
    repository: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA
  };
  eventRequest(event, env.GITHUB_EVENT_NAME, context);
  assert.ok(env.GH_TOKEN, 'Missing read-only GitHub token');
  const clients = await loadContract(
    env.HA_CONTRACT_DIR ?? 'ha-contract',
    fetcher,
    env
  );
  const result = await resolveRelease({
    event,
    eventName: env.GITHUB_EVENT_NAME,
    context,
    ...clients
  });
  const encoded = outputs(result);
  appendFileSync(env.GITHUB_OUTPUT, encoded);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `NG run ${result.ng_run_id}, attempt ${result.ng_run_attempt}: ${result.resolution}.\n\n` +
        `Release: ${result.integration_tag}\n\nSource: ${result.source_image}\n`
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Do not reflect untrusted payload/API bodies, headers or credentials.
    console.error(
      'Orchestrator verification failed; no HA publication was requested.'
    );
    process.exitCode = 1;
  });
}
