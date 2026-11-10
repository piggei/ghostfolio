import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_BRANCH,
  disposition,
  eventRequest,
  HA_REVISION,
  loadContract,
  main,
  NG_BRANCH,
  NG_WORKFLOW,
  NG_WORKFLOW_NAME,
  outputs,
  readOnlyFetch,
  REPOSITORY,
  resolveRelease,
  runIdentity,
  SOURCE_REPOSITORY
} from './ghostfolio-ng-ha-orchestrator.mjs';

const directory = process.env.HA_CONTRACT_DIR ?? 'ha-contract';
assert.ok(
  existsSync(directory),
  'Set HA_CONTRACT_DIR to a snapshot of the approved HA commit before running tests'
);
const { contract } = await loadContract(directory, async () => {
  throw new Error('Network forbidden in tests');
});
const hash = (bytes) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const response = (body, status = 200, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers
  });
const context = {
  repository: REPOSITORY,
  ref: `refs/heads/${DEFAULT_BRANCH}`,
  sha: '1'.repeat(40)
};

function fixture(number = 15) {
  const run = {
    id: 41731193162 + number - 15,
    run_attempt: 1,
    run_number: number,
    workflow_id: 401082200,
    repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY },
    head_sha: '649d61f90429483cac949c0c97c83d10c13f7c8e',
    head_branch: NG_BRANCH,
    path: NG_WORKFLOW,
    name: NG_WORKFLOW_NAME,
    status: 'completed',
    conclusion: 'success',
    event: 'push'
  };
  const event = {
    action: 'completed',
    repository: { full_name: REPOSITORY, default_branch: DEFAULT_BRANCH },
    workflow: {
      id: run.workflow_id,
      path: NG_WORKFLOW,
      name: NG_WORKFLOW_NAME
    },
    workflow_run: structuredClone(run)
  };
  const tag = `integration-3.97.0-${number}`;
  const release = {
    tag_name: tag,
    target_commitish: run.head_sha,
    draft: false,
    prerelease: false,
    published_at: '2026-11-03T22:39:44Z',
    body: [
      `- Source commit: [${run.head_sha.slice(0, 9)}](https://github.com/${REPOSITORY}/commit/${run.head_sha})`,
      `- Docker image: \`ghcr.io/${SOURCE_REPOSITORY}:${tag}\``,
      `- Immutable commit tag: \`ghcr.io/${SOURCE_REPOSITORY}:sha-${run.head_sha}\``,
      '- Supported architectures: Linux AMD64 and ARM64'
    ].join('\n')
  };
  const state = {
    run,
    event,
    release,
    tag,
    version: '3.97.0',
    tagCommit: run.head_sha,
    ha: contract.createRegistry('3.97.0'),
    routes: new Map(),
    calls: [],
    errors: new Map(),
    runReads: 0,
    jobs: [
      {
        name: 'release',
        run_id: run.id,
        run_attempt: 1,
        head_sha: run.head_sha,
        status: 'completed',
        conclusion: 'success'
      }
    ]
  };
  state.rebuildOCI = ({
    platforms = ['amd64', 'arm64'],
    configArchitecture,
    sourceRevision = run.head_sha
  } = {}) => {
    state.routes.clear();
    const manifests = platforms.map((arch) => {
      const config = JSON.stringify({
        os: 'linux',
        architecture: configArchitecture?.[arch] ?? arch,
        config: {
          Labels: { 'org.opencontainers.image.revision': sourceRevision }
        }
      });
      const body = JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: { digest: hash(config) },
        layers: []
      });
      state.routes.set(`blobs/${hash(config)}`, config);
      state.routes.set(`manifests/${hash(body)}`, body);
      return {
        digest: hash(body),
        platform: { os: 'linux', architecture: arch }
      };
    });
    const index = JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests
    });
    state.digest = hash(index);
    for (const ref of [tag, state.digest, `sha-${run.head_sha}`])
      state.routes.set(`manifests/${ref}`, index);
  };
  state.rebuildOCI();
  state.identity = () => ({
    integration_tag: tag,
    source_commit: run.head_sha,
    source_image: `ghcr.io/${SOURCE_REPOSITORY}@${state.digest}`,
    ghostfolio_version: '3.97.0',
    addon_source_revision: HA_REVISION
  });
  state.fetcher = async (url, options = {}) => {
    const parsed = new URL(url);
    state.calls.push({
      url,
      method: options.method ?? 'GET',
      headers: options.headers
    });
    assert.equal(
      options.method ?? 'GET',
      'GET',
      'Test detected remote mutation'
    );
    if (state.beforeFetch) state.beforeFetch(parsed, state);
    const full = parsed.pathname + parsed.search;
    const error = state.errors.get(full) ?? state.errors.get(parsed.pathname);
    if (error) return response({}, error);
    if (parsed.hostname === 'ghcr.io') {
      if (parsed.pathname === '/token')
        return response({ token: 'scoped-test-token' });
      const key = parsed.pathname.split(`/v2/${SOURCE_REPOSITORY}/`)[1];
      const value = state.routes.get(key);
      return value === undefined
        ? response({}, 404)
        : response(value, 200, { 'docker-content-digest': hash(value) });
    }
    assert.equal(parsed.hostname, 'api.github.com');
    const path = parsed.pathname.replace(`/repos/${REPOSITORY}/`, '');
    if (path === 'actions/workflows/integration-release.yml')
      return response({
        id: run.workflow_id,
        path: NG_WORKFLOW,
        name: NG_WORKFLOW_NAME
      });
    if (path === `actions/runs/${run.id}`) {
      state.runReads++;
      const current = structuredClone(state.run);
      state.onRunRead?.(current, state.runReads);
      return response(current);
    }
    if (path === 'actions/workflows/integration-release.yml/runs')
      return response({ workflow_runs: state.runList ?? [run] });
    if (path === `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`)
      return response({ jobs: state.jobs });
    if (path === `releases/tags/${tag}`) return response(release);
    if (path === `git/ref/tags/${tag}`)
      return response({ object: { type: 'commit', sha: state.tagCommit } });
    if (path === 'git/ref/heads/feat/home-assistant-addon')
      return response({ object: { sha: state.haHead ?? HA_REVISION } });
    if (path.startsWith('git/commits/'))
      return response({ tree: { sha: path.split('/').at(-1) } });
    if (path.startsWith('git/trees/'))
      return response({
        truncated: false,
        tree: [
          {
            type: 'blob',
            path: 'home-assistant-addon/Dockerfile',
            sha:
              state.buildDrift && path.endsWith(state.haHead)
                ? 'changed'
                : 'same'
          },
          {
            type: 'blob',
            path: 'scripts/home-assistant-addon-release.mjs',
            sha: 'same'
          }
        ]
      });
    if (path.startsWith('contents/')) {
      const name = path.slice('contents/'.length);
      const current = contract.currentManifest(state.ha);
      const files = {
        'package.json': JSON.stringify({ version: state.version }),
        'home-assistant-addon/releases/registry.json': JSON.stringify(state.ha),
        'home-assistant-addon/release.json': JSON.stringify(current),
        'home-assistant-addon/config.yaml': `name: Ghostfolio-NG\nversion: "${current.addon_version}"\nslug: ghostfolio_ng\n`,
        'home-assistant-addon/README.md': 'Documentation',
        'home-assistant-addon/DOCS.md': 'Documentation',
        'home-assistant-addon/CHANGELOG.md':
          '# Ghostfolio-NG Home Assistant Add-on Changelog\n'
      };
      const content = state.files?.[name] ?? files[name];
      assert.notEqual(
        content,
        undefined,
        `Unexpected test file request ${name}`
      );
      return response({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(content).toString('base64')
      });
    }
    throw new Error(`Unexpected test API ${path}`);
  };
  state.clients = () =>
    loadContract(directory, state.fetcher, {
      GH_TOKEN: 'test-token-do-not-log',
      GITHUB_ACTOR: 'test-actor'
    });
  state.resolve = async (overrides = {}) =>
    resolveRelease({
      event,
      eventName: 'workflow_run',
      context,
      ...(await state.clients()),
      ...overrides
    });
  return state;
}

