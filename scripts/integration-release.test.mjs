import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  changelogSections,
  generateReleaseCompose,
  includedReleases,
  integratedPullRequestsMarkdown,
  localPatchesMarkdown
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

const localPatch = {
  id: 'fx-cache-context',
  title: 'Preserve FX context in cached portfolio snapshots',
  category: 'Portfolio calculations',
  source: 'fix/portfolio-cached-fx-context',
  manifest: 'docker/patches/fx-cache-context.json',
  integrationCommit: 'c9bd747985fcedbbf7a0ac01110510ac9a973746'
};

test('renders local patches grouped by category', () => {
  const markdown = localPatchesMarkdown({
    pullRequests: [],
    localPatches: [localPatch]
  });

  assert.match(markdown, /### Portfolio calculations/);
  assert.match(markdown, /Preserve FX context/);
  assert.match(markdown, /fx-cache-context/);
  assert.match(markdown, /fix\/portfolio-cached-fx-context/);
  assert.match(markdown, /docker\/patches\/fx-cache-context\.json/);
});

test('supports legacy manifests without local patches', () => {
  assert.match(localPatchesMarkdown({ pullRequests: [] }), /No local patches/);
});

test('supports an empty local patch list', () => {
  assert.match(
    localPatchesMarkdown({ pullRequests: [], localPatches: [] }),
    /No local patches/
  );
});

test('rejects duplicate local patch identifiers', () => {
  assert.throws(
    () =>
      localPatchesMarkdown({
        pullRequests: [],
        localPatches: [localPatch, { ...localPatch }]
      }),
    /Duplicate local patch/
  );
});

test('rejects malformed local patch entries', () => {
  const invalid = [
    { ...localPatch, id: '../invalid' },
    { ...localPatch, title: '' },
    { ...localPatch, source: '' },
    { ...localPatch, manifest: '../invalid.json' },
    { ...localPatch, manifest: 'docker/patches/other.json' }
  ];

  for (const patch of invalid) {
    assert.throws(
      () =>
        localPatchesMarkdown({
          pullRequests: [],
          localPatches: [patch]
        }),
      /Invalid local patch entry/
    );
  }
});

test('rejects invalid integration commit hashes', () => {
  for (const integrationCommit of ['', 'abc123', 'z'.repeat(40)]) {
    assert.throws(
      () =>
        localPatchesMarkdown({
          pullRequests: [],
          localPatches: [{ ...localPatch, integrationCommit }]
        }),
      /Invalid local patch entry/
    );
  }
});

test('does not assign upstream PR numbers to local patches', () => {
  const markdown = localPatchesMarkdown({
    pullRequests: [],
    localPatches: [localPatch]
  });

  assert.ok(!markdown.includes('github.com/ghostfolio/ghostfolio/pull/'));
  assert.ok(!markdown.includes('PR #'));
});

test('generates Ghostfolio-NG release Compose with the correct image', () => {
  const template = [
    'services:',
    '  ghostfolio:',
    '    image: docker.io/ghostfolio/ghostfolio:latest',
    '    env_file:',
    '      - ../.env'
  ].join('\n');

  const compose = generateReleaseCompose(
    template,
    'ghcr.io/piggei/ghostfolio-ng',
    'integration-3.94.0-8.1'
  );

  assert.ok(
    compose.includes(
      'ghcr.io/piggei/ghostfolio-ng:integration-3.94.0-8.1'
    )
  );
  assert.ok(!compose.includes('docker.io/ghostfolio/ghostfolio:latest'));
  assert.ok(compose.includes('- .env'));
});

test('rejects missing or duplicated Ghostfolio Compose image', () => {
  const source = 'docker.io/ghostfolio/ghostfolio:latest';
  const image = 'ghcr.io/piggei/ghostfolio-ng';
  const tag = 'integration-3.94.0-8.1';

  assert.throws(
    () => generateReleaseCompose('services: {}', image, tag),
    /Expected exactly one/
  );

  assert.throws(
    () => generateReleaseCompose(`${source}\n${source}`, image, tag),
    /Expected exactly one/
  );
});
