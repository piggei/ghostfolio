// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(
  process.env.HA_QUALIFY_NODE_MODULES
    ? resolve(
        process.env.HA_QUALIFY_NODE_MODULES,
        '../qualification-loader.cjs'
      )
    : resolve(root, 'prettier/package.json')
);
const yaml = require('yaml');
assert.equal(require('yaml/package.json').version, '2.9.0');
if (!process.argv[2]) throw new Error('Usage: yaml-unique.mjs FILE...');
for (const file of process.argv.slice(2)) {
  try {
    const documents = yaml.parseAllDocuments(await readFile(file, 'utf8'), {
      uniqueKeys: true,
      prettyErrors: true,
      strict: true
    });
    for (const document of documents) {
      if (document.errors.length) throw document.errors[0];
      document.toJS({ maxAliasCount: 100 });
    }
    console.log(`YAML 2.9.0 unique keys: ${file} PASS`);
  } catch (error) {
    console.error(`${file}: ${error.message}`);
    process.exitCode = 1;
  }
}
