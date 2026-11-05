import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const directory = 'apps/client/src/app/pages/about/ghostfolio-ng';
const templates = [
  `${directory}/ghostfolio-ng-page.html`,
  ...readdirSync(`${directory}/chapters`)
    .filter((file) => file.endsWith('.html'))
    .map((file) => `${directory}/chapters/${file}`)
];
const ids = new Set(
  templates.flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/@@(ngGuide\w+)/g)].map(
      (match) => match[1]
    )
  )
);
const catalog = (locale) =>
  readFileSync(
    `apps/client/src/locales/messages${locale ? '.' + locale : ''}.xlf`,
    'utf8'
  );
const units = (locale) => [
  ...catalog(locale).matchAll(
    /<trans-unit id="(ngGuide\w+)"[\s\S]*?<\/trans-unit>/g
  )
];

test('every guide message has exactly one English source and one Italian translation', () => {
  assert.ok(ids.size > 80, 'The complete guide must be localized');
  for (const locale of ['', 'it']) {
    const entries = units(locale);
    assert.equal(entries.length, ids.size);
    assert.deepEqual(new Set(entries.map((match) => match[1])), ids);
    for (const [unit] of entries) {
      assert.match(unit, /<source>.+<\/source>/);
      if (locale) assert.match(unit, /<target state="translated">.+<\/target>/);
      assert.doesNotMatch(unit, /TODO|Coming soon|state="new"/);
    }
  }
});

test('all new Italian messages pass the actual Angular XLIFF parser without placeholder errors', async () => {
  const { Xliff1TranslationParser } = await import('@angular/localize/tools');
  const content = `<xliff version="1.2"><file source-language="en" target-language="it" datatype="plaintext" original="ng2.template"><body>${units(
    'it'
  )
    .map(([unit]) => unit)
    .join('')}</body></file></xliff>`;
  const parser = new Xliff1TranslationParser();
  const analysis = parser.analyze('ng-guide.it.xlf', content);
  assert.equal(analysis.canParse, true);
  const parsed = parser.parse('ng-guide.it.xlf', content, analysis.hint);
  assert.deepEqual(parsed.diagnostics.messages, []);
  assert.deepEqual(new Set(Object.keys(parsed.translations)), ids);
  assert.equal(
    parsed.translations.ngGuideTeam.text,
    'Il team di Ghostfolio-NG'
  );
  assert.match(
    parsed.translations.ngGuideTaxDisclaimer.text,
    /non sostituiscono una consulenza fiscale professionale/
  );
  assert.match(parsed.translations.ngGuideMwrLimits.text, /imposte/);
  for (const translation of Object.values(parsed.translations)) {
    assert.deepEqual(translation.placeholderNames, []);
    assert.ok(translation.text.trim().length > 0);
  }
});

test('English catalog sources match the messages parsed from the real Angular templates', async () => {
  const { XmlParser, parseTemplate } = await import('@angular/compiler');
  const normalize = (value) => value.replace(/\s+/g, ' ').trim();
  const sources = new Map(
    units('').map(([unit, id]) => {
      const parsed = new XmlParser().parse(unit, 'source.xlf');
      assert.deepEqual(parsed.errors, []);
      const source = parsed.rootNodes[0].children.find(
        (node) => node.name === 'source'
      );
      return [
        id,
        normalize(source.children.map((node) => node.value).join(''))
      ];
    })
  );
  const observed = new Set();
  function visit(nodes) {
    for (const node of nodes) {
      const message = node.i18n;
      if (message?.customId?.startsWith('ngGuide')) {
        assert.equal(
          normalize(message.nodes.map((text) => text.value).join('')),
          sources.get(message.customId),
          message.customId
        );
        observed.add(message.customId);
      }
      visit(node.attributes ?? []);
      visit(node.children ?? []);
    }
  }
  for (const file of templates) {
    const result = parseTemplate(readFileSync(file, 'utf8'), file);
    assert.equal(result.errors, null);
    visit(result.nodes);
  }
  assert.deepEqual(observed, ids);
});

test('the approved lossless team asset is unchanged and mobile layout keeps readable chapters', () => {
  const image = readFileSync(
    'apps/client/src/assets/images/ghostfolio-ng-team.webp'
  );
  assert.equal(
    createHash('sha256').update(image).digest('hex'),
    'b3eed9805218fcdb13240b8bf5056c1dcbd5289367e184543abae3a5bec25068'
  );
  assert.equal(image.toString('ascii', 0, 4), 'RIFF');
  assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  const team = readFileSync(`${directory}/chapters/team.chapter.html`, 'utf8');
  const source = team.match(/src="([^"]+)"/)[1];
  for (const locale of ['en', 'it']) {
    assert.equal(
      new URL(source, `https://example.test/${locale}/`).pathname,
      '/assets/images/ghostfolio-ng-team.webp'
    );
  }
  const styles = readFileSync(`${directory}/ghostfolio-ng-page.scss`, 'utf8');
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(min-width: 768px\)/);
  assert.match(styles, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /scroll-margin-top:/);
  assert.match(
    readFileSync(`${directory}/chapters/cash.chapter.html`, 'utf8'),
    /overflow-auto/
  );
});

test('revised tax and cash messages have current sources in all existing translations and explicit fallback review states', async () => {
  const { XmlParser } = await import('@angular/compiler');
  const affected = [
    'ngGuideTaxCash',
    'ngGuideTaxExample',
    'ngGuideCashCsvLimits'
  ];
  const normalize = (text) => text.replace(/\s+/g, ' ').trim();
  function fields(unit) {
    const parsed = new XmlParser().parse(unit, 'translation.xlf');
    assert.deepEqual(parsed.errors, []);
    const nodes = parsed.rootNodes[0].children;
    const text = (name) =>
      normalize(
        nodes
          .find((n) => n.name === name)
          .children.map((n) => n.value)
          .join('')
      );
    const target = nodes.find((n) => n.name === 'target');
    return {
      source: text('source'),
      target: target ? text('target') : undefined,
      state: target?.attrs.find((a) => a.name === 'state')?.value
    };
  }
  const source = new Map(
    units('').map(([unit, id]) => [id, fields(unit).source])
  );
  for (const locale of ['it', 'ca', 'de', 'es', 'fr', 'nl', 'pl', 'pt', 'tr']) {
    const entries = new Map(
      units(locale).map(([unit, id]) => [id, fields(unit)])
    );
    for (const id of affected) {
      const message = entries.get(id);
      assert.equal(message.source, source.get(id), `${locale}/${id}`);
      assert.ok(message.target.length > 0);
      assert.ok(['translated', 'needs-translation'].includes(message.state));
      if (message.state === 'needs-translation')
        assert.equal(message.target, message.source);
      if (locale === 'it') assert.equal(message.state, 'translated');
    }
  }
});
