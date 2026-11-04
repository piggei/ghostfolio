import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GitHub } from './home-assistant-addon-github.mjs';
import { Registry, sha256 } from './home-assistant-addon-oci.mjs';

const response = (body, status = 200, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers
  });

function ociFixture() {
  const routes = new Map();
  const repository = 'piggei/ghostfolio-ng';
  const commit = 'a'.repeat(40);
  const child = (arch) => {
    const config = {
      os: 'linux',
      architecture: arch,
      config: { Labels: { 'org.opencontainers.image.revision': commit } }
    };
    const configBytes = JSON.stringify(config);
    const manifest = {
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: { digest: sha256(configBytes) },
      layers: []
    };
    const bytes = JSON.stringify(manifest);
    routes.set(`blobs/${sha256(configBytes)}`, response(configBytes));
    routes.set(`manifests/${sha256(bytes)}`, response(bytes));
    return {
      digest: sha256(bytes),
      platform: { os: 'linux', architecture: arch }
    };
  };
  const items = [child('amd64'), child('arm64')];
  const identity = {
    source_commit: commit,
    integration_tag: 'integration-3.97.0-15'
  };
  function setIndex(manifests = items) {
    const bytes = JSON.stringify({ schemaVersion: 2, manifests });
    identity.source_image = `ghcr.io/${repository}@${sha256(bytes)}`;
    for (const ref of [
      sha256(bytes),
      identity.integration_tag,
      `sha-${commit}`
    ]) {
      routes.set(
        `manifests/${ref}`,
        response(bytes, 200, { 'docker-content-digest': sha256(bytes) })
      );
    }
  }
  setIndex();
  const requests = [];
  const registry = new Registry({
    actor: 'actor',
    token: 'private',
    fetcher: async (url, options) => {
      requests.push({ url, options });
      if (url.startsWith('https://ghcr.io/token?'))
        return response({ token: 'scoped-token' });
      const route = routes.get(url.split(`/v2/${repository}/`)[1]);
      return route ? route.clone() : response({}, 404);
    }
  });
  return { registry, routes, items, identity, repository, requests, setIndex };
}

test('OCI verifies raw content hashes, both architectures and NG revision labels', async () => {
  const h = ociFixture();
  await h.registry.source(h.identity);
  const image = await h.registry.image(
    h.repository,
    h.items[0].digest,
    'amd64',
    { 'org.opencontainers.image.revision': h.identity.source_commit }
  );
  assert.equal(image.architecture, 'amd64');
  assert.equal(h.requests.filter((r) => r.url.includes('/token?')).length, 1);
  assert.equal(
    h.requests[0].options.headers.Authorization,
    `Basic ${Buffer.from('actor:private').toString('base64')}`
  );
});

for (const status of [401, 403, 429, 500, 503]) {
  test(`GHCR HTTP ${status} cannot be mistaken for an absent image`, async () => {
    const h = ociFixture();
    h.routes.set('manifests/missing', response({}, status));
    await assert.rejects(
      h.registry.manifest(h.repository, 'missing', true),
      new RegExp(String(status))
    );
    assert.equal(await h.registry.manifest(h.repository, 'absent', true), null);
  });
}

test('registry token failures fail closed', async () => {
  const registry = new Registry({ fetcher: async () => response({}, 403) });
  await assert.rejects(
    registry.manifest('piggei/ghostfolio-ng', 'missing', true),
    /403/
  );
});

test('OCI rejects digest tampering, wrong labels, wrong architecture and multiarch candidates', async () => {
  const h = ociFixture();
  await assert.rejects(
    h.registry.image(h.repository, h.items[0].digest, 'aarch64'),
    /Architecture/
  );
  await assert.rejects(
    h.registry.image(h.repository, h.items[0].digest, 'amd64', {
      'org.opencontainers.image.revision': 'wrong'
    }),
    /provenance/
  );
  await assert.rejects(
    h.registry.image(
      h.repository,
      h.identity.source_image.split('@')[1],
      'amd64'
    ),
    /single-platform/
  );
  h.routes.set(
    `manifests/${h.items[0].digest}`,
    response({ schemaVersion: 2, config: {} })
  );
  await assert.rejects(
    h.registry.image(h.repository, h.items[0].digest, 'amd64'),
    /digest mismatch/
  );
});