test('completed authorized event resolves the exact release and actual OCI digest read-only', async () => {
  const f = fixture();
  const result = await f.resolve();
  assert.equal(result.integration_tag, f.tag);
  assert.equal(result.source_commit, f.run.head_sha);
  assert.equal(result.source_image, `ghcr.io/${SOURCE_REPOSITORY}@${f.digest}`);
  assert.equal(result.addon_source_revision, HA_REVISION);
  assert.equal(result.should_publish, 'true');
  assert.equal(result.resolution, 'new_release');
  assert.ok(f.calls.every((c) => c.method === 'GET'));
  assert.ok(
    !f.calls.some((c) =>
      /releases\/latest|manifests\/integration$|artifacts|dispatches/.test(
        c.url
      )
    )
  );
  assert.ok(
    f.calls.some((c) => c.url.includes(`/attempts/${f.run.run_attempt}/jobs`))
  );
  assert.deepEqual(f.ha, contract.createRegistry('3.97.0'));
});

for (const [name, mutate] of [
  [
    'wrong event repository',
    (e) => {
      e.repository.full_name = 'attacker/ghostfolio';
    }
  ],
  [
    'wrong source repository',
    (e) => {
      e.workflow_run.head_repository.full_name = 'attacker/ghostfolio';
    }
  ],
  [
    'wrong run repository',
    (e) => {
      e.workflow_run.repository.full_name = 'attacker/ghostfolio';
    }
  ],
  [
    'wrong branch',
    (e) => {
      e.workflow_run.head_branch = 'main';
    }
  ],
  [
    'wrong workflow',
    (e) => {
      e.workflow_run.path = '.github/workflows/other.yml';
    }
  ],
  [
    'wrong workflow name',
    (e) => {
      e.workflow_run.name = 'Other release';
    }
  ],
  [
    'failed run',
    (e) => {
      e.workflow_run.conclusion = 'failure';
    }
  ],
  [
    'cancelled run',
    (e) => {
      e.workflow_run.conclusion = 'cancelled';
    }
  ],
  [
    'incomplete run',
    (e) => {
      e.workflow_run.status = 'in_progress';
    }
  ],
  [
    'wrong action',
    (e) => {
      e.action = 'requested';
    }
  ],
  [
    'pull request trigger',
    (e) => {
      e.workflow_run.event = 'pull_request';
    }
  ],
  [
    'pull request target trigger',
    (e) => {
      e.workflow_run.event = 'pull_request_target';
    }
  ],
  [
    'inconsistent workflow ID',
    (e) => {
      e.workflow.id++;
    }
  ],
  [
    'inconsistent workflow path',
    (e) => {
      e.workflow.path = '.github/workflows/evil.yml';
    }
  ],
  [
    'different default branch',
    (e) => {
      e.repository.default_branch = 'other';
    }
  ],
  [
    'invalid commit',
    (e) => {
      e.workflow_run.head_sha = 'a'.repeat(39);
    }
  ],
  [
    'shell-sensitive commit',
    (e) => {
      e.workflow_run.head_sha = '$(touch /tmp/untrusted)';
    }
  ],
  [
    'commit with newline',
    (e) => {
      e.workflow_run.head_sha += '\n';
    }
  ]
]) {
  test(`event gate rejects ${name} before any API request`, async () => {
    const f = fixture();
    mutate(f.event);
    await assert.rejects(f.resolve());
    assert.equal(f.calls.length, 0);
  });
}

