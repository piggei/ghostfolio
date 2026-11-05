import { parseGhostfolioNgBuildInfo } from '@ghostfolio/common/ghostfolio-ng-build-info';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readGhostfolioNgBuildInfo(directory = process.cwd()) {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8')
    );

    return parseGhostfolioNgBuildInfo({
      buildNumber: packageJson.ghostfolioNgBuildNumber,
      upstreamVersion: packageJson.version
    });
  } catch {
    return undefined;
  }
}
