# Tasks 05C–05D-R5: isolated orchestrator qualification

## Status and immutable identities

Local implementation and review only; no commit, push or Actions run performed.
The temporary BLOCKED gate has been replaced after successful offline bundle
qualification by mandatory independent hash checks and real static validation.

- Orchestrator P: `f6ea73ca1f28750abd3b061023cab6a4f3443638`.
- HA controller C: `bfaf9ff86325d3d6fb25c37785e854cc583077df`.
- Harness branch: `test/ghostfolio-ng-ha-orchestrator-ci`, base P.
- Worktree: `/home/pj/repo/ghostfolio-ng-ha-orchestrator-ci`.
- Future reviewed harness revision H: not created yet.

P/C are literal checkout SHAs, and each actual checkout is checked and logged.
Only push to the dedicated harness branch is configured. No production release
entry point, reusable workflow, dispatch, image publication or tag operation runs.
Permissions are only `contents: read`; all checkouts discard credentials.
The runner is ubuntu-24.04 with a 15-minute timeout.

## Bootstrap trust boundary

A third sparse checkout obtains only qualification data from GitHub's
`github.workflow_sha`, the immutable identity of the executing workflow H. This
is neither a moving branch/tag nor a revision selected from NG event payloads.
The actual checkout SHA must equal that 40-character workflow identity. P and C
continue to use their independent literal references; no tested source comes
from the triggering push revision. No self-referential literal H is required.

The bundle archive, inventory and harness security test each have an independent
literal SHA-256 pin in the reviewed workflow. All three are checked BEFORE any
code from the qualification checkout or bundle is executed. A checkout alone is
not accepted as proof. After archive verification, only that authenticated archive
is extracted; its bundled Node validates the complete expected payload file set,
paths, sizes, executable flags and SHA-256 values against the pinned inventory.
No unverified helper from the sparse checkout is run. The only executable source
outside P/C is the hash-pinned tool bundle and hash-pinned security test. The
current harness YAML is read as data by that verified test; the workflow itself
is already the server-selected definition at H.

Review H and its literal hash pins before authorizing publication. SHA256SUMS
fetched beside an archive is not the trust anchor. This design needs no additional
tools commit T or placeholder reference. A changed script or bundle requires new
pins and review; the job must fail rather than accept unknown hashes.

## Toolchain and tests

Node portable 22.23.4, Actionlint 1.7.12, Prettier 3.9.10, organize-attributes
1.0.0, sort-imports 6.0.2 and `yaml` 2.9.0 (ISC, existing lockfile dependency)
are bundled. ShellCheck, Python/PyYAML and all shared C/C++ libraries are omitted.
Actionlint retains its schema/expression/dependency checks; optional external
ShellCheck/Pyflakes discovery is explicitly disabled in hosted qualification.
ShellCheck remains an optional developer-installed check on the open local path.
No runtime download, package installation or setup-node action is used.
Node uses the pinned Ubuntu 24.04 platform glibc/C++ ABI; those OS libraries are
not redistributed. This is a self-contained tool payload on an explicit platform,
not a complete OS image. See the runtime ABI report and final review limitations.

Task 05D-R4 accepts the exact Node archive after independent PGP verification:
exit 0, GOODSIG/VALIDSIG, fingerprint
`5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`, match to officially signed
SHASUMS256.txt and archive SHA-256
`1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce`.
The manifest explicitly identifies this as verification reported and accepted by
the user; raw PGP logs were not provided locally and are not fabricated.

Task 05D-R3 accepts only the exact SLSA-attested official Actionlint binary despite
its upstream `+dirty` / `vcs.modified=true` metadata. That exception is not general.
Full component provenance, license inventory and extraction procedure are in
`ci-tooling/README.md`, `manifest.json`, `inventory.json` and `licenses.json`.

The remote job requires 107 orchestrator tests from P, 174 HA tests from C and
3 independently hash-verified harness security tests from H. TAP counts must be
exact and failure/skipped/cancelled/todo counters zero. Pipefail preserves errors.
Static checks include both workflows, all three orchestrator modules, the harness
security module, all five P files for Prettier, and the harness YAML/test/document.
Baseline..P whitespace and clean checkouts are mandatory. Production registry
state is never written; HA checkout must remain entirely clean.

## Local evidence and limitations

Local qualification additionally denies socket syscalls through a kernel seccomp
filter and hides host `/usr/share/nodejs` with Bubblewrap. The original distribution
Node 22.22.1 was rejected because it read absolute host builtin paths; the portable
22.23.4 alternative passed this isolation. Both are Linux AMD64 tests; no ARM64
runtime qualification of the tooling is claimed.

The GitHub job has no network-dependent provisioning, but normal checkout access
requires GitHub connectivity. Kernel-enforced network isolation is the local
qualification evidence; no outbound-network firewall is claimed for hosted jobs.
Actual hosted-runner qualification remains pending. The licensing inventory records actual redistributed components, full notices and
applicable obligations. No copyleft OS runtime or ShellCheck is conveyed.
Actionlint's embedded Go modules and standard library have their own retained
licenses. Javascript-natural-sort's upstream MIT declaration/author header and
standard MIT permission terms are preserved together; no year is fabricated.
The open local path is documented in `ghostfolio-ng-ha-local-qualification.md`;
it is developer-installed validation and is not immutable hosted CI qualification.

## Exact future qualification procedure

1. Review this complete local diff, Node R4 / Actionlint R3 evidence, inventory,
   archive hash and all workflow pins. Independently confirm hash verification
   precedes execution and no publication capability exists.
2. Separately authorize one harness commit H and a nonforced push only to
   `test/ghostfolio-ng-ha-orchestrator-ci`. Record full local and remote H.
3. That branch push starts this dedicated workflow. Do not use dispatch and do
   not invoke the production orchestrator for validation.
4. Record run/job IDs, attempt, runner image, H/P/C checkout SHAs, bundle/tool
   versions, exact 107 + 174 + 3 counts and all static step outcomes.
5. Compare main/HA/NG refs and registry read-only before/after. Generation 1,
   reserved 3.97.1 identity and existing candidate must be preserved.
6. Stop for human approval before main activation or any future release work.

No workflow has been published or run by the local validation task.
