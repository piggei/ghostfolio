import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const release = readFileSync(
  '.github/workflows/home-assistant-addon.yml',
  'utf8'
);
const jobs = Object.fromEntries(
  [
    ...release.matchAll(
      /^  ([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:|$(?![\s\S]))/gm
    )
  ]
    .filter((match) =>
      ['prepare', 'qualify-amd64', 'qualify-aarch64', 'publish'].includes(
        match[1]
      )
    )
    .map((match) => [match[1], match[2]])
);

test('release entry points expose the same explicit immutable input contract', () => {
  for (const trigger of ['workflow_call', 'workflow_dispatch']) {
    const section = release
      .split(`  ${trigger}:\n`)[1]
      .split(/^  [a-z_]+:/m)[0];
    for (const input of [
      'integration_tag',
      'source_commit',
      'source_image',
      'ghostfolio_version',
      'addon_source_revision'
    ]) {
      assert.match(
        section,
        new RegExp(
          `      ${input}:\\n        description: [^\\n]+\\n        required: true\\n        type: string`
        )
      );
    }
  }
  assert.ok(release.includes("- 'home-assistant-addon/v*'"));
  for (const output of [
    'addon_version',
    'amd64_digest',
    'aarch64_digest',
    'metadata_commit',
    'publication_status'
  ]) {
    assert.ok(
      release.includes('value: ${{ jobs.publish.outputs.' + output + ' }}')
    );
    assert.ok(
      jobs.publish.includes(
        output + ': ${{ steps.publish.outputs.' + output + ' }}'
      )
    );
  }
});

test('native jobs are serialized and promotion depends on both completed qualifications', () => {
  assert.deepEqual(Object.keys(jobs), [
    'prepare',
    'qualify-amd64',
    'qualify-aarch64',
    'publish'
  ]);
  assert.match(jobs['qualify-amd64'], /needs: prepare/);
  assert.match(jobs['qualify-aarch64'], /needs: \[prepare, qualify-amd64\]/);
  assert.match(jobs.publish, /needs: \[prepare, qualify-aarch64\]/);
  assert.match(jobs['qualify-amd64'], /runs-on: ubuntu-latest/);
  assert.match(jobs['qualify-aarch64'], /runs-on: ubuntu-24.04-arm/);
  assert.ok(!release.includes('continue-on-error'));
  assert.ok(!release.includes('always()'));
  assert.ok(!jobs.publish.includes('build-push-action'));
  assert.match(
    release,
    /group: ghostfolio-home-assistant-release\n  cancel-in-progress: false/
  );
});

test('checkout refs, artifact chain and minimum per-job token permissions are explicit', () => {
  for (const [name, job] of Object.entries(jobs)) {
    assert.match(job, /persist-credentials: false/);
    assert.match(
      job,
      /ref: \$\{\{ (?:inputs.addon_source_revision \|\| github.sha|needs.prepare.outputs.addon_source_revision) \}\}/
    );
    assert.match(job, /contents: write/);
    assert.match(job, /actions: read/);
    assert.match(
      job,
      new RegExp(`packages: ${name === 'prepare' ? 'read' : 'write'}`)
    );
    assert.ok(!job.includes('write-all'));
  }
  assert.match(jobs.prepare, /name: ha-plan-prepare-/);
  assert.match(jobs['qualify-amd64'], /name: ha-plan-prepare-/);
  assert.match(jobs['qualify-amd64'], /name: ha-plan-amd64-/);
  assert.match(jobs['qualify-aarch64'], /name: ha-plan-amd64-/);
  assert.match(jobs['qualify-aarch64'], /name: ha-plan-aarch64-/);
  assert.match(jobs.publish, /name: ha-plan-aarch64-/);
  assert.ok(!release.includes('repository_dispatch'));
  assert.ok(!release.includes('integration-release.yml'));
});

test('both ordinary test workflows use the same smoke implementation without write permissions', () => {
  for (const [filename, arch] of [
    ['home-assistant-addon-test.yml', 'aarch64'],
    ['home-assistant-addon-test-amd64.yml', 'amd64']
  ]) {
    const yaml = readFileSync(`.github/workflows/${filename}`, 'utf8');
    assert.ok(
      yaml.includes(
        `run: node scripts/home-assistant-addon-workflow.mjs test ${arch}`
      )
    );
    assert.ok(yaml.includes('scripts/home-assistant-addon-*'));
    assert.ok(!yaml.includes(': write'));
    assert.ok(!yaml.includes('f79581ccb8'));
  }
  assert.ok(!release.includes('f79581ccb8'));
  assert.ok(
    !readFileSync('home-assistant-addon/Dockerfile', 'utf8').includes(
      'GHOSTFOLIO_IMAGE='
    )
  );
});

test('Ingress regression suite runs before Docker qualification', () => {
  const workflow = readFileSync(
    'scripts/home-assistant-addon-workflow.mjs',
    'utf8'
  );

  const testCommand = workflow.indexOf("if (command === 'test')");
  const ingressTest = workflow.indexOf(
    'scripts/home-assistant-addon-ingress-rewrite.test.mjs'
  );
  const dockerBuild = workflow.indexOf('docker.run([');

  assert.ok(testCommand >= 0);
  assert.ok(ingressTest > testCommand);
  assert.ok(dockerBuild > ingressTest);
});

test('shared smoke script retains the original runtime assertions and extends persistence', () => {
  const script = readFileSync(
    'scripts/home-assistant-addon-smoke-test.sh',
    'utf8'
  );
  const { assertions } = JSON.parse(
    readFileSync('tests/home-assistant-addon/runtime-assertions.json')
  );
  for (let line of assertions) {
    if (line.includes('uname -m')) continue; // The shared script checks both native runners.
    if (line === 'test "$arch" = \'arm64\'') line = 'test "$arch" = "$CI_ARCH"';
    assert.ok(script.includes(line), `Lost runtime assertion: ${line}`);
  }
  for (const check of [
    'pg_stat_activity',
    'Bearer invalid-token',
    'id -u node',
    'nginx "$CI_IMAGE" -t',
    'site.webmanifest',
    'android-chrome-512x512.png',
    '/api/v1/info',
    'verify_ingress_rewrite',
    'local expected="$direct"',
    'for resource in api assets; do',
    'if [ "$expected" != "$ingress" ]; then',
    'url(/assets/',
    'Angular CSS',
    'test "$css_count" -gt 0',
    'trap cleanup EXIT',
    'for lifecycle in restart recreate',
    'sha256sum /data/secrets/ghostfolio.env',
    'NOAUTH',
    'SELECT value FROM ha_release_persistence'
  ]) {
    assert.ok(script.includes(check), `Missing runtime coverage: ${check}`);
  }
});
