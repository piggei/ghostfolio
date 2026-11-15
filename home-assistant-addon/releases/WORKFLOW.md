# Home Assistant release workflow

This document describes the production release path for the Ghostfolio-NG
Home Assistant add-on in `piggei/ghostfolio`.

The current implementation has two cooperating workflows:

- `.github/workflows/integration-release.yml` publishes a verified
  Ghostfolio-NG integration release.
- `.github/workflows/ghostfolio-ng-ha-orchestrator.yml` resolves a
  completed NG release and invokes the reusable Home Assistant publisher.
- `.github/workflows/home-assistant-addon.yml` builds, qualifies and
  publishes the add-on images, then activates the release metadata.

The reusable publisher is called at the immutable revision
`d78d0e7939c4e7b70eeda9b628244e9f5c47656c`. The orchestrator checks out
that same revision as a read-only validation contract and passes it as
`addon_source_revision`.

## Production trigger: Ghostfolio-NG to Home Assistant

The normal production path is automatic:

1. A push to `integration/ghostfolio-all-pr` starts
   **Publish integration Docker release**.
2. The NG workflow verifies the integration and builds/tests the
   AMD64 and ARM64 images.
3. The NG release job publishes the integration release and its
   immutable source references.
4. After the NG workflow completes successfully, GitHub emits a
   `workflow_run` event for the orchestrator.
5. The orchestrator validates the completed NG run, release, Git tag,
   source image and current HA release contract.
6. The orchestrator calls the reusable HA publisher using the five
   immutable release inputs.
7. The HA publisher reserves an add-on version, qualifies both
   architectures, publishes the final images and activates metadata.

The orchestrator listens only for completed runs of
**Publish integration Docker release** on
`integration/ghostfolio-all-pr`. It runs from `main`, and its job
requires the event to belong to `piggei/ghostfolio` and the default
branch ref `refs/heads/main`.

A successful NG run is necessary but not sufficient: the orchestrator
also verifies the release provenance and the actual GHCR source image.
It does not build or republish NG.

## Orchestrator recovery

The orchestrator also exposes `workflow_dispatch` with one required
input, `ng_run_id`.

This is a recovery entry point for an already completed successful NG
run. It resolves that run again and performs the same provenance checks.
It does not rebuild NG or accept caller-supplied tags, commits or image
digests.

Manual dispatch is available from the default-branch workflow. Use it
only when an automatic `workflow_run` invocation needs recovery or
reprocessing. Do not dispatch while the corresponding automatic run
is still active.

The orchestrator serializes its own runs with the
`ghostfolio-ng-ha-orchestrator` concurrency group and
`cancel-in-progress: false`.

## NG provenance validation

The orchestrator identifies the registered NG workflow by its path,
name and workflow ID. It requires the run to match:

- Repository: `piggei/ghostfolio`
- Branch: `integration/ghostfolio-all-pr`
- Workflow: `.github/workflows/integration-release.yml`
- Workflow name: `Publish integration Docker release`
- Event: `push` or an explicitly requested `workflow_dispatch`
- Status: `completed`
- Conclusion: `success`

For automatic events, the event payload must match the canonical run
including run ID, attempt, run number, commit and workflow ID.

The selected run attempt must contain exactly one completed successful
`release` job bound to that same run and commit. Jobs from earlier
attempts are not combined with the selected attempt. A partial rerun
without a successful release job in its latest attempt is rejected.

The orchestrator binds the package version to the run commit, checks
the expected integration tag and published GitHub Release, resolves
the Git tag to the exact source commit, and obtains the immutable NG
source image digest from GHCR. It then rechecks the run, release and
tag before returning the HA inputs.

A newer NG run number supersedes an older unprocessed release. An
older run is not allowed to allocate a new add-on version after a
newer release has already been recorded.

## Reusable publisher inputs and outputs

The reusable workflow
`.github/workflows/home-assistant-addon.yml` requires five strings:

| Input | Meaning and validation |
| --- | --- |
| `integration_tag` | Published NG tag in the form `integration-X.Y.Z-N` |
| `source_commit` | Full 40-character source commit SHA |
| `source_image` | Immutable `ghcr.io/piggei/ghostfolio-ng@sha256:…` reference |
| `ghostfolio_version` | Three-component upstream application version |
| `addon_source_revision` | Full approved SHA of the HA publisher implementation |

The publisher validates the identity against the NG GitHub Release,
tag, source commit, package version, immutable source image and
registered successful NG release job.

The reusable workflow checks out the approved add-on source revision
for every build and publication job. It does not build from the
caller's integration branch.

Outputs are emitted after publication and tag verification:

- `addon_version`
- `amd64_digest`
- `aarch64_digest`
- `metadata_commit`
- `publication_status`: `activated` or `already_activated`

## HA publication stages

The publisher uses one repository-wide concurrency group,
`ghostfolio-home-assistant-release`, with
`cancel-in-progress: false`.

The jobs execute in this order:

```text
prepare (AMD64)
  verify NG provenance and immutable source
  reserve add-on version and persist release plan

qualify-amd64 (AMD64)
  build or recover candidate
  smoke-test local image
  push and inspect candidate by digest
  pull and smoke-test exact remote digest
  persist AMD64 qualification evidence

qualify-aarch64 (native ARM64)
  build or recover candidate
  smoke-test local image
  push and inspect candidate by digest
  pull and smoke-test exact remote digest
  persist ARM64 qualification evidence

publish (AMD64)
  verify both qualified candidates
  promote each exact digest to its final version tag
  verify both final images again
  atomically activate registry, manifest, config and documentation
  create or verify the versioned Git tag
```

