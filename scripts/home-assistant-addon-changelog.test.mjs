import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractReleaseNotes,
  mergeReleaseNotes
} from './home-assistant-addon-changelog.mjs';

const releaseBody = `Release introduction.

## Installation

- Installation instructions must not appear.

## Official Ghostfolio updates

### Added

- Added feature A.

### Changed

- Improved feature B.

#### Special Thanks

- @contributor

## Integration-specific changes

- Fixed integration C.

## Project status

- This must not appear.
`;

test('extracts only the two requested release sections', () => {
  const notes = extractReleaseNotes(releaseBody);

  assert.equal(notes.length, 2);

  assert.ok(notes[0].includes('Added feature A.'));
  assert.ok(notes[1].includes('Fixed integration C.'));

  assert.ok(!notes.join('\n').includes('Installation instructions'));
  assert.ok(!notes.join('\n').includes('This must not appear.'));
});

test('generated changelog remains Prettier-compliant and idempotent', async () => {
  const { format } = await import('prettier');

  const scenarios = [
    {
      name: 'multiple sections',
      existing: '',
      incoming: [
        '## Official Ghostfolio updates\n\n### Added\n\n- Feature A.\n\n### Changed\n\n- Feature B.',
        '## Integration-specific changes\n\n- Fix C.'
      ]
    },
    {
      name: 'repeated notes',
      existing: '',
      incoming: [
        '## Integration-specific changes\n\n- Fix A.\n- Fix A.\n- Fix B.'
      ]
    },
    {
      name: 'existing version',
      existing:
        '# Ghostfolio-NG Home Assistant Add-on Changelog\n\n## 3.99.2\n\n### Integration-specific changes\n\n- Existing fix.\n',
      incoming: ['## Integration-specific changes\n\n- New fix.']
    }
  ];

  for (const scenario of scenarios) {
    const generated = mergeReleaseNotes(
      scenario.existing,
      '3.99.2',
      scenario.incoming
    );

    const formatted = await format(generated, {
      filepath: 'home-assistant-addon/CHANGELOG.md'
    });

    assert.equal(generated, formatted, scenario.name);

    assert.equal(
      mergeReleaseNotes(generated, '3.99.2', scenario.incoming),
      generated,
      `${scenario.name}: idempotence`
    );
  }
});

test('preserves Markdown heading hierarchy', () => {
  const notes = extractReleaseNotes(releaseBody);

  const merged = mergeReleaseNotes('', '3.99.1', notes);

  assert.match(merged, /## 3\.99\.1/);
  assert.match(merged, /### Official Ghostfolio updates/);
  assert.match(merged, /#### Added/);
  assert.match(merged, /#### Changed/);
  assert.match(merged, /##### Special Thanks/);
  assert.match(merged, /### Integration-specific changes/);
});

test('deduplicates complete content blocks without losing headings', () => {
  const first = extractReleaseNotes(releaseBody);
  const existing = mergeReleaseNotes('', '3.99.0', first);

  const second = extractReleaseNotes(`## Official Ghostfolio updates

### Added

- Added feature A.
- Added feature C.

### Changed

- Improved feature B.
- Improved feature D.

## Integration-specific changes

- Fixed integration C.
- Fixed integration D.
`);

  const merged = mergeReleaseNotes(existing, '3.99.1', second);

  assert.equal(merged.split('- Added feature A.').length - 1, 1);
  assert.equal(merged.split('- Improved feature B.').length - 1, 1);
  assert.equal(merged.split('- Fixed integration C.').length - 1, 1);

  assert.ok(merged.includes('- Added feature C.'));
  assert.ok(merged.includes('- Improved feature D.'));
  assert.ok(merged.includes('- Fixed integration D.'));

  assert.match(merged, /## 3\.99\.0/);
  assert.match(merged, /## 3\.99\.1/);
});

test('does not modify the changelog when all notes are duplicates', () => {
  const notes = extractReleaseNotes(releaseBody);
  const existing = mergeReleaseNotes('', '3.99.1', notes);

  assert.equal(mergeReleaseNotes(existing, '3.99.1', notes), existing);
});

test('keeps historical versions unchanged', () => {
  const existing = `# Ghostfolio-NG Home Assistant Add-on Changelog

## 3.99.0

### Added

- Historical feature.
`;

  const merged = mergeReleaseNotes(existing, '3.99.1', [
    '## Official Ghostfolio updates\n\n### Added\n\n- New feature.'
  ]);

  assert.ok(merged.includes('- Historical feature.'));
  assert.ok(merged.includes('- New feature.'));
  assert.ok(merged.indexOf('## 3.99.1') < merged.indexOf('## 3.99.0'));
});

test('rejects invalid version and input types', () => {
  assert.throws(() => mergeReleaseNotes('', '../invalid', []));
  assert.throws(() => extractReleaseNotes(null));
  assert.throws(() => mergeReleaseNotes('', '3.99.1', 'invalid'));
});

test('release notes archive preserves the complete NG identity', async () => {
  const { releaseNotesArchive, validateReleaseNotesArchive } =
    await import('./home-assistant-addon-changelog.mjs');

  const identity = {
    integration_tag: 'integration-3.99.0-21',
    source_commit: 'a'.repeat(40),
    source_image: `ghcr.io/piggei/ghostfolio-ng@sha256:${'b'.repeat(64)}`,
    ghostfolio_version: '3.99.0',
    addon_source_revision: 'c'.repeat(40)
  };

  const sections = [
    '## Official Ghostfolio updates\n\n### Added\n\n- Feature A.',
    '## Integration-specific changes\n\n- Fix B.'
  ];

  const archive = releaseNotesArchive(identity, sections);

  assert.equal(archive.schema_version, 1);
  assert.deepEqual(validateReleaseNotesArchive(archive, identity), sections);
});

test('release notes archive rejects a different NG identity', async () => {
  const { releaseNotesArchive, validateReleaseNotesArchive } =
    await import('./home-assistant-addon-changelog.mjs');

  const identity = {
    integration_tag: 'integration-3.99.0-21',
    source_commit: 'a'.repeat(40),
    source_image: `ghcr.io/piggei/ghostfolio-ng@sha256:${'b'.repeat(64)}`,
    ghostfolio_version: '3.99.0',
    addon_source_revision: 'c'.repeat(40)
  };

  const archive = releaseNotesArchive(identity, []);

  assert.throws(() =>
    validateReleaseNotesArchive(archive, {
      ...identity,
      integration_tag: 'integration-3.99.0-22'
    })
  );
});

test('deduplicates consecutive bullet lines from historical changelog', () => {
  const existing = `# Ghostfolio-NG Home Assistant Add-on Changelog

## 3.99.0

### Official Ghostfolio updates

#### Added

- Feature A.
- Feature B.
- Feature C.
`;

  const incoming = [
    `## Official Ghostfolio updates

### Added

- Feature A.
- Feature B.
- Feature D.`
  ];

  const merged = mergeReleaseNotes(existing, '3.99.1', incoming);

  assert.equal(merged.split('- Feature A.').length - 1, 1);
  assert.equal(merged.split('- Feature B.').length - 1, 1);
  assert.equal(merged.split('- Feature C.').length - 1, 1);
  assert.equal(merged.split('- Feature D.').length - 1, 1);
});