test('OCI source rejects missing, duplicate and unexpected runnable platforms', async () => {
  for (const platforms of [
    ['amd64'],
    ['amd64', 'amd64'],
    ['amd64', 'arm64', '386']
  ]) {
    const h = ociFixture();
    h.setIndex(
      platforms.map((arch) => ({
        ...h.items[0],
        platform: { os: 'linux', architecture: arch }
      }))
    );
    await assert.rejects(h.registry.source(h.identity));
  }
  const h = ociFixture();
  h.setIndex([
    ...h.items,
    {
      digest: `sha256:${'b'.repeat(64)}`,
      platform: { os: 'unknown', architecture: 'unknown' }
    }
  ]);
  await assert.rejects(h.registry.source(h.identity));
});

test('OCI source accepts identified attestations but rejects a moved release tag', async () => {
  const h = ociFixture();
  h.setIndex([
    ...h.items,
    {
      digest: `sha256:${'b'.repeat(64)}`,
      platform: { os: 'unknown', architecture: 'unknown' },
      annotations: { 'vnd.docker.reference.type': 'attestation-manifest' }
    }
  ]);
  await h.registry.source(h.identity);
  h.routes.set(
    `manifests/${h.identity.integration_tag}`,
    response({ schemaVersion: 2 })
  );
  await assert.rejects(h.registry.source(h.identity), /NG tag digest mismatch/);
});

function githubFixture(mode) {
  const original = 'a'.repeat(40);
  const created = 'c'.repeat(40);
  let head = original;
  const writes = [];
  let headReads = 0;
  const github = new GitHub({
    token: 'secret',
    fetcher: async (url, options) => {
      const path = url.split('/repos/piggei/ghostfolio/')[1];
      const body = options.body && JSON.parse(options.body);
      if (path === `git/commits/${created}`)
        return response({
          sha: created,
          parents: [{ sha: original }],
          tree: { sha: 'd'.repeat(40) }
        });
      if (options.method !== 'GET')
        writes.push({ path, method: options.method, body });
      if (path.startsWith('git/ref/heads/')) {
        headReads++;
        if (mode === 'concurrent-before' && headReads === 2)
          head = 'f'.repeat(40);
        return response({ object: { sha: head } });
      }
      if (path === `git/commits/${original}`)
        return response({ tree: { sha: 'b'.repeat(40) } });
      if (path === 'git/trees') return response({ sha: 'd'.repeat(40) });
      if (path === 'git/commits') return response({ sha: created });
      if (path.startsWith('git/refs/heads/')) {
        assert.equal(body.force, false);
        if (mode === 'concurrent-race') {
          head = 'f'.repeat(40);
          return response({}, 422);
        }
        head = created;
        if (mode === 'lost-response') throw new Error('Lost GitHub response');
        return response({
          ref: 'refs/heads/feat/home-assistant-addon',
          object: { type: 'commit', sha: head }
        });
      }
      throw new Error(`Unexpected API ${path}`);
    }
  });
  return { github, original, created, writes, head: () => head };
}

test('GitHub commit checks remote HEAD and preserves unrelated tree content', async () => {
  const h = githubFixture();
  assert.equal(
    await h.github.commit(
      h.original,
      { 'home-assistant-addon/release.json': '{}' },
      'test'
    ),
    h.created
  );
  const tree = h.writes.find((w) => w.path === 'git/trees');
  assert.equal(tree.body.base_tree, 'b'.repeat(40));
  assert.equal(tree.body.tree.length, 1);
  assert.deepEqual(
    h.writes.find((w) => w.path === 'git/commits').body.parents,
    [h.original]
  );
});

