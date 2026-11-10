import assert from 'node:assert/strict';

const sections = [
  'Official Ghostfolio updates',
  'Integration-specific changes'
];

function parseBlocks(markdown) {
  const blocks = [];
  let headings = [];
  let current = [];

  const flush = () => {
    if (current.length) {
      blocks.push({
        headings: [...headings],
        content: current.join('\n')
      });
      current = [];
    }
  };

  for (const line of markdown.split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);

    if (heading) {
      flush();
      const level = heading[1].length;
      headings = headings.filter((item) => item.level < level);
      headings.push({ level, text: heading[2] });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks;
}

function existingLineKeys(markdown) {
  const keys = new Set();

  for (const block of parseBlocks(markdown)) {
    for (const line of block.content.split('\n')) {
      if (line.trim()) {
        keys.add(line.trim());
      }
    }
  }

  return keys;
}

export function extractReleaseNotes(body) {
  assert.equal(typeof body, 'string');

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const result = [];

  for (const section of sections) {
    const start = lines.indexOf(`## ${section}`);

    if (start < 0) continue;

    let end = lines.length;

    for (let i = start + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) {
        end = i;
        break;
      }
    }

    const content = lines.slice(start, end).join('\n').trim();

    if (content.split('\n').some((line) => /^[-*+]\s/.test(line))) {
      result.push(content);
    }
  }

  return result;
}

export function mergeReleaseNotes(existing, addonVersion, incoming) {
  assert.equal(typeof existing, 'string');
  assert.match(addonVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(Array.isArray(incoming));

  const known = existingLineKeys(existing);
  const additions = [];
  const added = new Set();

  for (const section of incoming) {
    assert.equal(typeof section, 'string');

    for (const block of parseBlocks(section)) {
      const lines = block.content.split('\n');
      const freshLines = [];

      for (const line of lines) {
        const key = line.trim();

        if (!line.trim() || known.has(key) || added.has(key)) continue;

        freshLines.push(line);
        added.add(key);
      }

      if (!freshLines.length) continue;

      additions.push({
        headings: block.headings.map((heading) => ({
          ...heading,
          level: Math.min(6, heading.level + 1)
        })),
        content: freshLines.join('\n')
      });
    }
  }

  if (!additions.length) return existing;

  const versionHeading = `## ${addonVersion}`;
  const lines = existing.trimEnd()
    ? existing.trimEnd().split('\n')
    : ['# Ghostfolio-NG Home Assistant Add-on Changelog', ''];

  let versionIndex = lines.indexOf(versionHeading);

  if (versionIndex < 0) {
    versionIndex = lines.findIndex((line) => /^## /.test(line));

    if (versionIndex < 0) versionIndex = lines.length;

    lines.splice(versionIndex, 0, versionHeading);
  }

  let insertion = lines.length;

  for (let i = versionIndex + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      insertion = i;
      break;
    }
  }

  const rendered = [];
  let previousHeadings = [];

  for (const block of additions) {
    let common = 0;

    while (
      common < previousHeadings.length &&
      common < block.headings.length &&
      previousHeadings[common].level === block.headings[common].level &&
      previousHeadings[common].text === block.headings[common].text
    ) {
      common++;
    }

    for (const heading of block.headings.slice(common)) {
      rendered.push(`${'#'.repeat(heading.level)} ${heading.text}`);
      rendered.push('');
    }

    rendered.push(block.content);
    rendered.push('');

    previousHeadings = block.headings;
  }

  const addition = rendered.join('\n').trimEnd();
  const before = lines.slice(0, insertion).join('\n').trimEnd();
  const after = lines.slice(insertion).join('\n').trimStart();

  return [before, addition, after].filter(Boolean).join('\n\n') + '\n';
}

export function releaseNotesArchive(identity, sections) {
  assert.ok(identity && typeof identity === 'object');
  assert.ok(Array.isArray(sections));
  assert.ok(sections.every((section) => typeof section === 'string'));

  return {
    schema_version: 1,
    identity: structuredClone(identity),
    sections: structuredClone(sections)
  };
}

export function validateReleaseNotesArchive(archive, identity) {
  assert.ok(archive && typeof archive === 'object');
  assert.deepEqual(Object.keys(archive).sort(), [
    'identity',
    'schema_version',
    'sections'
  ]);

  assert.equal(archive.schema_version, 1);
  assert.deepEqual(archive.identity, identity);
  assert.ok(Array.isArray(archive.sections));
  assert.ok(archive.sections.every((section) => typeof section === 'string'));

  return structuredClone(archive.sections);
}

export function releaseNotesArchivePath(identity) {
  assert.ok(identity && typeof identity.integration_tag === 'string');
  assert.match(identity.integration_tag, /^integration-\d+\.\d+\.\d+-\d+$/);

  return `home-assistant-addon/releases/notes/${identity.integration_tag}.json`;
}
