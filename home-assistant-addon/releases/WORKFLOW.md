# Home Assistant release workflow

This workflow builds on the original dispatch workflow (`444d08508f73`) and
versioned-tag workflow (`8b7b59cf2a00`). All supported release entry points use
the same controller, state machine, registry client and qualification script.
The NG integration workflow is intentionally unchanged in Phase 1B.

## Inputs and outputs

`workflow_call` and `workflow_dispatch` require five strings:

| Input                   | Validation                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `integration_tag`       | Published `integration-X.Y.Z-N`, not draft/prerelease                                                                  |
| `source_commit`         | Full SHA matching the peeled integration Git tag, package version and successful NG `release` job                      |
| `source_image`          | `ghcr.io/piggei/ghostfolio-ng@sha256:…`, matching both immutable release and commit tags                               |
| `ghostfolio_version`    | Three components matching integration tag and source `package.json`                                                    |
| `addon_source_revision` | Full approved SHA containing this implementation; its build/test/controller files must match the destination HA branch |

NG provenance requires one unambiguous matching run of the registered integration
workflow, bound to repository, workflow ID/path, branch, run number and commit.
The latest run must be `completed` with conclusion `success`. Its explicitly
selected attempt must contain exactly one completed successful `release` job
with the same run ID and commit. Jobs are fetched from the attempt-specific API,
never combined with earlier attempts. The run is read again after the jobs to
reject a retry or identity/status change during verification. A partial rerun
whose latest attempt has no `release` job is deliberately rejected, even if an
earlier attempt contains a successful publication job.

This strict completed-run requirement rules out calling HA as a blocking job
inside that same NG run: the parent would remain in progress until HA finished.
Phase 1C must establish a separate invocation after NG completion. No workflow
is redesigned or changed to resolve that orchestration decision in review 1B-R.

Outputs: `addon_version`, `amd64_digest`, `aarch64_digest`, `metadata_commit`,
`publication_status` (`activated` or `already_activated`). Outputs are emitted
only after both final images and the corresponding Git tag have been verified.

The future NG caller must use a literal full approved SHA in its reusable
workflow reference. A relative call would resolve against the caller commit.
No caller or placeholder SHA is added in Phase 1B. Every job explicitly checks
out the immutable add-on source revision, never the integration caller's files.

## Execution

```text
prepare (AMD64): verify NG provenance + OCI source → persist reservation
  → qualify-amd64: build/reuse → shared smoke → candidate push/verify → persist
  → qualify-aarch64 (native ARM64): same steps → persist
  → publish (AMD64): verify both candidates
      → promote AMD64 by digest → verify → persist publication evidence
      → promote AArch64 by digest → verify → persist publication evidence
      → verify both finals again
      → atomic activation commit: registry + manifest + config + current docs
      → create/verify versioned Git tag
```

Serial architecture jobs ensure each qualification is persisted before the next
job. The same tested local image is uploaded, or the existing candidate is pulled
by digest and retested. There is no build in the publication job. Candidates use
a stable hash of the full release identity, so a new workflow run can recover
an upload whose registry commit was interrupted. Candidate images deliberately
disable Buildx attestations to retain a single-platform manifest for exact digest
promotion. The NG source index supports identified attestation descriptors.

OCI reads verify SHA-256 from response bytes, manifest/config digests, actual
config architecture and provenance labels. Source validation checks both native
platforms and rejects duplicate/extra runnable platforms. Only HTTP 404 means
absence; authentication, rate-limit, transport and server failures abort safely.

The shared smoke script retains the original AMD64/ARM64 runtime assertions and
adds Redis authentication rejection plus PostgreSQL/Redis/secrets persistence
across restart and recreation with the same volumes. Cleanup is an EXIT trap.
Ordinary CI uses the same script with read-only permissions. Its optional source
override must be immutable. Before the first automated activation it defaults to
the centrally pinned, previously qualified NG `-15` digest in `test-source.json`;
after activation it defaults to the current release manifest. That test pin does
not allocate or advertise a new add-on version. Direct Docker builds must provide
`GHOSTFOLIO_IMAGE`; the stale implicit Dockerfile source has been removed.

## Persistent recovery and concurrency

Each state-machine operation is validated through Phase 1A `saveRegistry()` and
persisted in its own remote commit. The API builds a new tree from the existing
remote tree, preserving unrelated files. It checks remote HEAD before preparing
the update and immediately before advancing the branch. The new commit has that
HEAD as its sole parent; the ref update uses `force: false`. A concurrent sibling
commit causes rejection rather than overwriting it. Source/config drift also
causes rejection. Lost branch-update responses are recovered only when the remote
HEAD equals the exact commit just created.

The workflow-wide, repository-wide concurrency group is
`ghostfolio-home-assistant-release`, with `cancel-in-progress: false`.
This supplements remote checks; the local lock is never treated as distributed.
GitHub concurrency is not a durable FIFO queue: superseded pending requests must
be explicitly retried if every release is required.