for (const mode of ['concurrent-before', 'concurrent-race']) {
  test(`GitHub ${mode} fails without force or overwriting the remote commit`, async () => {
    const h = githubFixture(mode);
    await assert.rejects(h.github.commit(h.original, { file: 'new' }, 'test'));
    assert.equal(h.head(), 'f'.repeat(40));
  });
}

test('GitHub lost branch update response recovers only the exact created commit', async () => {
  const h = githubFixture('lost-response');
  assert.equal(
    await h.github.commit(h.original, { file: 'new' }, 'test'),
    h.created
  );
});

test('GitHub provenance resolves the actual tag commit and checks the NG release job', async () => {
  const identity = {
    integration_tag: 'integration-3.97.0-15',
    source_commit: 'a'.repeat(40),
    ghostfolio_version: '3.97.0'
  };
  for (const mode of [
    'success',
    'wrong-commit',
    'failed-job',
    'draft',
    'wrong-version'
  ]) {
    const run = {
      id: 15,
      run_number: 15,
      run_attempt: 1,
      workflow_id: 7,
      repository: { full_name: 'piggei/ghostfolio' },
      head_sha: identity.source_commit,
      head_branch: 'integration/ghostfolio-all-pr',
      path: '.github/workflows/integration-release.yml',
      status: 'completed',
      conclusion: 'success'
    };
    const github = new GitHub({
      fetcher: async (url) => {
        const path = url.split('/repos/piggei/ghostfolio/')[1];
        if (path.startsWith('releases/'))
          return response({
            tag_name: identity.integration_tag,
            draft: mode === 'draft',
            prerelease: false
          });
        if (path.startsWith('git/ref/tags/'))
          return response({
            object: {
              type: 'commit',
              sha: (mode === 'wrong-commit' ? 'b' : 'a').repeat(40)
            }
          });
        if (path.startsWith('contents/package.json'))
          return response({
            type: 'file',
            encoding: 'base64',
            content: Buffer.from(
              JSON.stringify({
                version: mode === 'wrong-version' ? '3.98.0' : '3.97.0'
              })
            ).toString('base64')
          });
        if (path === 'actions/workflows/integration-release.yml')
          return response({ id: 7, path: run.path });
        if (path.startsWith('actions/workflows/'))
          return response({ workflow_runs: [run] });
        if (path.includes('/attempts/'))
          return response({
            jobs: [
              {
                name: 'release',
                run_id: 15,
                head_sha: identity.source_commit,
                status: 'completed',
                conclusion: mode === 'failed-job' ? 'failure' : 'success'
              }
            ]
          });
        if (path === 'actions/runs/15') return response(run);
        throw new Error(path);
      }
    });
    if (mode === 'success') await github.verifySource(identity);
    else await assert.rejects(github.verifySource(identity));
  }
});

test('Git tag create is idempotent, detects conflicts and recovers a lost response', async () => {
  for (const mode of [
    'missing',
    'identical',
    'conflicting',
    'lost-response',
    'forbidden'
  ]) {
    const commit = 'a'.repeat(40);
    let existing =
      mode === 'missing' || mode === 'lost-response'
        ? null
        : mode === 'conflicting'
          ? 'b'.repeat(40)
          : commit;
    let creates = 0;
    const github = new GitHub({
      fetcher: async (url, options) => {
        if (mode === 'forbidden') return response({}, 403);
        if (options.method === 'POST') {
          creates++;
          existing = JSON.parse(options.body).sha;
          if (mode === 'lost-response') throw new Error('Lost tag response');
          return response({});
        }
        return existing
          ? response({ object: { type: 'commit', sha: existing } })
          : response({}, 404);
      }
    });
    const operation = github.ensureTag({ addon_version: '3.97.1' }, commit);
    if (['conflicting', 'forbidden'].includes(mode))
      await assert.rejects(operation);
    else await operation;
    assert.ok(creates <= 1);
    if (mode === 'identical') assert.equal(creates, 0);
    if (mode === 'conflicting') assert.equal(existing, 'b'.repeat(40));
  }
});

