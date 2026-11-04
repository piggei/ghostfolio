# Local OCI identity verification

The Docker daemon image ID is an opaque immutable handle. With the classic image
store it can identify a configuration; with containerd it can identify a manifest
or index. It is never accepted as a configuration digest by this controller.

`Docker.localIdentity()` resolves the image once, saves that immutable handle to a
private temporary directory, and passes the archive to `localImageIdentity()`.
The latter hashes the **original configuration bytes**, without trimming or
serializing JSON again. It verifies Linux/target architecture, expected identity,
source/revision/version labels and the rootfs DiffIDs reported by the daemon.
The local smoke uses the captured handle. The tag must still resolve to that
handle before publication and after the upload check.

After upload, the registry client still hashes manifest/config bytes and validates
architecture and provenance. The remote configuration digest must match the local
configuration digest. Both newly uploaded and recovered candidates are pulled and
smoke-tested by their exact immutable **remote manifest digest**. The candidate is
read again by that digest before qualification evidence is persisted. No equality
check accepts a manifest hash as an alternative to a config hash.

## Supported archives and rejection rules

The reader handles the USTAR regular-file/directory subset emitted by Docker save,
with either classic `<config-sha>.json` references or OCI `blobs/sha256/<sha>`
references. Layers are never extracted or executed by the reader. Layer bytes are
streamed when hashing, rather than buffering the complete image in memory.

It checks header checksums, sizes, alignment, end markers, unique normalized paths,
required regular files and original UTF-8 JSON. Duplicate JSON keys, including
escaped equivalent keys, are rejected. Links, traversal, absolute paths, extended
PAX/GNU headers and unknown formats fail closed. Exactly one saved image is
required. OCI indices must resolve unambiguously to one supported image manifest,
with matching descriptor sizes, computed content hashes, platform and config.
OCI layer references/sizes/content digests are checked; classic layers are checked
against the configuration DiffIDs. No JSON is trusted solely because its filename
looks like a digest. Limits: 64 GiB total archive, 4096 entries, 4 MiB per JSON
object and four nested index descriptors and 64 JSON nesting levels. Unsupported export formats require a
reviewed reader update, never a fallback to `.Id`.

Temporary files are removed in `finally`. No new runtime library or package
manifest change is required. Additional costs are local image-export space and
I/O, layer hashing, and a remote native smoke for a fresh candidate. Disk/export,
validation or smoke failures leave qualification evidence unmodified; a candidate
already uploaded can remain available for recovery.

## Tests

Run the complete suite from this worktree:

```bash
node --test --experimental-test-isolation=none scripts/home-assistant-addon-*.test.mjs
```

The pipeline mocks model classic config handles and containerd manifest handles
separately. The archive tests cover both architectures/layouts, distinct manifest
and config hashes, duplicate/ambiguous documents, corrupt hashes/layers, invalid
platforms/labels, malformed archives and local tag replacement. Pipeline tests
require the remote immutable smoke before persistence, preserve the reservation on
failure and recover existing candidates without rebuilding or overwriting them.

The pre-existing checked-in-bootstrap test now permits the reservation present in
the approved generation-one baseline. It still requires a legacy current manifest,
no current release and no qualification/publication evidence in any reservation.
The state machine and the checked-in registry/configuration are unchanged.

## Explicit local integration experiment

`scripts/home-assistant-addon-oci-integration.mjs` is a developer-only experiment,
not a release entry point. It requires an explicitly supplied loopback registry;
all image push/promotion destinations are constrained to that address. Its GitHub
ledger and tags are in memory; no real Git ref or metadata commit is written.
The unchanged NG source may be read from GHCR. All publication writes go solely to
the disposable local registry.

```bash
HA_OCI_TEST_REGISTRY=127.0.0.1:PORT \
HA_OCI_TEST_REPORT=/tmp/ha-oci-integration.json \
node scripts/home-assistant-addon-oci-integration.mjs
```

