# Release state contract (Phase 1A)

`registry.json` is the authoritative allocation history. `../release.json` is
the current advertised release manifest. Schema validation and state transitions
are implemented in `../../scripts/home-assistant-addon-release.mjs`, using Node
built-ins and no additional dependencies.

The initial registry preserves the existing `3.97.0` version as a baseline.
The initial manifest has state `legacy`: it deliberately makes no claim that
the new automation qualified or published the existing images. No version has
been allocated by the automation yet.

## Identity and allocation

Each record contains exactly:

- `identity`: `integration_tag`, `source_commit`, `source_image`,
  `ghostfolio_version`, `addon_source_revision`.
- `addon_version`: the permanently reserved three-component version.
- `state`: `reserved`, `qualified`, `published`, or `activated`.
- `qualified`: verified candidate descriptors keyed by HA architecture.
- `published`: verified final descriptors keyed by HA architecture.

The integration tag is the lookup key; all five identity fields must match on
retry. Both revisions are full Git commit SHAs. Only the expected NG repository
with a SHA-256 digest is accepted. Tags must follow the current integration
workflow's `integration-X.Y.Z-N` format, with a matching upstream version.
Historical `.attempt` tag suffixes are intentionally rejected: the current NG
workflow does not emit them. Supporting them requires an explicit identity policy.

New reservations must have a greater NG run number and must not regress the
upstream version relative to previous allocations. The maximum of baseline and
all allocations determines the next version: use upstream if greater, otherwise
increment the maximum's patch. Failed reservations remain consumed. A retry
never allocates again, including a retry after a newer release has activated.
Numbers are compared using BigInt, avoiding string ordering and precision loss.

The initial baseline does not establish a verified NG run ordering. The workflow
must verify the first requested release against the existing deployment and
published NG provenance before reservation.

## Transitions and evidence

```text
reserved --both candidates recorded--> qualified
qualified --both final digests recorded--> published
published --monotonic activation--> activated
```

Each image descriptor contains `os`, `architecture`, and `digest`. HA `aarch64`
maps to OCI `arm64`; `amd64` maps to OCI `amd64`. Only Linux is supported.
Partial progress remains in the per-architecture maps: a failed ARM64 build or
publication cannot advance the overall state prematurely. Both candidates must
qualify before any final image can be recorded. Final descriptors must match
qualified descriptors exactly. Recorded descriptors cannot be replaced on retry.

These functions validate the shape and consistency of supplied evidence. They do
not contact GitHub or GHCR, inspect OCI manifests, execute tests, or prove that a
caller actually verified a remote image. Phase 1B must perform those operations
before recording the descriptors, including source-commit provenance checks.

`current_release` points to the newest activated record. Activation changes only
the in-memory snapshot; `currentManifest()` derives the proposed manifest.
Older published records cannot replace newer activated metadata. Retrying an
already activated historical release is a no-op, preserving the newer pointer.

## Persistence and concurrency boundary

Transitions return validated copies and never mutate their arguments.
`generation` advances once per changed operation; identical retries preserve it.
`saveRegistry()` accepts exactly one logical operation per generation: reserve
one release, record one architecture descriptor in one evidence map, or activate
one published release. It reconstructs that operation through the same public
state-machine functions and compares the entire resulting snapshot. Schema-valid
snapshots that skip states, batch evidence additions, alter existing evidence,
modify multiple releases, or change the current pointer independently are rejected.
The first candidate keeps state `reserved`; the second advances to `qualified`.
The first final descriptor keeps state `qualified`; the second advances to
`published`. Each individual descriptor must be persisted before the next one.
Activation is a separate operation and cannot introduce any image evidence.
Activated records are immutable, including identity, version and both evidence
maps. Historical retries remain no-ops and cannot move the current pointer.

`loadRegistry()` validates persisted JSON. `saveRegistry()` uses an exclusive
local lock, expected snapshot SHA-256, generation checking, immutable history
checks, a flushed temporary file and atomic rename. A stale writer fails rather
than overwriting another writer. Initialization is explicit; missing or corrupt
registries are never silently recreated. An abandoned lock requires inspection
and deliberate recovery; it is never automatically stolen.

This provides local process coordination and atomic registry replacement, not
a distributed Git lock or a power-loss durability guarantee. All writers must
follow the same locking protocol. The registry is one file to avoid partial
updates across many allocation files.

Phase 1B must persist reservations before publication and update registry,
current manifest, config and current documentation in one coherent Git commit
after both remote final images are verified. It must check remote branch HEAD,
reject stale pushes without force-push, serialize release runs, and recover
activation/tag publication independently. This phase intentionally does not
implement those workflow or metadata writes, or allocate a real new version.

Run contract tests from the add-on worktree:

```sh
node --test scripts/home-assistant-addon-release.test.mjs
```