for (const field of ['id', 'run_number', 'run_attempt', 'workflow_id']) {
  for (const value of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '15; echo bad'
  ]) {
    test(`event rejects invalid ${field}: ${value}`, () => {
      const f = fixture();
      f.event.workflow_run[field] = value;
      assert.throws(() => eventRequest(f.event, 'workflow_run', context));
    });
  }
}

test('caller context cannot select an arbitrary branch, repository or trigger', () => {
  const f = fixture();
  for (const invalid of [
    { repository: 'other/repo' },
    { ref: 'refs/heads/feat/ghostfolio-ng-ha-orchestrator' },
    { sha: 'untrusted' }
  ]) {
    assert.throws(() =>
      eventRequest(f.event, 'workflow_run', { ...context, ...invalid })
    );
  }
  assert.throws(() => eventRequest(f.event, 'repository_dispatch', context));
});

test('manual recovery takes only a run ID and resolves immutable identity from APIs', async () => {
  const f = fixture();
  const event = {
    repository: f.event.repository,
    inputs: { ng_run_id: String(f.run.id), source_image: 'untrusted:tag' }
  };
  const result = await f.resolve({ event, eventName: 'workflow_dispatch' });
  assert.equal(result.source_image, `ghcr.io/${SOURCE_REPOSITORY}@${f.digest}`);
  assert.equal(result.ng_run_id, String(f.run.id));
  for (const value of [
    '',
    '0',
    '01',
    '-1',
    '1.1',
    '1\n',
    '$(echo bad)',
    '9007199254740992',
    1
  ]) {
    assert.throws(() =>
      eventRequest(
        { ...event, inputs: { ng_run_id: value } },
        'workflow_dispatch',
        context
      )
    );
  }
});

