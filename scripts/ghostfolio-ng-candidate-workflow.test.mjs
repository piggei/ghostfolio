import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  '.github/workflows/ghostfolio-ng-candidate-test.yml',
  'utf8'
);

test('candidate push qualifies both native architectures with NG enabled', () => {
  assert.match(
    workflow,
    /on:\n  push:\n    branches:\n(?:      - .+\n)*      - integration\/ghostfolio-3\.99-candidate\n/
  );
  assert.match(workflow, /if: github\.repository == 'piggei\/ghostfolio'/);
  assert.match(workflow, /- arch: amd64\n\s+runner: ubuntu-latest/);
  assert.match(workflow, /- arch: arm64\n\s+runner: ubuntu-24\.04-arm/);
  assert.ok(workflow.includes('runs-on: ${{ matrix.runner }}'));
  assert.ok(workflow.includes('platforms: linux/${{ matrix.arch }}'));
  assert.match(workflow, /build-args: \|\n\s+GHOSTFOLIO_NG=true\n/);
  assert.match(workflow, /load: true/);
  assert.match(workflow, /EXPECT_GHOSTFOLIO_NG: 'true'/);
  assert.ok(workflow.includes('TARGET_ARCH: ${{ matrix.arch }}'));
  assert.ok(
    workflow.includes(
      'bash scripts/ghostfolio-ng-smoke-test.sh "ghostfolio-ng:candidate-${TARGET_ARCH}"'
    )
  );
});

test('candidate qualification has no image, Git tag, or release publishing steps', () => {
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.equal(workflow.match(/permissions:/g).length, 1);
  assert.doesNotMatch(workflow, /:\s*write\b|outputs:|secrets\./);
  assert.match(workflow, /push: false/);
  assert.ok(
    workflow.includes('tags: ghostfolio-ng:candidate-${{ matrix.arch }}')
  );
  const actions = [...workflow.matchAll(/uses: (\S+)/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(actions, [
    'actions/checkout@v4',
    'docker/setup-buildx-action@v3',
    'docker/build-push-action@v6'
  ]);
  assert.doesNotMatch(
    workflow,
    /docker\s+(?:push|login)|imagetools\s+create|git\s+(?:push|tag)|gh\s+release|publish-release|promote-release/
  );
});