test('add-on revision guard permits metadata-only changes and rejects build/config drift', async () => {
  for (const mode of [
    'metadata-only',
    'build-drift',
    'config-drift',
    'truncated'
  ]) {
    const revision = 'a'.repeat(40);
    const head = 'b'.repeat(40);
    const github = new GitHub({
      fetcher: async (url) => {
        const path = url.split('/repos/piggei/ghostfolio/')[1];
        if (path.startsWith('git/commits/'))
          return response({
            tree: { sha: path.endsWith(revision) ? revision : head }
          });
        if (path.startsWith('git/trees/')) {
          const changed = path.includes(head);
          return response({
            truncated: mode === 'truncated',
            tree: [
              {
                type: 'blob',
                path: 'home-assistant-addon/Dockerfile',
                sha: changed && mode === 'build-drift' ? 'changed' : 'same'
              },
              {
                type: 'blob',
                path: 'home-assistant-addon/releases/registry.json',
                sha: changed ? 'new-state' : 'old-state'
              }
            ]
          });
        }
        if (path.startsWith('contents/')) {
          const changed = path.includes(head);
          const text = `version: "${changed ? '3.97.1' : '3.97.0'}"\nslug: ${changed && mode === 'config-drift' ? 'different' : 'ghostfolio_ng'}\n`;
          return response({
            type: 'file',
            encoding: 'base64',
            content: Buffer.from(text).toString('base64')
          });
        }
        throw new Error(path);
      }
    });
    if (mode === 'metadata-only')
      await github.verifyAddonRevision(revision, head);
    else await assert.rejects(github.verifyAddonRevision(revision, head));
  }
});

function provenanceFixture({
  alterRun = () => {},
  alterJobs = () => {},
  alterList = () => {},
  detailRace = () => {}
} = {}) {
  const identity = {
    integration_tag: 'integration-3.97.0-15',
    source_commit: 'a'.repeat(40),
    ghostfolio_version: '3.97.0'
  };
  const run = {
    id: 15,
    workflow_id: 7,
    run_number: 15,
    run_attempt: 2,
    head_sha: identity.source_commit,
    head_branch: 'integration/ghostfolio-all-pr',
    path: '.github/workflows/integration-release.yml',
    repository: { full_name: 'piggei/ghostfolio' },
    status: 'completed',
    conclusion: 'success'
  };
  alterRun(run);
  const calls = [];
  let reads = 0;
  const github = new GitHub({
    fetcher: async (url) => {
      const path = url.split('/repos/piggei/ghostfolio/')[1];
      calls.push(path);
      if (path.startsWith('releases/'))
        return response({
          tag_name: identity.integration_tag,
          draft: false,
          prerelease: false
        });
      if (path.startsWith('git/ref/tags/'))
        return response({
          object: { type: 'commit', sha: identity.source_commit }
        });
      if (path.startsWith('contents/package.json'))
        return response({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('{"version":"3.97.0"}').toString('base64')
        });
      if (path === 'actions/workflows/integration-release.yml')
        return response({
          id: 7,
          path: '.github/workflows/integration-release.yml'
        });
      if (path.startsWith('actions/workflows/')) {
        const runs = [structuredClone(run)];
        alterList(runs, path);
        return response({ workflow_runs: runs });
      }
      if (path === 'actions/runs/15') {
        const result = structuredClone(run);
        detailRace(result, ++reads);
        return response(result);
      }
      if (path.startsWith('actions/runs/15/attempts/2/jobs?')) {
        const jobs = [
          {
            name: 'release',
            run_id: 15,
            head_sha: identity.source_commit,
            status: 'completed',
            conclusion: 'success',
            run_attempt: 2
          }
        ];
        alterJobs(jobs);
        return response({ jobs });
      }
      // A success from a generic/older attempt must never be consulted.
      throw new Error(`Unexpected provenance API: ${path}`);
    }
  });
  return { github, identity, calls };
}

