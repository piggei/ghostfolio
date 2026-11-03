import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ghostfolio-ng-promote-release.sh');

const image = 'ghcr.io/piggei/ghostfolio-ng';
const source = 'candidate-test-multiarch';
const amd64 = `sha256:${'a'.repeat(64)}`;
const arm64 = `sha256:${'b'.repeat(64)}`;
const manifestDigest = `sha256:${'c'.repeat(64)}`;

function createManifest(a = amd64, b = arm64) {
  return {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      {
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        digest: a,
        platform: { os: 'linux', architecture: 'amd64' }
      },
      {
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        digest: b,
        platform: { os: 'linux', architecture: 'arm64' }
      }
    ]
  };
}

function runScenario({
  existing = [],
  forbiddenTag = '',
  failAfterPublish = '',
  failBeforePublish = '',
  invalidSource = false,
  args
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ghostfolio-ng-promote-'));
  const bin = join(root, 'bin');
  const registry = join(root, 'registry');
  const temporaryDirectory = join(root, 'tmp');
  const log = join(root, 'docker.log');

  mkdirSync(bin);
  mkdirSync(registry);
  mkdirSync(temporaryDirectory);

  const saveManifest = (key, manifest, digest = manifestDigest) => {
    const serialized = JSON.stringify(manifest);

    writeFileSync(join(registry, `${key}.json`), serialized);
    writeFileSync(join(registry, `${key}.digest`), digest);

    // Every immutable digest resolves to exactly one manifest.
    writeFileSync(join(registry, `${digest}.json`), serialized);
    writeFileSync(join(registry, `${digest}.digest`), digest);
  };

  const sourceManifest = invalidSource
    ? createManifest(arm64, amd64)
    : createManifest();

  saveManifest(source, sourceManifest);
  saveManifest(manifestDigest, sourceManifest);

  for (const entry of existing) {
    saveManifest(entry.tag, entry.manifest, entry.digest ?? manifestDigest);
  }

  const mock = `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "$MOCK_DOCKER_LOG"

registry_key() {
  local reference="$1"

  if [[ "$reference" == *@* ]]; then
    printf '%s\\n' "\${reference##*@}"
  else
    printf '%s\\n' "\${reference##*:}"
  fi
}

if [[ "$1" != "buildx" || "$2" != "imagetools" ]]; then
  echo "Unexpected Docker command: $*" >&2
  exit 99
fi

case "$3" in
  inspect)
    if [[ "\${4:-}" == "--raw" ]]; then
      reference="$5"
      mode=raw
    else
      reference="$4"
      mode=digest
    fi

    key="$(registry_key "$reference")"

    if [[ "$key" == "$MOCK_FORBIDDEN_TAG" ]]; then
      echo "ERROR: authorization failed: 403 Forbidden" >&2
      exit 1
    fi

    file="$MOCK_REGISTRY/$key.json"

    if [[ ! -f "$file" ]]; then
      echo "ERROR: $reference: not found" >&2
      exit 1
    fi

    if [[ "$mode" == raw ]]; then
      cat "$file"
    else
      digest="$(cat "$MOCK_REGISTRY/$key.digest")"
      printf 'Name: %s\\nDigest: %s\\n' "$reference" "$digest"
    fi
    ;;

  create)
    destination="$5"
    source_reference="$6"

    destination_key="$(registry_key "$destination")"
    source_key="$(registry_key "$source_reference")"

    source_file="$MOCK_REGISTRY/$source_key.json"
    destination_file="$MOCK_REGISTRY/$destination_key.json"

    if [[ "$destination_key" == "$MOCK_FAIL_BEFORE_PUBLISH" ]]; then
      echo "ERROR: simulated registry publication failure" >&2
      exit 1
    fi

    if [[ ! -f "$source_file" ]]; then
      echo "ERROR: pinned source not found" >&2
      exit 50
    fi

    cp "$source_file" "$destination_file"
    cp "$MOCK_REGISTRY/$source_key.digest" \
      "$MOCK_REGISTRY/$destination_key.digest"

    if [[ "$destination_key" == "$MOCK_FAIL_AFTER_PUBLISH" ]]; then
      echo "ERROR: simulated interrupted publication" >&2
      exit 1
    fi
    ;;

  *)
    echo "Unexpected imagetools operation: $*" >&2
    exit 99
    ;;
esac
`;

;

  writeFileSync(join(bin, 'docker'), mock, { mode: 0o755 });

  const destinations = args ?? ['release-version', 'release-sha'];

  const result = spawnSync(
    'bash',
    [
      script,
      image,
      source,
      amd64,
      arm64,
      ...destinations
    ],
    {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: temporaryDirectory,
        MOCK_REGISTRY: registry,
        MOCK_DOCKER_LOG: log,
        MOCK_FORBIDDEN_TAG: forbiddenTag,
        MOCK_FAIL_AFTER_PUBLISH: failAfterPublish,
        MOCK_FAIL_BEFORE_PUBLISH: failBeforePublish
      }
    }
  );

  const commands = (() => {
    try {
      const content = readFileSync(log, 'utf8').trim();
      return content ? content.split('\n') : [];
    } catch {
      return [];
    }
  })();

  const state = destinations.map((tag) => {
    try {
      return JSON.parse(
        readFileSync(join(registry, `${tag}.json`), 'utf8')
      );
    } catch {
      return null;
    }
  });

  const temporaryEntries = readdirSync(temporaryDirectory);

  rmSync(root, { recursive: true, force: true });

  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    commands,
    state,
    temporaryEntries
  };
}

