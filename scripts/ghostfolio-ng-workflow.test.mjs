import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  '.github/workflows/integration-release.yml',
  'utf8'
);

test('architecture candidate tags remain stable across retries', () => {
  assert.equal(
    workflow.split('candidate-${GITHUB_RUN_ID}-${ARCH}').length - 1,
    2
  );

  assert.equal(
    workflow.split('candidate-${GITHUB_RUN_ID}-${arch}').length - 1,
    1
  );

  assert.doesNotMatch(
    workflow,
    /candidate-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}-\$\{(?:ARCH|arch)\}/
  );
});

test('temporary multiarch candidate remains attempt-specific', () => {
  assert.match(
    workflow,
    /MULTIARCH_TAG:\s*candidate-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}-multiarch/
  );
});

test('release identity remains stable across retries', () => {
  assert.match(
    workflow,
    /tag=integration-\$\{version\}-\$\{GITHUB_RUN_NUMBER\}/
  );

  assert.doesNotMatch(
    workflow,
    /tag=integration-\$\{version\}-\$\{GITHUB_RUN_NUMBER\}\.\$\{GITHUB_RUN_ATTEMPT\}/
  );

  assert.match(
    workflow,
    /sha_tag=sha-\$\{GITHUB_SHA\}/
  );
});

test('OCI version label uses the stable package version', () => {
  assert.match(
    workflow,
    /org\.opencontainers\.image\.version=\$\{\{\s*needs\.prepare\.outputs\.version\s*\}\}/
  );
});

test('integration channel is protected against older release retries', () => {
  const guard = workflow.indexOf(
    'scripts/ghostfolio-ng-check-integration-order.sh'
  );

  const promotion = workflow.indexOf(
    'docker buildx imagetools create',
    workflow.indexOf('Advance integration channel after successful release')
  );

  assert.notEqual(guard, -1);
  assert.notEqual(promotion, -1);
  assert.ok(guard < promotion);

  const guardSection = workflow.slice(guard, promotion);

  assert.match(guardSection, /status.*-eq 10/);
  assert.match(guardSection, /Integration channel update skipped/);
  assert.match(guardSection, /exit 0/);
  assert.match(guardSection, /advance=false/);
  assert.match(guardSection, /advance=true/);

  const advanceCondition =
    "if: steps.integration_order.outputs.advance == 'true'";

  assert.ok(
    workflow.includes(advanceCondition),
    "Integration advancement must depend on the ordering decision"
  );
});

test('integration ordering checks active runs with read permission', () => {
  assert.match(
    workflow,
    /actions:\s*read/
  );

  assert.ok(
    workflow.includes(
      '"$GITHUB_REPOSITORY" "$TAG" "$GITHUB_RUN_ID"'
    )
  );

  assert.ok(
    workflow.includes('scripts/ghostfolio-ng-check-integration-order.test.mjs')
  );
});