test('provenance accepts one completed successful retry and pins all jobs to that attempt', async () => {
  const h = provenanceFixture();
  await h.github.verifySource(h.identity);
  assert.equal(h.calls.filter((p) => p === 'actions/runs/15').length, 2);
  assert.ok(
    h.calls.includes('actions/runs/15/attempts/2/jobs?per_page=100&page=1')
  );
  assert.ok(!h.calls.some((p) => p.startsWith('actions/runs/15/jobs')));
  assert.ok(!h.calls.some((p) => p.includes('/attempts/1/')));
});

for (const [name, changes] of [
  ['run still in progress', { status: 'in_progress', conclusion: null }],
  ['failed run despite successful release job', { conclusion: 'failure' }],
  ['cancelled run', { conclusion: 'cancelled' }],
  ['timed-out run', { conclusion: 'timed_out' }],
  ['different release number', { run_number: 16 }],
  ['different source commit', { head_sha: 'b'.repeat(40) }],
  ['different branch', { head_branch: 'main' }],
  ['different workflow', { workflow_id: 8 }],
  ['different workflow path', { path: '.github/workflows/other.yml' }],
  ['different repository', { repository: { full_name: 'other/ghostfolio' } }],
  ['invalid attempt', { run_attempt: 0 }]
]) {
  test(`provenance rejects ${name}`, async () => {
    const h = provenanceFixture({
      alterRun: (run) => Object.assign(run, changes)
    });
    await assert.rejects(h.github.verifySource(h.identity));
  });
}

for (const [name, change] of [
  ['duplicate release jobs', (jobs) => jobs.push({ ...jobs[0] })],
  [
    'missing release job in latest attempt',
    (jobs) => {
      jobs[0].name = 'verify';
    }
  ],
  [
    'job from another run',
    (jobs) => {
      jobs[0].run_id = 16;
    }
  ],
  [
    'job from another commit',
    (jobs) => {
      jobs[0].head_sha = 'b'.repeat(40);
    }
  ],
  [
    'job from an older attempt',
    (jobs) => {
      jobs[0].run_attempt = 1;
    }
  ],
  [
    'unfinished release job',
    (jobs) => {
      jobs[0].status = 'in_progress';
    }
  ],
  [
    'failed release job',
    (jobs) => {
      jobs[0].conclusion = 'failure';
    }
  ]
]) {
  test(`provenance rejects ${name}`, async () => {
    const h = provenanceFixture({ alterJobs: change });
    await assert.rejects(h.github.verifySource(h.identity));
  });
}

test('provenance rejects ambiguous matching runs across pages', async () => {
  const h = provenanceFixture({
    alterList: (runs, path) => {
      if (path.endsWith('page=1')) {
        const unrelated = { ...runs[0], run_number: 99 };
        while (runs.length < 100) runs.push({ ...unrelated });
      } else runs[0].id = 16;
    }
  });
  await assert.rejects(h.github.verifySource(h.identity), /ambiguous/);
});

for (const [name, change] of [
  [
    'a new retry during selection',
    (run, read) => {
      if (read === 1) run.run_attempt = 3;
    }
  ],
  [
    'a new retry while jobs are being read',
    (run, read) => {
      if (read === 2) run.run_attempt = 3;
    }
  ],
  [
    'a run becoming incomplete during verification',
    (run, read) => {
      if (read === 2) run.status = 'in_progress';
    }
  ],
  [
    'a run identity changing during verification',
    (run, read) => {
      if (read === 2) run.head_sha = 'b'.repeat(40);
    }
  ]
]) {
  test(`provenance rejects ${name}`, async () => {
    const h = provenanceFixture({ detailRace: change });
    await assert.rejects(h.github.verifySource(h.identity));
  });
}