const creates = (result) =>
  result.commands.filter((command) => command.includes('imagetools create'));

test('publishes both missing release tags using the pinned digest', () => {
  const result = runScenario();

  assert.equal(result.status, 0);
  assert.equal(creates(result).length, 2);
  assert.ok(result.state.every(Boolean));
  assert.match(result.output, /promotion: PASS/);

  for (const command of creates(result)) {
    assert.ok(command.includes(`ghcr.io/piggei/ghostfolio-ng@${manifestDigest}`));
    assert.ok(!command.includes(`ghcr.io/piggei/ghostfolio-ng:${source}`));
  }
});

test('accepts already promoted matching tags', () => {
  const manifest = createManifest();

  const result = runScenario({
    existing: [
      { tag: 'release-version', manifest },
      { tag: 'release-sha', manifest }
    ]
  });

  assert.equal(result.status, 0);
  assert.equal(creates(result).length, 0);
});

test('recovers a partially completed promotion', () => {
  const result = runScenario({
    existing: [
      { tag: 'release-version', manifest: createManifest() }
    ]
  });

  assert.equal(result.status, 0);
  assert.equal(creates(result).length, 1);
  assert.ok(result.state.every(Boolean));
});

test('rejects an existing tag with different digests', () => {
  const result = runScenario({
    existing: [
      {
        tag: 'release-version',
          manifest: createManifest(arm64, amd64),
          digest: `sha256:${'d'.repeat(64)}`
      }
    ]
  });

  assert.notEqual(result.status, 0);
  assert.equal(creates(result).length, 0);
  assert.match(result.output, /Destination manifest digest differs from qualified source/);
});



test('rejects matching platform digests under a different index digest', () => {
  const result = runScenario({
    existing: [
      {
        tag: 'release-version',
        manifest: createManifest(),
        digest: `sha256:${'d'.repeat(64)}`
      }
    ]
  });

  assert.notEqual(result.status, 0);
  assert.equal(creates(result).length, 0);
  assert.match(result.output, /manifest digest differs from qualified source/);
});

test('fails closed on GHCR authorization errors', () => {
  const result = runScenario({
    forbiddenTag: 'release-version'
  });

  assert.notEqual(result.status, 0);
  assert.equal(creates(result).length, 0);
});

test('recovers when publication fails after the tag was created', () => {
  const result = runScenario({
    failAfterPublish: 'release-version'
  });

  assert.equal(result.status, 0);
  assert.equal(creates(result).length, 2);
  assert.ok(result.state.every(Boolean));
  assert.match(result.output, /Recovered matching destination/);
});

test('fails when publication fails and destination remains absent', () => {
  const result = runScenario({
    failBeforePublish: 'release-version'
  });

  assert.notEqual(result.status, 0);
  assert.equal(creates(result).length, 1);
  assert.equal(result.state[0], null);
  assert.match(result.output, /Release promotion failed/);
});

test('rejects an invalid temporary source manifest', () => {
  const result = runScenario({ invalidSource: true });

  assert.notEqual(result.status, 0);
  assert.equal(creates(result).length, 0);
});

test('rejects invalid destination tags before registry access', () => {
  const result = runScenario({
    args: ['../invalid']
  });

  assert.equal(result.status, 2);
  assert.match(result.output, /Invalid image tag/);
  assert.equal(result.commands.length, 0);
});

test('rejects duplicate architecture digests', () => {
  const result = spawnSync(
    'bash',
    [
      script,
      image,
      source,
      amd64,
      amd64,
      'release-version'
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Invalid or duplicate architecture digests/);
});


test('removes temporary registry diagnostics on success and failure', () => {
  const scenarios = [
    {},
    { forbiddenTag: 'release-version' },
    { failAfterPublish: 'release-version' },
    { failBeforePublish: 'release-version' }
  ];

  for (const scenario of scenarios) {
    const result = runScenario(scenario);

    assert.deepEqual(
      result.temporaryEntries,
      [],
      `Temporary files remain for scenario: ${JSON.stringify(scenario)}`
    );
  }
});
