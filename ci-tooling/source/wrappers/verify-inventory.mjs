// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, posix } from 'node:path';

const [directory, inventory] = process.argv.slice(2);
assert.ok(directory && inventory, 'Usage: verify-inventory.mjs ROOT INVENTORY');
const root = await realpath(directory);
const records = JSON.parse(await readFile(inventory, 'utf8'));
assert.ok(Array.isArray(records));
const expected = new Map();
for (const record of records) {
  const name = record.path;
  assert.ok(
    typeof name === 'string' &&
      name &&
      !isAbsolute(name) &&
      !name.includes('\\') &&
      !name.split('/').includes('..') &&
      posix.normalize(name) === name &&
      !expected.has(name),
    'Unsafe/duplicate inventory path'
  );
  assert.match(record.sha256, /^[a-f0-9]{64}$/);
  assert.ok(
    Number.isSafeInteger(record.size) &&
      record.size >= 0 &&
      typeof record.executable === 'boolean'
  );
  expected.set(name, record);
}
const actual = new Map();
async function visit(directory) {
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const info = await lstat(path);
    assert.ok(!info.isSymbolicLink(), `Symlink rejected: ${path}`);
    if (info.isDirectory()) await visit(path);
    else {
      assert.ok(info.isFile(), `Special file rejected: ${path}`);
      actual.set(relative(root, path), { path, info });
    }
  }
}
await visit(root);
assert.deepEqual(
  [...actual.keys()].sort(),
  [...expected.keys()].sort(),
  'Payload file set mismatch'
);
for (const [name, { path, info }] of actual) {
  const record = expected.get(name);
  assert.ok(
    info.size === record.size &&
      Boolean(info.mode & 0o111) === record.executable &&
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex') === record.sha256,
    `Integrity mismatch: ${name}`
  );
}
console.log(`Integrity PASS: ${actual.size} payload files`);