The ARM64 job uses a native `ubuntu-24.04-arm` runner. The AMD64
jobs use `ubuntu-latest`.

The publication job does not rebuild either architecture. It promotes
the exact qualified candidate digests. Both final images must match
their qualified descriptors before activation.

Candidate tags are derived from the full immutable release identity.
If a run is interrupted after an upload, a later run can locate the
candidate, pull it by digest and repeat the native smoke test.
A mutable candidate tag is never accepted as a substitute for the
recorded digest.

## Version allocation and activation

The HA publisher reserves a unique add-on version in
`home-assistant-addon/releases/registry.json`.

The NG integration tag, upstream Ghostfolio version and HA add-on
version are distinct identifiers. Multiple NG builds of the same
upstream version can therefore receive successive HA add-on versions.

The current advertised version is advanced only after both final
architecture images have been verified.

The activation commit updates these files together:

- `home-assistant-addon/releases/registry.json`
- `home-assistant-addon/release.json`
- `home-assistant-addon/config.yaml`
- `home-assistant-addon/README.md`
- `home-assistant-addon/DOCS.md`
- `home-assistant-addon/CHANGELOG.md`, when release notes are present

The versioned tag follows
`home-assistant-addon/vX.Y.Z` and points to the activation commit.
An existing tag must resolve to the expected commit; tags are never
moved or overwritten.

## Recovery

Recovery is based on the registry and actual GHCR state, not on
workflow artifacts alone.

| Interrupted point | Expected recovery |
| --- | --- |
| After reservation | Reuse the existing identity and allocated version |
| Candidate upload response lost | Inspect the deterministic candidate and verify its config |
| Candidate uploaded before evidence commit | Pull by digest and rerun native smoke qualification |
| Only one final image published | Retain and verify it; publish only the missing architecture |
| Final image published before evidence commit | Inspect GHCR and persist matching publication evidence |
| Activation committed before tag creation | Verify the historical activation commit and create only the missing tag |
| Already activated release retried | Verify immutable images and tag; do not move current metadata backwards |

Restart the full HA workflow with the same five inputs after an
interrupted publication. For an existing HA run, use **Re-run all jobs**,
not only failed jobs: the workflow transfers per-attempt plan artifacts
between jobs, and remote branch-head checks deliberately reject stale
plans.

The orchestrator's manual recovery input is an NG run ID. It reruns
NG provenance resolution and then calls the HA publisher; it does not
rebuild NG.

A missing image for an already activated release is a maintainer
intervention condition. The publisher does not silently rebuild or
replace an activated image.

GitHub concurrency is not a durable FIFO queue. If a pending run is
superseded, explicitly recover the required NG run after checking that
it is not already being processed.

## Concurrency and Git safety

Every registry operation is committed against the observed remote
HA branch head. The publisher checks the remote head before preparing
a write and immediately before advancing the branch.

Ref updates are non-force updates. A concurrent commit or source/config
drift causes the operation to fail rather than overwrite another writer.

The local registry lock protects processes sharing one filesystem;
it is not a distributed lock. Repository-wide GitHub concurrency and
remote head checks provide the cross-run protection.

GHCR mutable tags do not provide compare-and-swap semantics. The
publisher therefore checks for existing tags, verifies their digests
and refuses conflicting images. Uncoordinated external writers must
not publish to the add-on image repositories.

## Permissions

The workflows use the repository-provided `GITHUB_TOKEN`.

| Job | Required permissions |
| --- | --- |
| Orchestrator resolve | `contents: read`, `actions: read`, `packages: read` |
| HA prepare | `contents: write`, `packages: read`, `actions: read` |
| HA qualification | `contents: write`, `packages: write`, `actions: read` |
| HA publication | `contents: write`, `packages: write`, `actions: read` |

The reusable workflow cannot increase permissions granted by its
caller. The orchestrator therefore grants the permissions required
by the called publisher.

Checkout credentials are not persisted. No personal access token
or additional repository secret is required by this release path.

## Current production reference

The latest end-to-end verified release is:

| Item | Value |
| --- | --- |
| NG integration tag | `integration-3.99.0-24` |
| NG source commit | `f0c04418df139244ff6a41443a2ca08407993a01` |
| HA add-on version | `3.99.3` |
| HA publisher revision | `d78d0e7939c4e7b70eeda9b628244e9f5c47656c` |
| HA activation commit | `96854aab978dc4b6554f614ef9f3460197271a8c` |

Both AMD64 and ARM64 images were qualified and published, the HA
release metadata was activated, the versioned Git tag was created,
and the update and changelog were confirmed in a real Home Assistant
installation.

Future releases should not copy these version or digest values.
The registry, manifest and workflow outputs are the authoritative
sources for each new release.

## Validation

Run the release contract tests:

```sh
node --test scripts/home-assistant-addon-release.test.mjs
```

Run the pipeline and recovery tests:

```sh
node --test scripts/home-assistant-addon-pipeline.test.mjs
```

Run the workflow input and event contract tests:

```sh
node --test scripts/home-assistant-addon-workflow.test.mjs
```

Run the orchestrator tests from the repository root:

```sh
node --test scripts/ghostfolio-ng-ha-orchestrator.test.mjs
node --test scripts/ghostfolio-ng-ha-orchestrator-workflow.test.mjs
```

Official references:

- [Reusable workflows and immutable references](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [Events that trigger workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Workflow syntax and concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