for (const [name, mutate] of [
  [
    'different run ID',
    (r) => {
      r.id++;
    }
  ],
  [
    'new attempt',
    (r) => {
      r.run_attempt++;
    }
  ],
  [
    'different run number',
    (r) => {
      r.run_number++;
    }
  ],
  [
    'different source SHA',
    (r) => {
      r.head_sha = 'b'.repeat(40);
    }
  ],
  [
    'failed canonical run',
    (r) => {
      r.conclusion = 'failure';
    }
  ],
  [
    'different canonical branch',
    (r) => {
      r.head_branch = 'other';
    }
  ],
  [
    'different canonical repository',
    (r) => {
      r.repository.full_name = 'other/repo';
    }
  ],
  [
    'different canonical workflow ID',
    (r) => {
      r.workflow_id++;
    }
  ],
  [
    'different canonical workflow path',
    (r) => {
      r.path = '.github/workflows/other.yml';
    }
  ]
]) {
  test(`canonical API rejects ${name}`, async () => {
    const f = fixture();
    f.onRunRead = (r) => mutate(r);
    await assert.rejects(f.resolve());
  });
}

test('an attempt changing after OCI/registry checks cannot produce invocation outputs', async () => {
  const f = fixture();
  f.onRunRead = (run, count) => {
    if (count === 4) run.run_attempt++;
  };
  await assert.rejects(f.resolve(), /Event does not match/);
  assert.ok(f.calls.some((c) => c.url.includes('/blobs/')));
});

for (const [name, mutate] of [
  [
    'draft release',
    (f) => {
      f.release.draft = true;
    }
  ],
  [
    'prerelease',
    (f) => {
      f.release.prerelease = true;
    }
  ],
  [
    'unpublished release',
    (f) => {
      f.release.published_at = null;
    }
  ],
  [
    'invalid publication date',
    (f) => {
      f.release.published_at = 'invalid';
    }
  ],
  [
    'wrong release tag',
    (f) => {
      f.release.tag_name = 'integration-3.97.0-16';
    }
  ],
  [
    'wrong target commit',
    (f) => {
      f.release.target_commitish = 'b'.repeat(40);
    }
  ],
  [
    'moving branch target',
    (f) => {
      f.release.target_commitish = NG_BRANCH;
    }
  ],
  [
    'wrong Git tag commit',
    (f) => {
      f.tagCommit = 'b'.repeat(40);
    }
  ],
  [
    'missing metadata',
    (f) => {
      f.release.body = '';
    }
  ],
  [
    'wrong image metadata',
    (f) => {
      f.release.body = f.release.body.replace('ghostfolio-ng:', 'other:');
    }
  ],
  [
    'mutable image metadata',
    (f) => {
      f.release.body = f.release.body.replace(f.tag, 'integration');
    }
  ],
  [
    'conflicting metadata',
    (f) => {
      f.release.body += '\n- Docker image: `untrusted:tag`';
    }
  ],
  [
    'indented conflicting metadata',
    (f) => {
      f.release.body += '\n  - Docker image: `untrusted:tag`';
    }
  ],
  [
    'missing architecture metadata',
    (f) => {
      f.release.body = f.release.body.replace(
        '- Supported architectures: Linux AMD64 and ARM64',
        ''
      );
    }
  ],
  [
    'wrong application version',
    (f) => {
      f.version = '3.98.0';
    }
  ],
  [
    'invalid application version',
    (f) => {
      f.version = '3.97.0;echo bad';
    }
  ]
]) {
  test(`release resolution rejects ${name}`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.resolve());
  });
}

test('missing GitHub release is rejected without falling back to latest', async () => {
  const f = fixture();
  f.errors.set(`/repos/${REPOSITORY}/releases/tags/${f.tag}`, 404);
  await assert.rejects(f.resolve());
  assert.ok(!f.calls.some((c) => c.url.includes('/latest')));
});

