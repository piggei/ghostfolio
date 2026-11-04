// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = 'f6ea73ca1f28750abd3b061023cab6a4f3443638';
const C = 'bfaf9ff86325d3d6fb25c37785e854cc583077df';
const arg = process.argv.slice(2);
if (arg.length && (arg.length !== 2 || arg[0] !== '--report-dir')) {
  console.error(
    'Usage: qualify-ha-orchestrator-local.sh [--report-dir DIRECTORY]'
  );
  process.exit(2);
}
const report = arg.length
  ? resolve(arg[1])
  : mkdtempSync(join(tmpdir(), 'ha-local-report-'));
mkdirSync(report, { recursive: true });
const checks = [];
const versions = {};
let temporary;
let prerequisite = true;
let lastCheck = 'prerequisites';
const actionlint = process.env.HA_QUALIFY_ACTIONLINT || 'actionlint';
const modules = resolve(
  process.env.HA_QUALIFY_NODE_MODULES || join(root, 'node_modules')
);
function command(name, executable, args, cwd = root, env = {}) {
  lastCheck = name;
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_NO_LAZY_FETCH: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
      ...env
    }
  });
  const output = (result.stdout || '') + (result.stderr || '');
  writeFileSync(join(report, name + '.log'), output);
  if (result.error || result.status !== 0)
    throw new Error(
      `${name}: ${result.error?.message || 'exit ' + result.status}; see ${join(report, name + '.log')}`
    );
  checks.push({ name, result: 'PASS' });
  return output;
}
try {
  assert.equal(
    process.versions.node.split('.')[0],
    '22',
    'Node.js 22.x required'
  );
  versions.node = process.versions.node;
  assert.ok(
    command('prerequisite-node-test-options', process.execPath, [
      '--help'
    ]).includes('--experimental-test-isolation'),
    'Node 22.x with test-isolation flag support required'
  );
  for (const tool of ['git', 'tar', 'bash'])
    command('prerequisite-' + tool, tool, ['--version']);
  const version = command('prerequisite-actionlint', actionlint, [
    '--version'
  ]).split('\n')[0];
  assert.equal(version, '1.7.12', 'Actionlint 1.7.12 required');
  versions.actionlint = version;
  const require = createRequire(
    resolve(modules, '../qualification-loader.cjs')
  );
  for (const [name, expected] of Object.entries({
    prettier: '3.9.10',
    'prettier-plugin-organize-attributes': '1.0.0',
    '@trivago/prettier-plugin-sort-imports': '6.0.2',
    yaml: '2.9.0'
  })) {
    const manifest = JSON.parse(
      readFileSync(join(modules, name, 'package.json'), 'utf8')
    );
    assert.equal(manifest.version, expected, `${name}@${expected} required`);
    await import(pathToFileURL(require.resolve(name)).href);
    versions[name] = manifest.version;
  }
  const cloneConfig = spawnSync(
    'git',
    ['config', '--get-regexp', '(partialclone|partialClone|promisor)$'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_NO_LAZY_FETCH: '1',
        GIT_NO_REPLACE_OBJECTS: '1'
      }
    }
  );
  assert.ok(
    !cloneConfig.error && [0, 1].includes(cloneConfig.status),
    'Cannot inspect local clone configuration'
  );
  for (const line of (cloneConfig.stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)) {
    const [key, value] = line.split(/\s+/, 2);
    assert.ok(
      !/partialclone$/i.test(key) && /^(false|0|no|off)$/i.test(value || ''),
      'Use a fully materialized non-promisor clone; no lazy fetching is allowed'
    );
  }
  checks.push({ name: 'prerequisite-full-clone', result: 'PASS' });
  for (const sha of [P, C])
    assert.equal(
      command('object-' + sha, 'git', ['rev-parse', `${sha}^{commit}`]).trim(),
      sha,
      'Required immutable Git object missing; no automatic fetch'
    );
  temporary = mkdtempSync(join(tmpdir(), 'ha-local-subjects-'));
  const subject = join(temporary, 'subject');
  const contract = join(subject, 'ha-contract');
  mkdirSync(contract, { recursive: true });
  for (const [name, sha, target] of [
    ['P', P, subject],
    ['C', C, contract]
  ]) {
    const archive = join(temporary, name + '.tar');
    command('archive-' + name, 'git', [
      'archive',
      '--format=tar',
      '-o',
      archive,
      sha
    ]);
    command('extract-' + name, 'tar', ['-xf', archive, '-C', target]);
  }
  prerequisite = false;
  const toolsEnv = { HA_QUALIFY_NODE_MODULES: modules };
  const glob = (directory, pattern) =>
    require('node:fs')
      .readdirSync(directory)
      .filter((n) => pattern.test(n))
      .sort()
      .map((n) => join(directory, n));
  for (const [name, files, cwd, expected] of [
    [
      'orchestrator',
      glob(
        join(subject, 'scripts'),
        /^ghostfolio-ng-ha-orchestrator.*\.test\.mjs$/
      ),
      subject,
      107
    ],
    [
      'ha',
      glob(join(contract, 'scripts'), /^home-assistant-addon-.*\.test\.mjs$/),
      contract,
      174
    ],
    [
      'security',
      [join(root, 'scripts/ghostfolio-ng-ha-qualification.test.mjs')],
      root,
      3
    ]
  ]) {
    const output = command(
      name,
      process.execPath,
      ['--test', '--experimental-test-isolation=none', ...files],
      cwd,
      { HA_CONTRACT_DIR: contract }
    );
    for (const line of [
      `# tests ${expected}`,
      `# pass ${expected}`,
      '# fail 0',
      '# skipped 0',
      '# cancelled 0',
      '# todo 0'
    ])
      assert.ok(output.split('\n').includes(line), `${name}: missing ${line}`);
  }
  const workflows = [
    join(subject, '.github/workflows/ghostfolio-ng-ha-orchestrator.yml'),
    join(root, '.github/workflows/ghostfolio-ng-ha-qualification.yml')
  ];
  command('actionlint', actionlint, [
    '-shellcheck=',
    '-pyflakes=',
    ...workflows
  ]);
  command(
    'yaml-unique',
    process.execPath,
    [join(root, 'ci-tooling/source/wrappers/yaml-unique.mjs'), ...workflows],
    subject,
    toolsEnv
  );
  command(
    'prettier-P',
    process.execPath,
    [join(root, 'ci-tooling/source/wrappers/prettier-check.mjs')],
    subject,
    toolsEnv
  );
  command(
    'prettier-harness',
    process.execPath,
    [
      join(root, 'ci-tooling/source/wrappers/prettier-check.mjs'),
      ...[
        ...workflows.slice(1),
        join(root, 'scripts/ghostfolio-ng-ha-qualification.test.mjs'),
        join(root, 'docs/ci/ghostfolio-ng-ha-qualification.md')
      ]
    ],
    subject,
    toolsEnv
  );
  for (const file of [
    ...glob(join(subject, 'scripts'), /^ghostfolio-ng-ha-orchestrator.*\.mjs$/),
    join(root, 'scripts/ghostfolio-ng-ha-qualification.test.mjs'),
    fileURLToPath(import.meta.url)
  ])
    command('syntax-' + file.split('/').at(-1), process.execPath, [
      '--check',
      file
    ]);
  command('bash-syntax', 'bash', [
    '-n',
    join(root, 'scripts/qualify-ha-orchestrator-local.sh')
  ]);
  command(
    'prettier-local-tooling',
    process.execPath,
    [
      join(root, 'ci-tooling/source/wrappers/prettier-check.mjs'),
      ...[
        'scripts/qualify-ha-orchestrator-local.mjs',
        'docs/ci/ghostfolio-ng-ha-local-qualification.md',
        'ci-tooling/source/wrappers/yaml-unique.mjs',
        'ci-tooling/source/wrappers/verify-inventory.mjs',
        'ci-tooling/source/wrappers/prettier-check.mjs'
      ].map((file) => join(root, file))
    ],
    subject,
    toolsEnv
  );
  const yaml = require('yaml');
  const scripts = [];
  for (const workflow of workflows) {
    const data = yaml.parse(readFileSync(workflow, 'utf8'), {
      uniqueKeys: true
    });
    for (const job of Object.values(data.jobs))
      for (const step of job.steps || [])
        if (step.run) {
          const path = join(temporary, `inline-${scripts.length}.sh`);
          writeFileSync(path, step.run);
          command('bash-inline-' + scripts.length, 'bash', ['-n', path]);
          scripts.push(path);
        }
  }
  const shellcheck = spawnSync('shellcheck', ['--version'], {
    encoding: 'utf8'
  });
  if (!shellcheck.error && shellcheck.status === 0) {
    versions.shellcheck_optional = shellcheck.stdout.trim();
    command('shellcheck-optional', 'shellcheck', [
      '--shell=bash',
      join(root, 'scripts/qualify-ha-orchestrator-local.sh'),
      ...scripts
    ]);
  } else
    checks.push({
      name: 'shellcheck-optional',
      result: 'NOT INSTALLED (optional)'
    });
  command('whitespace-P', 'git', [
    'diff',
    '--check',
    'f54a95f6f56727662249f566472fe49283a32e56',
    P
  ]);
  command('whitespace-working-tree', 'git', ['diff', '--check']);
  const ownFiles = [
    'scripts/qualify-ha-orchestrator-local.sh',
    'scripts/qualify-ha-orchestrator-local.mjs',
    '.github/workflows/ghostfolio-ng-ha-qualification.yml',
    'scripts/ghostfolio-ng-ha-qualification.test.mjs'
  ];
  for (const file of ownFiles) {
    const text = readFileSync(join(root, file), 'utf8');
    assert.ok(
      text.endsWith('\n') &&
        !text.split('\n').some((line) => /[\t ]+$/.test(line)),
      `Whitespace: ${file}`
    );
  }
  writeFileSync(
    join(report, 'result.json'),
    JSON.stringify(
      {
        status: 'SUCCESS',
        mode: 'OPEN_LOCAL (not immutable hosted CI)',
        tests: 284,
        P,
        C,
        versions,
        checks
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `SUCCESS: 284 tests and static checks passed (OPEN LOCAL, not immutable CI). Report: ${report}`
  );
} catch (error) {
  const status = prerequisite
    ? 'MISSING_OR_INCOMPATIBLE_PREREQUISITE'
    : 'FAILED';
  writeFileSync(
    join(report, 'result.json'),
    JSON.stringify(
      {
        status,
        mode: 'OPEN_LOCAL',
        error: error.message,
        failed_check: lastCheck,
        versions,
        checks
      },
      null,
      2
    ) + '\n'
  );
  console.error(`${status}: ${error.message}. Report: ${report}`);
  process.exitCode = prerequisite ? 2 : 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