On an AMD64 host the experiment runs the complete existing add-on smoke locally,
on the uploaded remote digest, and again on recovery. The ARM64 branch uses a
scratch fixture and validates only metadata/controller/registry protocol. The
synthetic final ledger is an integration-test assertion, **not native ARM64
qualification or production evidence**. Native ARM64 add-on tests remain required
on an ARM64 machine. Registry storage must be disposable and loopback-only; remove
that test container after collecting results. The test never logs into or pushes
to GHCR. Do not use a production registry for this experiment.

A second mode exercises both real stores with tiny metadata fixtures. Supply an
already started disposable classic `vfs` daemon socket under a task-specific `/tmp`
directory; it never reconfigures the primary containerd daemon:

```bash
HA_OCI_TEST_MODE=metadata \
HA_OCI_TEST_CLASSIC_HOST=unix:///tmp/ghostfolio-task04e-classic-UNIQUE/docker.sock \
HA_OCI_TEST_REGISTRY=127.0.0.1:PORT \
HA_OCI_TEST_REPORT=/tmp/ha-oci-store-matrix.json \
node scripts/home-assistant-addon-oci-integration.mjs
```

This mode builds both architecture fixtures, imports them into the classic daemon,
exports their raw config bytes with the production helper, and verifies local
push/pull and registry config equality on both stores. It executes no image code.
Starting/stopping that isolated daemon is an explicit local test setup operation,
not a controller feature or a workflow change.

Task 04E local results: 165 Node tests pass (110 existing, 55 additional). The real
classic/containerd metadata/push/pull matrix passed for both architectures. The
full local controller experiment passed with three native AMD64 add-on smoke runs,
candidate-to-final digest equality, retry without rebuild and a synthetic final
registry at generation 6. Native ARM64 application execution was not available on
this AMD64 host. No real GitHub ledger, release or package was updated.

## Abandoned 3.97.1 and future releases (Task 04F)

The decision is to abandon the unactivated `3.97.1` attempt operationally. Do not
retry NG run `41731193162`, qualify its uploaded candidate, recycle the version or
rewrite/delete the reservation. Its persisted state remains `reserved`, generation
1, with the original five-field identity and empty evidence maps. No `abandoned`
state or schema migration is needed: `reserveRelease()` already permits a newer
NG run/tag while a previous reservation is incomplete.

A new identity must use a greater NG run number and an application version that
does not regress. Changing only the digest or add-on revision of the existing NG
tag is a conflicting retry and is rejected. The new controller/source revision
belongs to the **new** NG identity, never to the old reserved one.

With the current last allocated add-on version `3.97.1`, allocation examples are:

| Next NG application version | Next add-on version |
| --------------------------- | ------------------- |
| `3.97.0`                    | `3.97.2`            |
| `3.97.1`                    | `3.97.2`            |
| `3.97.2`                    | `3.97.2`            |
| `3.98.0`                    | `3.98.0`            |

These are in-memory simulations, not allocations. The public add-on remains
`3.97.0` until a future release has both qualified/published architectures and an
atomic activation commit. A simulated complete new release preserves the old
record byte for byte and can activate normally. With the current state its
transitions would advance generation 1 through 7; this is not a reserved future
generation number and must be re-derived from real state on publication.

After a newer reservation exists, the resolver skips an older incomplete request
when presented with its original identity (`superseded`). If a newly pinned
controller produces a different identity for the old NG tag, the conflict check
rejects it instead. Neither behavior authorizes retrying or resurrecting `3.97.1`.
There is no automatic abandonment flag in the registry; avoid historical reruns.

## Prepared native ARM64 qualification

The new `.github/workflows/home-assistant-addon-oci-native-test.yml` is local only
until publication is separately authorized. A push of the approved fix branch
will run its `ubuntu-24.04-arm` job. It has read-only repository/package grants,
no manual dispatch, no GHCR login/push, no release reusable invocation and a
concurrency group separate from publication. Its registry is bound to loopback
and uses the reviewed multiarchitecture registry image digest. The existing ARM64
smoke-only workflow remains unchanged; by itself it would not exercise the fixed
post-upload OCI comparison.