for (const [name, mutate] of [
  [
    'missing GHCR image',
    (f) => {
      f.routes.delete(`manifests/${f.tag}`);
    }
  ],
  [
    'missing AMD64',
    (f) => {
      f.rebuildOCI({ platforms: ['arm64'] });
    }
  ],
  [
    'missing ARM64',
    (f) => {
      f.rebuildOCI({ platforms: ['amd64'] });
    }
  ],
  [
    'duplicate architecture',
    (f) => {
      f.rebuildOCI({ platforms: ['amd64', 'amd64'] });
    }
  ],
  [
    'unexpected architecture',
    (f) => {
      f.rebuildOCI({ platforms: ['amd64', 'arm64', '386'] });
    }
  ],
  [
    'incorrect config architecture',
    (f) => {
      f.rebuildOCI({ configArchitecture: { amd64: 'arm64' } });
    }
  ],
  [
    'wrong OCI source revision',
    (f) => {
      f.rebuildOCI({ sourceRevision: 'b'.repeat(40) });
    }
  ],
  [
    'commit tag digest mismatch',
    (f) => {
      f.routes.set(`manifests/sha-${f.run.head_sha}`, '{"schemaVersion":2}');
    }
  ],
  [
    'content digest mismatch',
    (f) => {
      f.routes.set(`manifests/${f.digest}`, '{"schemaVersion":2}');
    }
  ]
]) {
  test(`OCI validation rejects ${name}`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.resolve());
  });
}

test('a release tag moving after first digest resolution is rejected', async () => {
  const f = fixture();
  let reads = 0;
  f.beforeFetch = (url) => {
    if (
      url.pathname === `/v2/${SOURCE_REPOSITORY}/manifests/${f.tag}` &&
      ++reads === 2
    ) {
      f.routes.set(`manifests/${f.tag}`, '{"schemaVersion":2,"changed":true}');
    }
  };
  await assert.rejects(f.resolve());
});

test('GitHub release metadata changing during resolution is rejected', async () => {
  const f = fixture();
  let reads = 0;
  f.beforeFetch = (url) => {
    if (
      url.pathname === `/repos/${REPOSITORY}/releases/tags/${f.tag}` &&
      ++reads === 3
    ) {
      f.release.target_commitish = 'b'.repeat(40);
    }
  };
  await assert.rejects(f.resolve(), /Release target/);
});

for (const status of [401, 403, 429, 500, 503]) {
  test(`GHCR HTTP ${status} cannot start HA publication`, async () => {
    const f = fixture();
    f.errors.set(`/v2/${SOURCE_REPOSITORY}/manifests/${f.tag}`, status);
    await assert.rejects(f.resolve());
    assert.ok(f.calls.every((c) => c.method === 'GET'));
  });
}

test('release job success cannot qualify a failed/incomplete NG run or ambiguous provenance', async () => {
  for (const mode of [
    'job-failure',
    'job-wrong-attempt',
    'duplicate-job',
    'duplicate-run'
  ]) {
    const f = fixture();
    if (mode === 'job-failure') f.jobs[0].conclusion = 'failure';
    if (mode === 'job-wrong-attempt') f.jobs[0].run_attempt = 2;
    if (mode === 'duplicate-job') f.jobs.push({ ...f.jobs[0] });
    if (mode === 'duplicate-run')
      f.runList = [f.run, { ...f.run, id: f.run.id + 1 }];
    await assert.rejects(f.resolve());
  }
});

test('duplicate events and recovery do not allocate a new version or mutate any remote state', async () => {
  const f = fixture();
  f.ha = contract.reserveRelease(f.ha, f.identity());
  const original = JSON.stringify(f.ha);
  const first = await f.resolve();
  const second = await f.resolve();
  assert.deepEqual(second, first);
  assert.equal(first.resolution, 'resume');
  assert.equal(JSON.stringify(f.ha), original);
  assert.equal(f.ha.releases[0].addon_version, '3.97.1');
  assert.ok(f.calls.every((c) => c.method === 'GET'));
});

test('newer reserved release supersedes an older request without calling HA', async () => {
  const f = fixture();
  const newer = { ...f.identity(), integration_tag: 'integration-3.97.0-16' };
  f.ha = contract.reserveRelease(f.ha, newer);
  const result = await f.resolve();
  assert.equal(result.resolution, 'superseded');
  assert.equal(result.should_publish, 'false');
  assert.equal(f.ha.releases.length, 1);
});