| Interrupted point                        | Recovery                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Reservation / qualification commit       | Reload the existing allocation; reuse its version                               |
| Candidate push response                  | Verify uploaded config against the tested local config                          |
| Candidate push before state commit       | Resolve the deterministic candidate, pull by digest and requalify               |
| One final published                      | Verify and retain it; publish only the missing other final                      |
| Final publication before evidence commit | Inspect actual GHCR state, then persist the matching evidence                   |
| Activation before tag creation           | Locate and verify the historical activation commit; create only the missing tag |
| Historical activated release             | Verify immutable artifacts and tag; leave current metadata unchanged            |

Existing final tags must match the qualified digest exactly. Conflicts are fatal.
No existing tag is overwritten or deleted. A missing image for an activated
release fails for maintainer intervention rather than silently republishing it.

Restart the **entire HA workflow**, with the same five inputs, after an interrupted
run. This retries HA only and never starts an NG build. Use **Re-run all jobs** on
an existing HA run, rather than only failed jobs: per-attempt handoff artifacts
and remote HEAD expectations deliberately reject stale job plans. Registry and
GHCR state, not artifact retention, are the recovery source of truth.

Manual dispatch is declared but GitHub normally exposes/requires it on the default
branch. This task does not change `main`; do not assume the Actions UI or
`gh workflow run --ref …` is available before that constraint is addressed.
An existing run of this new HA workflow can be rerun; historical runs of the old
workflow still execute the old implementation and are not recovery entry points.
The future approved reusable caller can also provide recovery without rebuilding
NG. Establishing the first remotely runnable
entry point is a deployment prerequisite, not a hidden default-branch change.

Versioned tag pushes are retained for recovery/verification of **already activated**
manifests. Legacy tags such as the existing `v3.97.0`, without the immutable
contract, fail with an explicit recovery message instead of selecting a digest
implicitly. Fresh pre-activation tag releases are intentionally unsupported:
the version must not be advertised before images exist, and an existing Git tag
must not be moved to a later activation commit.

## Permissions and deployment checks

Preparation needs `contents:write` for allocation, `packages:read`, `actions:read`.
Qualification and publication need `contents:write`, `packages:write`,
`actions:read`. Ordinary CI needs only `contents:read`, `packages:read`.
`GITHUB_TOKEN` is passed only to the controller/login steps; checkout credentials
are not persisted. No PAT, additional secret or repository setting is introduced.
Bot-generated commits/tags do not depend on push-triggered workflows, preventing
duplicate publication. The future reusable caller must grant the needed token
permissions: a callee cannot increase them.

Before enabling publication, maintainers must validate GitHub workflow syntax
with actionlint, runner availability, package visibility/permissions, branch/tag
rules, API commit permissions, native builds, real registry promotion and a real
Supervisor upgrade. Local Phase 1B validation completed an actual AMD64 build
and the shared application/persistence smoke test, including restart and
recreation. The bootstrap NG digest, both architectures, source revision labels
and immutable tags were also verified read-only against GHCR. Native ARM64 and
real Supervisor upgrade checks remain outstanding. No remote writes were executed;
publication and GitHub mutation recovery were tested with simulated services.

GHCR does not provide a compare-and-swap for mutable tags. Exclusive repository
release concurrency plus remote absence/digest checks protect this automation;
uncoordinated external writers must not publish to these image repositories.
The first allocation also assumes the documented installed baseline `3.97.0`:
its legacy manifest is not retroactively claimed as automation-verified.

Official references:

- [Reusable workflows and literal revisions](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [Token-generated events](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Workflow syntax and concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

## Bootstrap readiness review (1B-R)

No commit, push, tag or workflow execution is authorized by this procedure.
Each publication step below requires separate authorization. The remote HA branch
was confirmed at `ae29e27d8acb83f02d402ddeaa934aea867e7ea5`; it does not yet
contain this reusable implementation. That existing SHA must not be used as the
new reusable revision. The NG `-15` run `41731193162` was rechecked read-only:
completed/success, attempt 1, with a completed successful `release` job bound
to commit `649d61f90429483cac949c0c97c83d10c13f7c8e`.

### First authorized activation procedure

1. Freeze the reviewed HA changes, including all currently untracked Phase 1A
   registry/module files and the Phase 1B files. Confirm `config.yaml` still
   advertises `3.97.0`, the registry has no new allocations, and no NG files
   are included. Run the complete Node contract/service/workflow suite, syntax
   checks, ShellCheck and formatting/whitespace checks on these exact files.
2. Run `actionlint` against the three HA workflows before publication, using an
   already available approved installation. Do not install it or change project
   dependencies implicitly. Resolve errors and re-review any resulting changes.
3. Only after explicit authorization, create and publish the reviewed commit
   on `feat/home-assistant-addon`, without a release tag or force-push. That
   branch push is expected to run the ordinary read-only AMD64/ARM64 tests;
   it does not match the release workflow's tag trigger. Review those test runs,
   particularly native ARM64, before enabling the release caller.
4. Record the actual full 40-character commit SHA after the authorized commit
   exists. Read-only commands for the operator are:

   ```sh
   ha_release_sha=$(git rev-parse HEAD)
   git ls-remote origin refs/heads/feat/home-assistant-addon
   gh api "repos/piggei/ghostfolio/commits/${ha_release_sha}" --jq .sha
   ```

   Confirm all three identify the published reviewed commit. Do not substitute
   the current pre-implementation HEAD, a branch name or a moving tag. Record
   the SHA and test-run links in the deployment approval.

5. Verify the workflow and all required implementation files at that exact SHA:

   ```sh
   git show "${ha_release_sha}:.github/workflows/home-assistant-addon.yml"
   gh api "repos/piggei/ghostfolio/contents/.github/workflows/home-assistant-addon.yml?ref=${ha_release_sha}" --jq .sha
   ```

   The Contents API returns a blob SHA: compare it with the local blob SHA from
   `git rev-parse "${ha_release_sha}:.github/workflows/home-assistant-addon.yml"`.
   Confirm `on.workflow_call`, all five required string inputs and all five
   outputs. Recheck syntax/lint against the published blob, not an edited working
   copy. Confirm scripts, smoke script, mock Supervisor, manifest, registry,
   documentation markers and test-source pin also exist at the published SHA.

6. Review the caller's token grants and the callee's per-job permissions:
   preparation requires `contents:write`, `packages:read`, `actions:read`;
   qualification/publication require `contents:write`, `packages:write`,
   `actions:read`. Check repository workflow policy, branch/tag rules and GHCR
   package access permit those operations for `GITHUB_TOKEN`. Read-only review
   cannot prove that future writes will be accepted; no test write is permitted
   in this checkpoint. Do not add a PAT or change settings as a workaround.
7. Prepare the future literal reference by replacing `FULL_APPROVED_HA_SHA`
   below with the exact recorded SHA, and use the same value for
   `addon_source_revision`:

   ```text
   piggei/ghostfolio/.github/workflows/home-assistant-addon.yml@FULL_APPROVED_HA_SHA
   ```

   This is a documentation template, not an executable caller. A concrete
   immutable reference cannot exist until the authorized commit has been created
   and published. No caller is added in 1B-R.

8. Before Phase 1C implementation, approve an entry point that runs after the NG
   run has completed successfully. A separate `workflow_run` orchestrator would
   require presence on the default branch; a manual dispatch entry point has
   that constraint too. The remote `main` workflow directory currently contains
   only `build-code.yml`, `docker-image.yml` and `extract-locales.yml`.
   Do not assume dispatch is available or modify `main` without authorization.
   No same-run blocking call can satisfy the strict NG gate. After the entry
   point and immutable reference are approved, use an already completed NG
   release and its verified digest for the first separately authorized HA run.

### Trigger availability

| Path                      | Before publishing the reviewed HA SHA            | After publishing the HA SHA                                                                               |
| ------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `workflow_call`           | New implementation unavailable remotely          | Callable by a separately approved workflow using a literal full SHA; it need not be on the default branch |
| `workflow_dispatch`       | No new runnable entry point                      | Still blocked by missing default-branch registration; publication on the HA branch alone is insufficient  |
| Versioned tag `push`      | Historical tags execute historical workflow code | New code supports recovery only for an already activated manifest; it cannot bootstrap the first release  |
| Ordinary HA branch `push` | Existing test workflows only                     | Runs shared read-only qualification, not release publication                                              |
| Rerun of an HA release    | Historical runs retain old code                  | An existing run of the new implementation can be rerun in full after the first approved invocation        |

`GITHUB_TOKEN`-generated commits and tags are not used as triggers for another
release pipeline. Do not create a tag to force the bootstrap or move an existing
tag. Workflow availability and actual write permissions remain deployment checks.

### Actionlint availability and validation limits

Actionlint was unavailable during review 1B-R. For Task 02A the maintainer
installed actionlint 1.7.12 at `/usr/local/bin/actionlint`. Validation of all three
HA workflows now passes without diagnostics, closing the local Actions lint
checkpoint. YAML parsing with duplicate-key detection, the targeted workflow
contract tests, Node/Bash syntax checks, ShellCheck and formatting checks also
pass. No project dependency was added or changed.
Neither YAML parsing nor actionlint can establish remote package permissions,
runner availability or successful execution of the future immutable caller.

### Candidate integrity conclusion

No candidate implementation change was needed. Once recorded, the registry's
digest is authoritative; recovery pulls that digest and reruns smoke rather than
trusting a mutable candidate tag. A changed tag is not adopted. A mismatching
descriptor for the recorded digest is rejected before qualification/publication.
For an uploaded but unregistered candidate, matching labels do not replace the
smoke test. Both final descriptors must match recorded qualification exactly,
and both final tags are checked again immediately before activation. Regression
tests cover both architectures and digest drift after publication evidence was
already recorded. Uncoordinated external writers remain prohibited as documented.
