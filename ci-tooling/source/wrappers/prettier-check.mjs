// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(
  pathToFileURL(
    process.env.HA_QUALIFY_NODE_MODULES
      ? resolve(
          process.env.HA_QUALIFY_NODE_MODULES,
          '../qualification-loader.cjs'
        )
      : resolve(root, 'prettier/package.json')
  )
);
const prettier = require('prettier');
assert.equal(prettier.version, '3.9.10');
const config = JSON.parse(await readFile(resolve('.prettierrc'), 'utf8'));
assert.deepEqual(config.plugins, [
  'prettier-plugin-organize-attributes',
  '@trivago/prettier-plugin-sort-imports'
]);
const versions = ['1.0.0', '6.0.2'];
config.plugins = await Promise.all(
  config.plugins.map(async (name, i) => {
    const modules = process.env.HA_QUALIFY_NODE_MODULES
      ? resolve(process.env.HA_QUALIFY_NODE_MODULES)
      : resolve(root, 'prettier/node_modules');
    const directory = resolve(modules, name);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'package.json'), 'utf8')
    );
    assert.equal(manifest.version, versions[i]);
    const entry = require.resolve(name);
    assert.ok(
      (await realpath(entry)).startsWith((await realpath(modules)) + '/')
    );
    return entry;
  })
);
const files = process.argv.slice(2);
if (!files.length)
  files.push(
    '.github/workflows/ghostfolio-ng-ha-orchestrator.yml',
    'scripts/ghostfolio-ng-ha-orchestrator.mjs',
    'scripts/ghostfolio-ng-ha-orchestrator.test.mjs',
    'scripts/ghostfolio-ng-ha-orchestrator-workflow.test.mjs',
    'docs/ghostfolio-ng-ha-orchestrator.md'
  );
let failed = false;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (!(await prettier.check(text, { ...config, filepath: resolve(file) }))) {
    console.error(`Formatting differs: ${file}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log(`Prettier 3.9.10: ${files.length} files PASS`);
