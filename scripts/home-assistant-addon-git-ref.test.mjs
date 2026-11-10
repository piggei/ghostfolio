import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GitHub, branch } from './home-assistant-addon-github.mjs';

const before = 'a'.repeat(40);
const target = 'c'.repeat(40);
const foreign = 'f'.repeat(40);
const tree = 'd'.repeat(40);

function fixture({
  reads = [target],
  patch = 'ok',
  parents = [{ sha: before }],
  createdSha = target,
  createdTree = tree,
  snapshot = false,
  patchValue
} = {}) {
  const calls = [];
  const delays = [];
  let patched = false;
  let index = 0;
  const github = new GitHub({
    token: 'local-mock',
    sleep: async (ms) => delays.push(ms),
    fetcher: async (url, options) => {
      const path = url.split('/repos/piggei/ghostfolio/')[1];
      const body = options.body && JSON.parse(options.body);
      calls.push({ path, method: options.method, body });
      let value;
      if (path === `git/ref/heads/${branch}`) {
        const next =
          snapshot || patched
            ? reads[Math.min(index++, reads.length - 1)]
            : before;
        if (next === 'read-error') throw new Error('HEAD read failed');
        value = { object: { sha: next } };
      } else if (path === `git/commits/${before}`) {
        value = { tree: { sha: 'b'.repeat(40) } };
      } else if (path === `git/commits/${target}`) {
        value = { sha: createdSha, parents, tree: { sha: createdTree } };
      } else if (path === 'git/trees') {
        assert.equal(body.base_tree, 'b'.repeat(40));
        value = { sha: tree };
      } else if (path === 'git/commits') {
        assert.deepEqual(body.parents, [before]);
        value = { sha: target };
      } else if (options.method === 'PATCH') {
        assert.equal(path, `git/refs/heads/${branch}`);
        assert.deepEqual(body, { sha: target, force: false });
        patched = true;
        if (patch === 'lost') throw new TypeError('Lost PATCH response');
        if (patch === 'timeout')
          throw new DOMException('PATCH timed out', 'TimeoutError');
        if (patch === 'invalid-json') return new Response('{', { status: 200 });
        if (typeof patch === 'number')
          return new Response('{}', { status: patch });
        value = patchValue ?? {
          ref: `refs/heads/${branch}`,
          object: { type: 'commit', sha: target }
        };
      } else if (path.startsWith('contents/')) {
        value = {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('{}').toString('base64')
        };
      } else throw new Error(`Unexpected mock request ${path}`);
      return new Response(JSON.stringify(value), { status: 200 });
    }
  });
  return {
    github,
    calls,
    delays,
    patches: () => calls.filter((c) => c.method === 'PATCH'),
    commit: () => github.commit(before, { file: 'new' }, 'test')
  };
}

for (const reads of [
  [target],
  [before, target],
  [before, before, before, before, target]
]) {
  test(`successful PATCH reconciles only verified predecessor: ${reads.length} reads`, async () => {
    const h = fixture({ reads });
    assert.equal(await h.commit(), target);
    assert.equal(h.patches().length, 1);
    assert.equal(h.delays.length, reads.length - 1);
  });
}

for (const reads of [[foreign], [before, foreign], [before]]) {
  test(`post-PATCH divergent or permanently stale HEAD fails: ${reads.join(',')}`, async () => {
    const h = fixture({ reads });
    await assert.rejects(
      h.commit(),
      reads.at(-1) === before ? /timed out/ : /Concurrent remote/
    );
    assert.equal(h.patches().length, 1);
    assert.equal(
      h.delays.length,
      reads.at(-1) === before ? 4 : reads.length - 1
    );
  });
}

for (const patch of ['lost', 'timeout', 'invalid-json', 500, 502, 503, 408]) {
  test(`ambiguous PATCH ${patch} requires observing exact target without another write`, async () => {
    const h = fixture({ patch, reads: [before, target] });
    assert.equal(await h.commit(), target);
    assert.equal(h.patches().length, 1);
    assert.deepEqual(h.delays, [100]);
  });
}

