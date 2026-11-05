import assert from 'node:assert/strict';

import { httpRead } from './home-assistant-addon-http-read.mjs';

export const branch = 'feat/home-assistant-addon';
export const registryPath = 'home-assistant-addon/releases/registry.json';
export const manifestPath = 'home-assistant-addon/release.json';
export const configPath = 'home-assistant-addon/config.yaml';
export const docPaths = [
  'home-assistant-addon/README.md',
  'home-assistant-addon/DOCS.md'
];
const shaPattern = /^[a-f0-9]{40}$/;

export class GitHub {
  constructor({
    fetcher = fetch,
    token = process.env.GH_TOKEN,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}) {
    this.fetcher = fetcher;
    this.token = token;
    this.sleep = sleep;
  }

  async api(path, method = 'GET', body, missing = false) {
    const url = `https://api.github.com/repos/piggei/ghostfolio/${path}`;
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    };

    if (method === 'GET') {
      const response = await httpRead(this.fetcher, url, options, {
        service: 'GitHub',
        operation: 'read API resource',
        sleep: this.sleep
      });

      if (missing && response.status === 404) return null;

      if (response.status < 200 || response.status >= 300) {
        throw Object.assign(new Error(`GitHub GET HTTP ${response.status}`), {
          status: response.status,
          ambiguous: false
        });
      }

      return response.body;
    }

    let response;

