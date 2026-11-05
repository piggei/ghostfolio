import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readGhostfolioNgBuildInfo } from './ghostfolio-ng-build-info';

describe('image-local Ghostfolio-NG build information', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ng-build-info-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  function metadata(value: unknown) {
    writeFileSync(join(directory, 'package.json'), JSON.stringify(value));
  }
  it('reads the exact image build and original package version', () => {
    metadata({
      version: '3.97.0',
      ghostfolioNgBuildNumber: '17',
      addonVersion: '3.97.5'
    });
    expect(readGhostfolioNgBuildInfo(directory)).toEqual({
      buildNumber: '17',
      upstreamVersion: '3.97.0'
    });
  });
  it('keeps the original upstream version in development without a build', () => {
    metadata({ version: '3.97.0' });
    expect(readGhostfolioNgBuildInfo(directory)).toEqual({
      upstreamVersion: '3.97.0'
    });
  });
  it.each(['0', '-1', '17\n', '0017', 17, null])(
    'does not expose invalid build metadata %s',
    (buildNumber) => {
      metadata({ version: '3.97.0', ghostfolioNgBuildNumber: buildNumber });
      expect(readGhostfolioNgBuildInfo(directory)).toEqual({
        upstreamVersion: '3.97.0'
      });
    }
  );
  it.each([{}, null, { version: 'dev' }, { version: '3.97.0\n' }])(
    'omits invalid upstream metadata %s',
    (value) => {
      metadata(value);
      expect(readGhostfolioNgBuildInfo(directory)).toBeUndefined();
    }
  );
  it('handles missing and malformed package metadata without placeholders', () => {
    expect(readGhostfolioNgBuildInfo(directory)).toBeUndefined();
    writeFileSync(join(directory, 'package.json'), '{');
    expect(readGhostfolioNgBuildInfo(directory)).toBeUndefined();
  });
});