for (const patch of ['lost', 'timeout', 'invalid-json', 500]) {
  for (const reads of [[before], [foreign], ['read-error']]) {
    test(`ambiguous PATCH ${patch} cannot establish success from ${reads[0]}`, async () => {
      const h = fixture({ patch, reads });
      await assert.rejects(h.commit(), (error) => {
        assert.match(
          error.message,
          /timed out|Concurrent remote|HEAD read failed/
        );
        assert.ok(error.cause.ambiguous);
        assert.match(
          error.cause.message,
          /Lost PATCH response|PATCH timed out|JSON|HTTP 500/
        );
        return true;
      });
      assert.equal(h.patches().length, 1);
    });
  }
}

for (const patch of [401, 403, 409, 422, 429]) {
  test(`explicit HTTP ${patch} rejection is never accepted even if a later GET could match`, async () => {
    const h = fixture({ patch });
    await assert.rejects(h.commit(), new RegExp(`HTTP ${patch}`));
    assert.equal(h.patches().length, 1);
    assert.equal(
      h.calls.filter((c) => c.path === `git/ref/heads/${branch}`).length,
      2
    );
    assert.equal(h.delays.length, 0);
  });
}

for (const options of [
  { parents: [{ sha: foreign }] },
  { parents: [] },
  { parents: [{ sha: before }, { sha: foreign }] },
  { createdSha: foreign },
  { createdTree: foreign }
]) {
  test(`created commit metadata must prove expected parent and tree: ${JSON.stringify(options)}`, async () => {
    const h = fixture(options);
    await assert.rejects(h.commit());
    assert.equal(h.patches().length, 0);
  });
}

for (const patchValue of [
  {},
  { ref: 'refs/heads/main', object: { type: 'commit', sha: target } },
  { ref: `refs/heads/${branch}`, object: { type: 'tag', sha: target } },
  { ref: `refs/heads/${branch}`, object: { type: 'commit', sha: foreign } }
]) {
  test(`inconsistent successful PATCH payload fails closed: ${JSON.stringify(patchValue)}`, async () => {
    const h = fixture({ patchValue });
    await assert.rejects(h.commit());
    assert.equal(h.patches().length, 1);
    assert.equal(h.delays.length, 0);
  });
}

for (const reads of [[target], [before, target]]) {
  test(`snapshot reconciles a plan HEAD before reading files: ${reads.length} reads`, async () => {
    const h = fixture({ snapshot: true, reads });
    const result = await h.github.snapshot(target);
    assert.equal(result.head, target);
    assert.equal(
      h.calls.filter((c) => c.path.startsWith('contents/')).length,
      6
    );
    for (const c of h.calls.filter((c) => c.path.startsWith('contents/')))
      assert.ok(c.path.endsWith(`?ref=${target}`));
    assert.equal(h.patches().length, 0);
  });
}

for (const options of [
  { reads: [before] },
  { reads: [foreign] },
  { reads: [before, foreign] },
  { reads: [before], parents: [{ sha: foreign }] },
  { reads: [before], parents: [] },
  { reads: [before], createdSha: foreign },
  { reads: [before], parents: [{ sha: before }, { sha: foreign }] },
  { reads: [before, 'read-error'] }
]) {
  test(`snapshot never reads files after unconfirmed HEAD: ${JSON.stringify(options)}`, async () => {
    const h = fixture({ snapshot: true, ...options });
    await assert.rejects(h.github.snapshot(target));
    assert.equal(
      h.calls.filter((c) => c.path.startsWith('contents/')).length,
      0
    );
    assert.equal(h.patches().length, 0);
  });
}

test('snapshot without expected HEAD remains read-only and makes no ancestry inference', async () => {
  const h = fixture({ snapshot: true, reads: [before] });
  assert.equal((await h.github.snapshot()).head, before);
  assert.equal(
    h.calls.filter((c) => c.path.startsWith('git/commits/')).length,
    0
  );
  assert.equal(h.patches().length, 0);
});
