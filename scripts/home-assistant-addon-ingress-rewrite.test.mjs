import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = readFileSync(
  'home-assistant-addon/rootfs/etc/nginx/conf.d/ghostfolio.conf',
  'utf8'
);

const ingressPath = '/api/hassio_ingress/test-token';

const requiredDirectives = [
  "sub_filter 'base href=\"/' 'base href=\"$http_x_ingress_path/';",
  `sub_filter "'/api/" "'$http_x_ingress_path/api/";`,
  `sub_filter '"/api/' '"$http_x_ingress_path/api/';`,
  "sub_filter '\u0060/api/' '\u0060$http_x_ingress_path/api/';",
  `sub_filter "'/assets/" "'$http_x_ingress_path/assets/";`,
  `sub_filter '"/assets/' '"$http_x_ingress_path/assets/';`,
  "sub_filter '\u0060/assets/' '\u0060$http_x_ingress_path/assets/';",
  'sub_filter "url(/assets/" "url($http_x_ingress_path/assets/";'
];

function rewriteLikeNginx(content, prefix = ingressPath) {
  const replacements = new Map([['base href="/', `base href="${prefix}/`]]);

  for (const resource of ['api', 'assets']) {
    for (const delimiter of ["'", '"', '`']) {
      const needle = `${delimiter}/${resource}/`;

      replacements.set(needle, `${delimiter}${prefix}/${resource}/`);
    }
  }

  replacements.set('url(/assets/', `url(${prefix}/assets/`);

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const pattern = new RegExp(
    [...replacements.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|'),
    'g'
  );

  // Apply every literal replacement once to the original response.
  // Replacement output must never be processed by another rule.
  return content.replace(pattern, (match) => replacements.get(match));
}

test('Ingress configuration declares all expected rewrite directives', () => {
  for (const directive of requiredDirectives) {
    assert.ok(
      config.includes(directive),
      `Missing Nginx directive: ${directive}`
    );
  }

  assert.match(
    config,
    /sub_filter_types application\/javascript text\/javascript text\/css;/
  );

  assert.match(config, /sub_filter_once off;/);
});

test('Ingress configuration does not contain indiscriminate API or asset rewriting', () => {
  assert.doesNotMatch(config, /sub_filter\s+['"]\/api\/['"]/);

  assert.doesNotMatch(config, /sub_filter\s+['"]\/assets\/['"]/);
});

test('HTML rewrites base href and absolute assets while preserving relative assets', () => {
  const direct = [
    '<base href="/">',
    '<link rel="icon" href="/assets/favicon.png">',
    '<script src="/assets/main.js"></script>',
    '<img src="../assets/images/example.svg">'
  ].join('\n');

  const expected = [
    `<base href="${ingressPath}/">`,
    `<link rel="icon" href="${ingressPath}/assets/favicon.png">`,
    `<script src="${ingressPath}/assets/main.js"></script>`,
    '<img src="../assets/images/example.svg">'
  ].join('\n');

  assert.equal(rewriteLikeNginx(direct), expected);
});

test('JavaScript rewrites absolute API and asset URLs with all supported delimiters', () => {
  const direct = [
    "fetch('/api/v1/info');",
    'fetch("/api/v1/accounts");',
    'fetch(`/api/v1/logo/${symbol}`);',
    "const a = '/assets/images/a.svg';",
    'const b = "/assets/images/b.svg";',
    'const c = `/assets/images/${name}.svg`;'
  ].join('\n');

  const rewritten = rewriteLikeNginx(direct);

  for (const resource of ['api', 'assets']) {
    assert.ok(rewritten.includes(`'${ingressPath}/${resource}/`));
    assert.ok(rewritten.includes(`"${ingressPath}/${resource}/`));
    assert.ok(rewritten.includes(`\u0060${ingressPath}/${resource}/`));
  }
});

test('relative logo and asset URLs remain byte-for-byte unchanged', () => {
  const direct = [
    '../api/v1/logo/YAHOO/AAPL',
    '../api/v1/logo?url=https%3A%2F%2Fexample.com',
    '../assets/images/logo.svg',
    "'../api/v1/logo/MSN/MSFT'",
    '"../assets/images/company.svg"'
  ].join('\n');

  assert.equal(rewriteLikeNginx(direct), direct);
});

test('CSS rewrites quoted and unquoted absolute asset URLs', () => {
  const direct = [
    "url('/assets/images/single.svg')",
    'url("/assets/images/double.svg")',
    'url(/assets/images/unquoted.svg)',
    'url("../assets/images/relative.svg")'
  ].join('\n');

  const expected = [
    `url('${ingressPath}/assets/images/single.svg')`,
    `url("${ingressPath}/assets/images/double.svg")`,
    `url(${ingressPath}/assets/images/unquoted.svg)`,
    'url("../assets/images/relative.svg")'
  ].join('\n');

  assert.equal(rewriteLikeNginx(direct), expected);
});

test('direct access without an Ingress prefix preserves original URLs', () => {
  const direct = [
    '<base href="/">',
    "fetch('/api/v1/info');",
    'const logo = "../api/v1/logo/YAHOO/AAPL";',
    'url(/assets/images/logo.svg)'
  ].join('\n');

  assert.equal(rewriteLikeNginx(direct, ''), direct);
});

test('the previous indiscriminate rewriting regression is detected', () => {
  const direct = '../api/v1/logo/YAHOO/AAPL';

  const oldBrokenResult =
    '../api/hassio_ingress/test-token/api/v1/logo/YAHOO/AAPL';

  const expected = rewriteLikeNginx(direct);

  assert.notEqual(oldBrokenResult, expected);
  assert.equal(expected, direct);
});
