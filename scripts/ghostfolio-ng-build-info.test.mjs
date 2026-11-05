import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { stampBuildInfo } from './ghostfolio-ng-build-info.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ng-stamp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'package.json');
  const original = {
    name: 'ghostfolio',
    version: '3.97.0',
    scripts: { start: 'node main.js' },
    dependencies: { sample: '1.0.0' }
  };
  writeFileSync(path, JSON.stringify(original));
  return { path, original };
}
test('stamps the actual run number while preserving upstream version and all package fields', (t) => {
  const { path, original } = fixture(t);
  stampBuildInfo(path, '17');
  assert.deepEqual(JSON.parse(readFileSync(path)), {
    ...original,
    ghostfolioNgBuildNumber: '17'
  });
  stampBuildInfo(path, '17');
  assert.deepEqual(JSON.parse(readFileSync(path)), {
    ...original,
    ghostfolioNgBuildNumber: '17'
  });
});
test('development/default builds have no fabricated build number', (t) => {
  const { path, original } = fixture(t);
  stampBuildInfo(path);
  assert.deepEqual(JSON.parse(readFileSync(path)), original);
});
for (const value of ['0', '-1', '0017', '17.1', '17\n', ' 17', 17, null])
  test(`invalid release build ${JSON.stringify(value)} fails without modifying package`, (t) => {
    const { path } = fixture(t);
    const before = readFileSync(path);
    assert.throws(() => stampBuildInfo(path, value));
    assert.deepEqual(readFileSync(path), before);
  });
test('Docker stamps shared image metadata and workflow uses stable run number without changing provenance', () => {
  const docker = readFileSync('Dockerfile', 'utf8');
  const workflow = readFileSync(
    '.github/workflows/integration-release.yml',
    'utf8'
  );
  assert.match(docker, /ARG GHOSTFOLIO_NG_BUILD_NUMBER=/);
  assert.match(
    docker,
    /node \/tmp\/ghostfolio-ng-build-info.mjs \/ghostfolio\/apps\/api\/package.json/
  );
  assert.ok(
    docker.indexOf('RUN node /tmp/ghostfolio-ng-build-info.mjs') >
      docker.indexOf('COPY --chown=node:node --from=builder')
  );
  assert.match(
    workflow,
    /GHOSTFOLIO_NG_BUILD_NUMBER=\$\{\{ github.run_number \}\}/
  );
  assert.match(
    workflow,
    /org.opencontainers.image.version=\$\{\{ needs.prepare.outputs.version \}\}/
  );
  assert.match(workflow, /sha_tag=sha-\$\{GITHUB_SHA\}/);
  const api = readFileSync(
    'apps/api/src/app/endpoints/info/ghostfolio-ng-build-info.ts',
    'utf8'
  );
  assert.doesNotMatch(
    api,
    /fetch|APP_VERSION|GITHUB|ingress|hostname|addonVersion/
  );
});

test('Italian version messages have valid Angular placeholders and preserve the required text', async () => {
  const { Xliff1TranslationParser } = await import('@angular/localize/tools');
  const catalog = readFileSync(
    'apps/client/src/locales/messages.it.xlf',
    'utf8'
  );
  const keys = [
    'ghostfolioNgVersionLabel',
    'ghostfolioNgBuildVersion',
    'ghostfolioNgBaseVersion'
  ];
  const units = keys.map((key) => {
    const matches = [
      ...catalog.matchAll(
        new RegExp(`<trans-unit id="${key}"[\\s\\S]*?</trans-unit>`, 'g')
      )
    ];
    assert.equal(matches.length, 1);
    return matches[0][0];
  });
  const content = `<xliff version="1.2"><file source-language="en" target-language="it" datatype="plaintext" original="ng2.template"><body>${units.join('')}</body></file></xliff>`;
  const parser = new Xliff1TranslationParser();
  const analysis = parser.analyze('messages.it.xlf', content);
  assert.equal(analysis.canParse, true);
  const parsed = parser.parse('messages.it.xlf', content, analysis.hint);
  assert.deepEqual(
    parsed.diagnostics.messages.filter((m) => m.type === 'error'),
    []
  );
  assert.equal(
    parsed.translations.ghostfolioNgVersionLabel.text,
    'Versione Ghostfolio-NG:'
  );
  assert.equal(
    parsed.translations.ghostfolioNgBuildVersion.text,
    'Build {$INTERPOLATION} — basata su Ghostfolio {$INTERPOLATION_1}'
  );
  assert.deepEqual(
    parsed.translations.ghostfolioNgBuildVersion.placeholderNames,
    ['INTERPOLATION', 'INTERPOLATION_1']
  );
  assert.equal(
    parsed.translations.ghostfolioNgBaseVersion.text,
    'basata su Ghostfolio {$INTERPOLATION}'
  );
});