    try {
      response = await this.fetcher(url, {
        ...options,
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      if (method === 'PATCH') error.ambiguous = true;
      throw error;
    }

    if (missing && response.status === 404) return null;

    if (!response.ok) {
      throw Object.assign(
        new Error(`GitHub ${method} HTTP ${response.status}`),
        {
          status: response.status,
          ambiguous:
            method === 'PATCH' &&
            (response.status === 408 || response.status >= 500)
        }
      );
    }

    try {
      return await response.json();
    } catch (error) {
      if (method === 'PATCH') error.ambiguous = true;
      throw error;
    }
  }

  async head() {
    const ref = await this.api(`git/ref/heads/${branch}`);
    assert.match(ref.object.sha, shaPattern);
    return ref.object.sha;
  }

  async file(path, ref) {
    const value = await this.api(
      `contents/${path}?ref=${encodeURIComponent(ref)}`
    );
    assert.equal(value.type, 'file');
    assert.equal(value.encoding, 'base64');
    return Buffer.from(value.content, 'base64').toString();
  }

  async confirmHead(expected, predecessor, observed) {
    assert.match(expected, shaPattern);
    assert.match(predecessor, shaPattern);
    assert.notEqual(expected, predecessor);
    const delays = [100, 250, 500, 1000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const head = observed ?? (await this.head());
      observed = undefined;
      if (head === expected) return head;
      assert.equal(head, predecessor, 'Concurrent remote branch update');
      assert.ok(
        attempt < delays.length,
        'Remote branch confirmation timed out'
      );
      await this.sleep(delays[attempt]);
    }
  }

  async snapshot(expected) {
    if (expected) assert.match(expected, shaPattern);
    let head = await this.head();
    if (expected && head !== expected) {
      // Only the immutable expected commit's single, verified parent may be stale.
      const commit = await this.api(`git/commits/${expected}`);
      assert.equal(commit.sha, expected, 'Unexpected snapshot commit');
      assert.equal(commit.parents.length, 1, 'Ambiguous snapshot predecessor');
      const predecessor = commit.parents[0].sha;
      head = await this.confirmHead(expected, predecessor, head);
    }
    const files = {};
    for (const path of [registryPath, manifestPath, configPath, ...docPaths])
      files[path] = await this.file(path, head);
    return { head, files };
  }

  async resolveTag(tag) {
    let object = (await this.api(`git/ref/tags/${encodeURIComponent(tag)}`))
      .object;
    for (let count = 0; object.type === 'tag' && count < 5; count++) {
      object = (await this.api(`git/tags/${object.sha}`)).object;
    }
    assert.equal(object.type, 'commit');
    assert.match(object.sha, shaPattern);
    return object.sha;
  }

  async verifySource(identity) {
    const release = await this.api(
      `releases/tags/${encodeURIComponent(identity.integration_tag)}`
    );
    assert.equal(release.tag_name, identity.integration_tag);
    assert.equal(release.draft, false);
    assert.equal(release.prerelease, false);
    assert.equal(
      await this.resolveTag(identity.integration_tag),
      identity.source_commit,
      'NG source commit mismatch'
    );
    const packageJson = JSON.parse(
      await this.file('package.json', identity.source_commit)
    );
    assert.equal(packageJson.version, identity.ghostfolio_version);
    const number = identity.integration_tag.split('-').at(-1);
    const workflow = await this.api(
      'actions/workflows/integration-release.yml'
    );
    assert.equal(workflow.path, '.github/workflows/integration-release.yml');
    assert.ok(Number.isSafeInteger(workflow.id) && workflow.id > 0);
    const belongsToRelease = (run) =>
      String(run.run_number) === number &&
      run.head_sha === identity.source_commit &&
      run.head_branch === 'integration/ghostfolio-all-pr' &&
      run.path === workflow.path &&
      run.workflow_id === workflow.id &&
      run.repository?.full_name === 'piggei/ghostfolio';
    const matches = [];
    for (let page = 1; ; page++) {
      const runs = await this.api(
        `actions/workflows/integration-release.yml/runs?head_sha=${identity.source_commit}&per_page=100&page=${page}`
      );
      matches.push(...runs.workflow_runs.filter(belongsToRelease));
      if (runs.workflow_runs.length < 100) break;
    }
    assert.equal(matches.length, 1, 'NG release run missing or ambiguous');
    const matched = matches[0];
    assert.ok(Number.isSafeInteger(matched.id) && matched.id > 0);
    const run = await this.api(`actions/runs/${matched.id}`);
    const validateRun = (value) => {
      assert.ok(belongsToRelease(value), 'NG run identity changed');
      assert.equal(value.id, matched.id);
      assert.equal(value.status, 'completed', 'NG run has not completed');
      assert.equal(value.conclusion, 'success', 'NG run did not succeed');
      assert.ok(
        Number.isSafeInteger(value.run_attempt) && value.run_attempt > 0
      );
    };
    validateRun(run);
    assert.equal(
      run.run_attempt,
      matched.run_attempt,
      'NG attempt changed during selection'
    );
    const jobs = [];
    for (let page = 1; ; page++) {
      const result = await this.api(
        `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`
      );
      jobs.push(...result.jobs);
      if (result.jobs.length < 100) break;
    }
    const releases = jobs.filter((job) => job.name === 'release');
    assert.equal(
      releases.length,
      1,
      'NG release job missing or ambiguous in selected attempt'
    );
    const job = releases[0];
    assert.equal(job.run_id, run.id, 'NG release job belongs to another run');
    assert.equal(
      job.head_sha,
      identity.source_commit,
      'NG release job source mismatch'
    );
    assert.equal(job.status, 'completed', 'NG release job has not completed');
    assert.equal(
      job.conclusion,
      'success',
      'NG publication job did not succeed'
    );
    if (job.run_attempt !== undefined)
      assert.equal(job.run_attempt, run.run_attempt);
    // Never combine jobs from an old attempt with a newly started rerun.
    const confirmed = await this.api(`actions/runs/${run.id}`);
    validateRun(confirmed);
    assert.equal(
      confirmed.run_attempt,
      run.run_attempt,
      'NG attempt changed during verification'
    );
  }

  async verifyAddonRevision(revision, head) {
    const trees = [];
    for (const ref of [revision, head]) {
      const commit = await this.api(`git/commits/${ref}`);
      const tree = await this.api(`git/trees/${commit.tree.sha}?recursive=1`);
      assert.equal(tree.truncated, false);
      trees.push(
        tree.tree
          .filter(
            (item) =>
              item.type === 'blob' &&
              (item.path.startsWith('home-assistant-addon/rootfs/') ||
                item.path === 'home-assistant-addon/Dockerfile' ||
                item.path.startsWith('tests/home-assistant-addon/') ||
                item.path.startsWith('scripts/home-assistant-addon-') ||
                item.path.startsWith('.github/workflows/home-assistant-addon'))
          )
          .map(({ path, sha }) => ({ path, sha }))
      );
    }
    assert.deepEqual(
      trees[0],
      trees[1],
      'Add-on source changed on remote branch'
    );
    const clean = (value) => value.replace(/^version:.*$/m, 'version: CURRENT');
    assert.equal(
      clean(await this.file(configPath, revision)),
      clean(await this.file(configPath, head)),
      'Add-on configuration changed'
    );
  }

  async commit(expectedHead, files, message) {
    assert.equal(
      await this.head(),
      expectedHead,
      'Concurrent remote branch update'
    );
    const parent = await this.api(`git/commits/${expectedHead}`);
    const tree = await this.api('git/trees', 'POST', {
      base_tree: parent.tree.sha,
      tree: Object.entries(files).map(([path, content]) => ({
        path,
        mode: '100644',
        type: 'blob',
        content
      }))
    });
    const commit = await this.api('git/commits', 'POST', {
      message,
      tree: tree.sha,
      parents: [expectedHead]
    });
    assert.match(commit.sha, shaPattern);
    const created = await this.api(`git/commits/${commit.sha}`);
    assert.equal(created.sha, commit.sha, 'Unexpected created commit');
    assert.equal(created.parents.length, 1, 'Ambiguous created predecessor');
    assert.equal(
      created.parents[0].sha,
      expectedHead,
      'Created commit parent mismatch'
    );
    assert.equal(created.tree.sha, tree.sha, 'Created commit tree mismatch');
    assert.equal(
      await this.head(),
      expectedHead,
      'Concurrent remote branch update'
    );
    let updated;
    let ambiguous;
    try {
      updated = await this.api(`git/refs/heads/${branch}`, 'PATCH', {
        sha: commit.sha,
        force: false
      });
    } catch (error) {
      if (!error.ambiguous) throw error;
      ambiguous = error;
    }
    if (!ambiguous) {
      assert.equal(updated.ref, `refs/heads/${branch}`, 'Unexpected PATCH ref');
      assert.equal(updated.object.type, 'commit', 'Unexpected PATCH object');
      assert.equal(updated.object.sha, commit.sha, 'Unexpected PATCH commit');
    }
    try {
      // Never retry PATCH or infer success from merely creating a commit object.
      await this.confirmHead(commit.sha, created.parents[0].sha);
    } catch (error) {
      if (ambiguous) error.cause = ambiguous;
      throw error;
    }
    return commit.sha;
  }

  async activationCommit(record) {
    const expected = { schema_version: 1, ...record };
    const message = `Activate Home Assistant ${record.addon_version}`;
    for (let page = 1; ; page++) {
      const commits = await this.api(
        `commits?sha=${encodeURIComponent(branch)}&path=${manifestPath}&per_page=100&page=${page}`
      );
      for (const commit of commits) {
        if (commit.commit.message !== message) continue;
        assert.deepEqual(
          JSON.parse(await this.file(manifestPath, commit.sha)),
          expected
        );
        const registry = JSON.parse(await this.file(registryPath, commit.sha));
        assert.equal(registry.current_release, record.identity.integration_tag);
        assert.deepEqual(
          registry.releases.find(
            (r) =>
              r.identity.integration_tag === record.identity.integration_tag
          ),
          record
        );
        assert.match(
          await this.file(configPath, commit.sha),
          new RegExp(
            `^version: "${record.addon_version.replaceAll('.', '\\.')}"$`,
            'm'
          )
        );
        return commit.sha;
      }
      assert.equal(commits.length, 100, 'Activation commit not found');
    }
  }

  async ensureTag(record, commit) {
    const tag = `home-assistant-addon/v${record.addon_version}`;
    const existing = await this.api(
      `git/ref/tags/${encodeURIComponent(tag)}`,
      'GET',
      undefined,
      true
    );
    if (existing) {
      assert.equal(
        await this.resolveTag(tag),
        commit,
        'Conflicting Home Assistant Git tag'
      );
      return;
    }
    try {
      await this.api('git/refs', 'POST', {
        ref: `refs/tags/${tag}`,
        sha: commit
      });
    } catch (error) {
      const recovered = await this.api(
        `git/ref/tags/${encodeURIComponent(tag)}`,
        'GET',
        undefined,
        true
      );
      if (!recovered || (await this.resolveTag(tag)) !== commit) throw error;
    }
    assert.equal(await this.resolveTag(tag), commit);
  }

  async checkTag(record) {
    if (record.state === 'activated') return;
    const tag = `home-assistant-addon/v${record.addon_version}`;
    const existing = await this.api(
      `git/ref/tags/${encodeURIComponent(tag)}`,
      'GET',
      undefined,
      true
    );
    assert.equal(
      existing,
      null,
      'Home Assistant Git tag already exists before activation'
    );
  }
}
