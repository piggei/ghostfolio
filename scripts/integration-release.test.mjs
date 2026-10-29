import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  changelogSections,
  includedReleases,
  integratedPullRequestsMarkdown
} from './integration-release.mjs';

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

test('renders integrated Pull Requests grouped by category', () => {
  const markdown = integratedPullRequestsMarkdown({
    pullRequests: [
      {
        number: 8221,
        title: 'Implement time-weighted return calculation',
        category: 'Portfolio calculations'
      },
      {
        number: 8315,
        title: 'Allow renaming fee activities',
        category: 'Activity management'
      }
    ]
  });

  assert.match(markdown, /### Portfolio calculations/);
  assert.match(markdown, /### Activity management/);
  assert.ok(
    markdown.includes('https://github.com/ghostfolio/ghostfolio/pull/8221')
  );
  assert.ok(
    markdown.includes('https://github.com/ghostfolio/ghostfolio/pull/8315')
  );
});

test('rejects duplicate integrated Pull Request numbers', () => {
  assert.throws(
    () =>
      integratedPullRequestsMarkdown({
        pullRequests: [
          { number: 8221, title: 'TWR', category: 'Calculations' },
          { number: 8221, title: 'Duplicate', category: 'Features' }
        ]
      }),
    /Duplicate integrated PR/
  );
});

test('rejects malformed integrated Pull Request entries', () => {
  assert.throws(
    () =>
      integratedPullRequestsMarkdown({
        pullRequests: [{ number: -1, title: '', category: '' }]
      }),
    /Invalid integrated PR entry/
  );
});

test('supports an empty integrated Pull Request list', () => {
  assert.match(
    integratedPullRequestsMarkdown({ pullRequests: [] }),
    /No additional upstream Pull Requests/
  );
});

test('renders integrated PRs on separate Markdown lines', () => {
  const markdown = integratedPullRequestsMarkdown({
    pullRequests: [
      { number: 8220, title: 'ROI', category: 'Calculations' },
      { number: 8221, title: 'TWR', category: 'Calculations' }
    ]
  });

  const lines = markdown.split('\n');

  assert.equal(lines.filter((line) => line.startsWith('- [#')).length, 2);
  assert.ok(lines.includes('### Calculations'));
  assert.ok(!markdown.includes('\\\\n'));
});
