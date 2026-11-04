import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateNativeArm64 } from './home-assistant-addon-oci-arm64-qualification.mjs';

test('native ARM qualification requires both ARM64 Node and the native host', () => {
  assert.equal(
    validateNativeArm64('arm64', 'aarch64', '127.0.0.1:5000'),
    '127.0.0.1:5000'
  );
  assert.throws(() => validateNativeArm64('x64', 'aarch64', '127.0.0.1:5000'));
  assert.throws(() => validateNativeArm64('arm64', 'x86_64', '127.0.0.1:5000'));
});
for (const address of [
  'ghcr.io:443',
  'localhost:5000',
  '127.0.0.1:0',
  '127.0.0.1:65536',
  '127.0.0.1:5000\n',
  '127.0.0.1:5000/evil'
])
  test(`native ARM qualification rejects registry ${JSON.stringify(address)}`, () =>
    assert.throws(() => validateNativeArm64('arm64', 'aarch64', address)));

test('prepared ARM workflow cannot publish to GHCR or invoke the release reusable', () => {
  const yaml = readFileSync(
    new URL(
      '../.github/workflows/home-assistant-addon-oci-native-test.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.ok(yaml.includes('branches: [fix/home-assistant-oci-identity]'));
  assert.ok(yaml.includes('runs-on: ubuntu-24.04-arm'));
  assert.ok(yaml.includes('contents: read') && yaml.includes('packages: read'));
  assert.ok(!yaml.includes(': write'));
  assert.ok(!yaml.includes('workflow_dispatch:'));
  assert.ok(!yaml.includes('docker/login-action'));
  assert.ok(
    !yaml.includes(
      'uses: piggei/ghostfolio/.github/workflows/home-assistant-addon.yml'
    )
  );
  assert.ok(yaml.includes('--publish 127.0.0.1::5000'));
});
