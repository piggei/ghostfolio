# Home Assistant release state contract

This document describes the release registry and state machine used by
the automated Ghostfolio-NG Home Assistant add-on publisher.

The implementation is maintained in:

- `scripts/home-assistant-addon-release.mjs`
- `scripts/home-assistant-addon-pipeline.mjs`
- `scripts/home-assistant-addon-github.mjs`

The registry is stored in `home-assistant-addon/releases/registry.json`.
The current advertised release is materialized in
`home-assistant-addon/release.json`.

## Source of truth

`registry.json` is the authoritative allocation and release history.
It records every allocated add-on version, including reservations that
did not reach publication.

`release.json` is the current advertised release manifest. It is
derived from the registry's `current_release` pointer and is updated
only when a release is activated.

The add-on `config.yaml` version and the current-release documentation
are updated in the same activation commit. This keeps the version
advertised to Home Assistant aligned with the activated registry record.

The initial baseline version is `3.97.0`. Its legacy manifest is
preserved as historical state; it is not retroactively represented
as a release qualified by the current automation.

## Release identity

Every release is identified by exactly five immutable fields:

| Field | Meaning |
| --- | --- |
| `integration_tag` | Published Ghostfolio-NG integration tag |
| `source_commit` | Full Git commit SHA associated with the NG release |
| `source_image` | Immutable GHCR source image reference, pinned by SHA-256 digest |
| `ghostfolio_version` | Three-component upstream Ghostfolio version |
| `addon_source_revision` | Full Git SHA of the approved HA publisher implementation |

The integration tag follows `integration-X.Y.Z-N`. Its embedded
version must match `ghostfolio_version`. Both commit references must
be full 40-character hexadecimal SHAs. The source image must reference
`ghcr.io/piggei/ghostfolio-ng` by a SHA-256 digest.

The integration tag is the lookup key, but retries must match all five
identity fields exactly. Reusing a tag with different source metadata
is rejected.

Historical tag formats with an additional attempt suffix are not part
of the current NG release identity contract.

## Add-on version allocation

The registry starts from the documented baseline and allocates
strictly increasing three-component add-on versions.

For each new NG integration release:

1. Its NG run number must be greater than the previous allocation.
2. Its upstream Ghostfolio version must not regress.
3. The next add-on version is the upstream version if that version is
   greater than the previous add-on version.
4. Otherwise, the patch component of the previous add-on version
   is incremented.

Version comparisons use integer components rather than lexical string
ordering.

A reservation is permanent. Failed or abandoned reservations remain
in the registry and their version numbers are not reused. Retrying the
same release identity reuses its existing reservation; it does not
allocate another version.

This allows multiple NG integration builds of the same upstream
Ghostfolio version to receive distinct Home Assistant add-on versions.

## Registry schema

The registry uses schema version 1 and contains:

- `schema_version`: registry format version.
- `generation`: monotonically increasing counter for persisted operations.
- `baseline_version`: initial add-on version baseline.
- `current_release`: integration tag of the latest activated release,
  or `null` before the first activation.
- `releases`: ordered release allocation and evidence records.

Each release record contains:

- `identity`: the five immutable identity fields.
- `addon_version`: permanently allocated add-on version.
- `state`: current release state.
- `qualified`: per-architecture candidate image evidence.
- `published`: per-architecture final image evidence.

Image evidence contains exactly:

- `os`: `linux`.
- `architecture`: OCI architecture (`amd64` or `arm64`).
- `digest`: SHA-256 content digest.

The Home Assistant architecture `aarch64` maps to OCI architecture
`arm64`; `amd64` maps to `amd64`.

## State transitions

A release progresses through the following states:

```text
reserved
  -> qualified
  -> published
  -> activated
```

- **reserved** — identity and add-on version have been allocated.
- **qualified** — both AMD64 and ARM64 candidate images have been
  recorded after qualification.
- **published** — both final architecture image descriptors have been
  recorded and match their qualified candidate descriptors exactly.
- **activated** — release metadata has been advanced and the release
  is advertised to Home Assistant.

The state is derived from the evidence maps. A release cannot skip
a state, publish before both architectures qualify, or activate
without both final images.

The two architecture digests must be distinct. Published evidence
must match qualified evidence exactly.

## Activation and historical releases

The `current_release` pointer identifies the newest activated record.

Activation is monotonic: an older release cannot replace a newer
activated release. Retrying an already activated historical release
is a no-op and does not move the current pointer backwards.

Activated records are immutable. Their identity, allocated version
and image evidence cannot be changed.

The current manifest is derived from the activated registry record.
Before the first automated activation, the legacy manifest continues
to describe the pre-existing baseline without claiming automated
qualification or publication.

## Persistence and concurrency

The local registry module validates schema, identity, evidence and
state transitions. Its `saveRegistry()` operation:

- uses an exclusive local lock file;
- checks the expected SHA-256 revision of the current registry;
- checks the generation and reconstructs exactly one authorized
  state-machine operation;
- writes a temporary file and flushes it before atomic rename;
- rejects stale writers instead of overwriting concurrent changes.

The local lock coordinates processes sharing that filesystem. It is
not a distributed Git lock and does not provide a power-loss durability
guarantee by itself.

The release pipeline adds remote concurrency protection. Each logical
registry operation is persisted through a Git commit based on the
observed remote branch head. Remote head checks and non-force ref
updates reject concurrent changes rather than overwriting them.

Registry, manifest, add-on configuration and current-release
documentation are committed together during activation. The versioned
Git tag is then created or verified against the activation commit.

## Operational guarantees

The state contract validates data supplied to it; it does not itself
contact GitHub or GHCR, inspect OCI manifests, build images or run smoke
tests. Those checks are performed by the publisher pipeline before
evidence is recorded.

The publisher verifies source provenance, image architecture,
manifest/config digests and provenance labels. Candidate images are
pulled and smoke-tested by digest. Final images are promoted from
qualified digests and checked again immediately before activation.

Existing tags are never overwritten. A conflicting digest or tag
causes publication to fail. A missing image for an already activated
release requires maintainer intervention; it is not silently rebuilt
or replaced.

## Tests

Run the release state contract tests from the repository root:

```sh
node --test scripts/home-assistant-addon-release.test.mjs
```

The pipeline and persistence integration tests are covered separately
by:

```sh
node --test scripts/home-assistant-addon-pipeline.test.mjs
```