test('same release with a conflicting digest or HA revision cannot be resumed', async () => {
  for (const field of ['source_image', 'addon_source_revision']) {
    const f = fixture();
    const invalid = { ...f.identity() };
    invalid[field] =
      field === 'source_image'
        ? `ghcr.io/${SOURCE_REPOSITORY}@sha256:${'9'.repeat(64)}`
        : 'b'.repeat(40);
    f.ha = contract.reserveRelease(f.ha, invalid);
    await assert.rejects(f.resolve(), /Conflicting HA/);
  }
});

test('activated historical release is delegated for tag repair without changing newer metadata', async () => {
  const f = fixture();
  const identity = f.identity();
  const activated = (state, value) => {
    state = contract.reserveRelease(state, value);
    for (const stage of ['qualified', 'published'])
      for (const [arch, oci, char] of [
        ['amd64', 'amd64', 'a'],
        ['aarch64', 'arm64', 'b']
      ]) {
        state = contract.recordImage(state, value, stage, arch, {
          os: 'linux',
          architecture: oci,
          digest: `sha256:${char.repeat(64)}`
        });
      }
    return contract.activateRelease(state, value);
  };
  f.ha = activated(f.ha, identity);
  f.ha = activated(f.ha, {
    ...identity,
    integration_tag: 'integration-3.97.0-16'
  });
  const before = JSON.stringify(f.ha);
  const result = await f.resolve();
  assert.equal(result.resolution, 'recover_activated');
  assert.equal(result.should_publish, 'true');
  assert.equal(JSON.stringify(f.ha), before);
  assert.equal(contract.currentManifest(f.ha).addon_version, '3.97.2');
});

test('HA version validation accepts both YAML quoting styles', async () => {
  for (const quote of ["'", '"']) {
    const f = fixture();
    const version = contract.currentManifest(f.ha).addon_version;

    f.files = {
      'home-assistant-addon/config.yaml': `name: Ghostfolio-NG\nversion: ${quote}${version}${quote}\nslug: ghostfolio_ng\n`
    };

    const result = await f.resolve();

    assert.equal(result.resolution, 'new_release');
    assert.equal(result.should_publish, 'true');
  }
});

test('HA manifest/config drift fails before publishing any output', async () => {
  for (const files of [
    { 'home-assistant-addon/release.json': '{}' },
    { 'home-assistant-addon/config.yaml': 'version: "0.0.0"\n' },
    { 'home-assistant-addon/releases/registry.json': '{"schema_version":2}' }
  ]) {
    const f = fixture();
    f.files = files;
    await assert.rejects(f.resolve());
  }
});

test('GitHub and GHCR failures retry read-only with the same reserved identity', async () => {
  for (const service of ['GitHub', 'GHCR']) {
    const f = fixture();
    f.ha = contract.reserveRelease(f.ha, f.identity());
    const before = JSON.stringify(f.ha);
    const endpoint =
      service === 'GitHub'
        ? `/repos/${REPOSITORY}/actions/runs/${f.run.id}`
        : `/v2/${SOURCE_REPOSITORY}/manifests/${f.tag}`;
    f.errors.set(endpoint, service === 'GitHub' ? 503 : 401);
    await assert.rejects(f.resolve());
    f.errors.clear();
    const result = await f.resolve();
    assert.equal(result.integration_tag, f.tag);
    assert.equal(result.resolution, 'resume');
    assert.equal(JSON.stringify(f.ha), before);
    assert.equal(f.ha.releases[0].addon_version, '3.97.1');
    assert.ok(f.calls.every((c) => c.method === 'GET'));
  }
});

test('safe output serialization rejects newlines, credentials fields and mutable images', async () => {
  const f = fixture();
  const result = await f.resolve();
  const encoded = outputs(result);
  assert.equal(encoded.split('\n').filter(Boolean).length, 9);
  assert.ok(!encoded.includes('test-token-do-not-log'));
  for (const corrupt of [
    { source_image: 'ghcr.io/piggei/ghostfolio-ng:integration' },
    { integration_tag: result.integration_tag + '\nshould_publish=true' },
    { addon_source_revision: 'main' },
    { addon_source_revision: '4d642df014071b5c72eb731409aef47507cad641' },
    { addon_source_revision: 'bfaf9ff86325d3d6fb25c37785e854cc583077df' },
    { addon_source_revision: 'a'.repeat(40) },
    { ng_run_id: '1;echo bad' },
    { should_publish: 'false' },
    { secret: 'test-token-do-not-log' },
    { integration_tag: '$(echo untrusted)' },
    { ghostfolio_version: '3.98.0' }
  ])
    assert.throws(() => outputs({ ...result, ...corrupt }));
});

