import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function stampBuildInfo(packagePath, buildNumber = '') {
  assert.ok(
    typeof buildNumber === 'string' &&
      buildNumber.trim() === buildNumber &&
      (buildNumber === '' || /^[1-9]\d*$/.test(buildNumber)),
    'Invalid NG build number'
  );
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  assert.equal(typeof packageJson.version, 'string');
  assert.equal(packageJson.version.trim(), packageJson.version);
  assert.match(
    packageJson.version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
  );
  if (buildNumber) packageJson.ghostfolioNgBuildNumber = buildNumber;
  else delete packageJson.ghostfolioNgBuildNumber;
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  stampBuildInfo(process.argv[2], process.argv[3]);
}