`scripts/home-assistant-addon-oci-arm64-qualification.mjs` requires both ARM64 Node
and an `aarch64` native host before contacting Docker or a registry. On a genuine
ARM host with an already running disposable loopback registry, run:

```bash
HA_OCI_TEST_REGISTRY=127.0.0.1:PORT \
HA_OCI_ARM64_REPORT=/tmp/ha-oci-arm64.json \
node scripts/home-assistant-addon-oci-arm64-qualification.mjs
```

The qualifier builds the complete add-on, hashes the exported raw config, runs the
unchanged native smoke on the local immutable handle, uploads only to the local
registry, verifies config equality/architecture/labels, pulls by remote manifest
digest, repeats the unchanged native smoke and promotes only that digest to a
second local test tag. The report must show identical candidate/promoted digests.
It does not instantiate a GitHub client, save a release registry or create Git
refs. Historical NG run 15 is solely the immutable read-only test-image fixture;
the `3.97.2` label is a local fixture, not allocation or recovery of a release.
The committed test-source digest/revision must continue to match this fixture.

This host is AMD64: the ARM native guard is tested and rejects execution here.
The real ARM job has **not** been run. Publishing the fix branch to obtain that
result requires separate authorization, including the automatic test workflow.
A failure must be investigated before promoting the controller or changing a pin.
Task 04F local validation passes 174 Node tests, including the new allocation and
native-host/loopback security checks. Actionlint, shell syntax/ShellCheck, YAML,
formatting and whitespace checks pass. These checks do not count as a native ARM
execution or a production allocation.

## Proposed publication sequence — not executed

1. Review the combined OCI fix and the new regression proving a pending record
   does not block a newer identity. Keep all production state unchanged.
2. After separate commit/push authorization, publish only the fix branch. Record
   its actual immutable SHA **C**. The prepared push-triggered native ARM job must
   pass at C; inspect its Docker store, config/manifest evidence, both native
   smokes and local candidate/promoted digest equality. No GHCR publication is
   involved. Re-review any correction and use its new actual SHA, not a guessed C.
3. In a coordinated window with no active NG/HA release, recheck HA remote head
   `86b4a32ae0240814904245382f18b79d4ef0551b`, generation 1 and the old candidate.
   After explicit authorization, fast-forward the HA publication branch to C
   without overwriting concurrent work. This carries the unchanged reservation
   plus the new controller; it does not recover or activate `3.97.1`. Existing
   native AMD64/ARM64 smoke workflows may run on that branch push; verify them.
4. After that succeeds, prepare a separately authorized orchestration change from
   current fork main. Update the static reusable `uses` reference, validator
   checkout and `HA_REVISION`/output `addon_source_revision` together to C. Verify
   the five-input contract, provenance, ordering, tests and concurrency. No source
   revision split or special recovery workflow is required for the new identity.
5. Commit/publish/review that pin change under separate authorization, then
   introduce it on main under another controlled activation decision. Review
   main-push side effects (`Extract locales`, potentially a localization branch
   or PR attempt); do not fix its permissions implicitly. Check no NG release is
   running when the new pin becomes active.
6. Only after explicit release authorization, let a **new** successful NG run
   with number greater than 15 and its own published GitHub release trigger HA.
   Do not dispatch the historical run 41731193162. Resolve the new actual digest
   and version; derive allocation again from current registry state. For unchanged
   upstream 3.97.0 the expected next add-on is 3.97.2.
7. Verify both native qualifications, immutable promotion, atomic activation,
   correct current_release and version tag, while the old 3.97.1 record/candidate
   remain unchanged. Cleanup is a future independent decision. Supervisor testing
   remains human-controlled after a successful publication.

No commit, push, tag, dispatch, pin change or production allocation is authorized
or performed by this preparation. New Git branches/worktrees for the future pin
change must be proposed and authorized before creation. The seven existing
worktrees remain unchanged except for this isolated fix worktree.