test('HA source drift is rejected against the approved revision before invoking publication', async () => {
  const f = fixture();
  f.haHead = 'b'.repeat(40);
  f.buildDrift = true;
  await assert.rejects(f.resolve(), /Add-on source changed/);
  assert.equal(f.ha.generation, 0);
});

test('manual recovery does not bypass the canonical NG event allowlist', async () => {
  const f = fixture();
  f.run.event = 'pull_request';
  await assert.rejects(
    f.resolve({
      event: {
        repository: f.event.repository,
        inputs: { ng_run_id: String(f.run.id) }
      },
      eventName: 'workflow_dispatch'
    })
  );
});

test('same run number with a conflicting upstream identity is rejected', async () => {
  const f = fixture();
  f.ha = contract.reserveRelease(f.ha, {
    ...f.identity(),
    integration_tag: 'integration-3.98.0-15',
    ghostfolio_version: '3.98.0'
  });
  await assert.rejects(f.resolve(), /Conflicting NG run number/);
});

test('read-only transport rejects writes, arbitrary hosts and foreign repositories before fetch', async () => {
  let calls = 0;
  const transport = readOnlyFetch(async () => {
    calls++;
    return response({});
  });
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT'])
    await assert.rejects(
      transport(`https://api.github.com/repos/${REPOSITORY}/git/refs`, {
        method
      })
    );
  for (const url of [
    'http://api.github.com/repos/piggei/ghostfolio/releases',
    'https://evil.example/steal',
    'https://api.github.com/repos/other/repo/contents/script',
    'https://ghcr.io/v2/other/repo/manifests/tag',
    'https://user:password@ghcr.io/token'
  ])
    await assert.rejects(transport(url));
  assert.equal(calls, 0);
  await assert.rejects(
    transport('https://ghcr.io/token', { body: 'unexpected' })
  );
});

test('blob redirect validation strips credentials and rejects unsafe destinations', async () => {
  const calls = [];
  const transport = readOnlyFetch(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? response({}, 307, {
          location:
            'https://pkg-containers.githubusercontent.com/blob?signed=public-fixture'
        })
      : response('{}');
  });
  await transport(
    `https://ghcr.io/v2/${SOURCE_REPOSITORY}/blobs/sha256:${'a'.repeat(64)}`,
    { headers: { Authorization: 'Bearer private' } }
  );
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.redirect, 'error');
  for (const url of [
    'https://evil.example/steal',
    'http://pkg-containers.githubusercontent.com/blob',
    'https://private:secret@ghcr.io/blob'
  ]) {
    const unsafe = readOnlyFetch(async () =>
      response({}, 307, { location: url })
    );
    await assert.rejects(
      unsafe(
        `https://ghcr.io/v2/${SOURCE_REPOSITORY}/blobs/sha256:${'a'.repeat(64)}`
      )
    );
  }
  const misplaced = readOnlyFetch(async () =>
    response({}, 302, { location: 'https://ghcr.io/token' })
  );
  await assert.rejects(
    misplaced(`https://api.github.com/repos/${REPOSITORY}/releases`)
  );
});

test('extra event scripts/artifact references cannot alter the selected release or execute code', async () => {
  const f = fixture();
  f.event.workflow_run.script = 'throw new Error("untrusted script executed")';
  f.event.workflow_run.artifacts_url = 'https://evil.example/script';
  f.event.checkout_ref = 'pull/999/head';
  const result = await f.resolve();
  assert.equal(result.integration_tag, f.tag);
  assert.equal(result.addon_source_revision, HA_REVISION);
  assert.ok(
    !f.calls.some(
      (c) => c.url.includes('evil.example') || c.url.includes('/artifacts')
    )
  );
});

