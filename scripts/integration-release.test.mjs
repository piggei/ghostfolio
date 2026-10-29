import assert from 'node:assert/strict';
import { test } from 'node:test';

import { changelogSections, includedReleases } from './integration-release.mjs';

const changelog = `# Changelog

## Unreleased

### Changed
- New endpoint

## 3.100.0 - 2026-11-01

### Fixed
- Future change

## 3.94.0 - 2026-10-28

### Fixed
- Current fix

## 3.93.0 - 2026-10-25

- Previous fix

## 3.92.0 - 2026-10-24

- Old fix
`;

test('release notes keep complete sections including the final section', () => {
  const sections = changelogSections(changelog);
  assert.equal(sections.length, 5);
  assert.match(sections[0].body, /New endpoint/);
  assert.equal(sections.at(-1).body, '- Old fix');
});

test('include new official releases, excluding old and future releases', () => {
  assert.deepEqual(
    includedReleases(changelogSections(changelog), '3.94.0', '3.92.0').map(
      ({ version }) => version
    ),
    ['3.94.0', '3.93.0']
  );
});

test('an update within the same official version does not repeat release notes', () => {
  assert.deepEqual(
    includedReleases(changelogSections(changelog), '3.94.0', '3.94.0'),
    []
  );
});

test('without a baseline include only the current official version', () => {
  assert.deepEqual(
    includedReleases(changelogSections(changelog), '3.94.0').map(
      ({ version }) => version
    ),
    ['3.94.0']
  );
});
