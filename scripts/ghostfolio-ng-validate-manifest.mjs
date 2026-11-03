import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const INDEX_TYPES = new Set([
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json'
]);

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function validateManifest(manifest, amd64Digest, arm64Digest) {
  if (
    !DIGEST_PATTERN.test(amd64Digest) ||
    !DIGEST_PATTERN.test(arm64Digest) ||
    amd64Digest === arm64Digest
  ) {
    throw new Error('Invalid or duplicate expected digest');
  }

  if (
    !manifest ||
    !INDEX_TYPES.has(manifest.mediaType) ||
    !Array.isArray(manifest.manifests)
  ) {
    throw new Error('Invalid multi-platform image index');
  }

  const expected = new Map([
    ['amd64', amd64Digest],
    ['arm64', arm64Digest]
  ]);

  const found = new Set();

  for (const entry of manifest.manifests) {
    const platform = entry?.platform;

    if (platform?.os === 'unknown' && platform?.architecture === 'unknown') {
      const annotations = entry.annotations ?? {};

      if (annotations['vnd.docker.reference.type'] !== 'attestation-manifest') {
        throw new Error('Unexpected unknown-platform manifest');
      }

      if (!DIGEST_PATTERN.test(entry.digest)) {
        throw new Error('Invalid attestation digest');
      }

      const reference = annotations['vnd.docker.reference.digest'];

      if (
        !DIGEST_PATTERN.test(reference) ||
        ![amd64Digest, arm64Digest].includes(reference)
      ) {
        throw new Error('Invalid attestation reference');
      }

      continue;
    }

    if (platform?.os !== 'linux' || !expected.has(platform.architecture)) {
      throw new Error('Unexpected executable platform');
    }

    const arch = platform.architecture;

    if (found.has(arch)) {
      throw new Error(`Duplicate platform: linux/${arch}`);
    }

    if (entry.digest !== expected.get(arch)) {
      throw new Error(`Unexpected digest for linux/${arch}`);
    }

    found.add(arch);
  }

  if (found.size !== expected.size) {
    throw new Error('Missing required architecture');
  }

  return true;
}

function main() {
  const [amd64Digest, arm64Digest] = process.argv.slice(2);

  if (!amd64Digest || !arm64Digest) {
    throw new Error('Usage: validate-manifest.mjs AMD64_DIGEST ARM64_DIGEST');
  }

  const manifest = JSON.parse(readFileSync(0, 'utf8'));

  validateManifest(manifest, amd64Digest, arm64Digest);

  console.log('Multi-platform manifest validation: PASS');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