test('runtime entry point emits outputs only after complete validation and never logs credentials', async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'ng-ha-orchestrator-main-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  for (const mode of ['success', 'bad-event', 'missing-image']) {
    const f = fixture();
    const path = join(temporary, `${mode}.json`);
    const output = join(temporary, `${mode}.out`);
    const summary = join(temporary, `${mode}.summary`);
    if (mode === 'bad-event') f.event.workflow_run.head_branch = 'untrusted';
    if (mode === 'missing-image') f.routes.delete(`manifests/${f.tag}`);
    writeFileSync(path, JSON.stringify(f.event));
    const env = {
      GITHUB_EVENT_PATH: path,
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_REPOSITORY: context.repository,
      GITHUB_REF: context.ref,
      GITHUB_SHA: context.sha,
      GH_TOKEN: 'test-token-do-not-log',
      GITHUB_ACTOR: 'test-actor',
      HA_CONTRACT_DIR: directory,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary
    };
    if (mode === 'success') {
      await main(env, f.fetcher);
      assert.ok(
        readFileSync(output, 'utf8').includes(
          `source_image=ghcr.io/${SOURCE_REPOSITORY}@${f.digest}`
        )
      );
      assert.ok(!readFileSync(output, 'utf8').includes(env.GH_TOKEN));
      assert.ok(!readFileSync(summary, 'utf8').includes(env.GH_TOKEN));
    } else {
      await assert.rejects(main(env, f.fetcher));
      assert.equal(existsSync(output), false);
      assert.equal(existsSync(summary), false);
      if (mode === 'bad-event') assert.equal(f.calls.length, 0);
    }
  }
});

function historicalReservations() {
  const first = {
    integration_tag: 'integration-3.97.0-15',
    source_commit: '649d61f90429483cac949c0c97c83d10c13f7c8e',
    source_image:
      'ghcr.io/piggei/ghostfolio-ng@sha256:8ae5031f41e96bebf1fc5a599513c4ba8c0ef33e49171dc45198bcb9cba4e27f',
    ghostfolio_version: '3.97.0',
    addon_source_revision: '4d642df014071b5c72eb731409aef47507cad641'
  };
  const second = {
    integration_tag: 'integration-3.97.0-16',
    source_commit: '0e24e1a7cec9a4f47422eb5c6889332c78ba1c13',
    source_image:
      'ghcr.io/piggei/ghostfolio-ng@sha256:b42328186155de9feda900fb9a457c9d53f842fdb12d53b9406bc7f4c5f3cc59',
    ghostfolio_version: '3.97.0',
    addon_source_revision: 'bfaf9ff86325d3d6fb25c37785e854cc583077df'
  };
  let registry = contract.reserveRelease(
    contract.createRegistry('3.97.0'),
    first
  );
  registry = contract.reserveRelease(registry, second);
  return contract.recordImage(registry, second, 'qualified', 'amd64', {
    os: 'linux',
    architecture: 'amd64',
    digest:
      'sha256:9f2ccd3f757699dcf55a1d57a46c9c056df94081edcc27db9c520ace742a7072'
  });
}

for (const index of [0, 1]) {
  test(`controller D rejects historical reservation ${index + 1} without changing its identity or evidence`, () => {
    const registry = historicalReservations();
    const before = JSON.stringify(registry);
    const existing = registry.releases[index];
    const selected = {
      ...existing.identity,
      addon_source_revision: HA_REVISION
    };
    assert.equal(HA_REVISION, 'd78d0e7939c4e7b70eeda9b628244e9f5c47656c');
    assert.throws(
      () => disposition(registry, selected, contract),
      /Conflicting HA release identity/
    );
    assert.equal(JSON.stringify(registry), before);
  });
}

test('controller D resolves a genuinely published newer NG mock release without resuming historical reservations', async () => {
  const f = fixture(17);
  f.ha = historicalReservations();
  const before = JSON.stringify(f.ha);
  const result = await f.resolve();
  assert.equal(result.resolution, 'new_release');
  assert.equal(result.should_publish, 'true');
  assert.equal(result.addon_source_revision, HA_REVISION);
  assert.equal(result.integration_tag, 'integration-3.97.0-17');
  assert.equal(result.ng_run_id, String(f.run.id));
  assert.equal(JSON.stringify(f.ha), before);
  const proposed = contract.reserveRelease(f.ha, f.identity());
  assert.equal(proposed.releases.at(-1).addon_version, '3.97.3');
  assert.deepEqual(proposed.releases.slice(0, 2), f.ha.releases);
  assert.ok(f.calls.every((c) => c.method === 'GET'));
});
