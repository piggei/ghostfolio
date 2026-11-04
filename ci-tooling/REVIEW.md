# Task 05D-R5 — minimized hosted tools and open local qualification

Local review checkpoint reached; no commit/push/PR/tag/workflow/dispatch or publication.

## Final result

- Hosted bundle offline: **284 tests PASS**, no failures/skips/cancelled/todo.
- Open local installed-tool path: **284 tests PASS**, no failures/skips/cancelled/todo.
- Static validation PASS in both paths. No historical release result substituted.
- New single entry point: `./scripts/qualify-ha-orchestrator-local.sh`.
- Hosted runner pinned to `ubuntu-24.04`, contents:read only; P/C/H identity and
  all pre-execution hash/inventory protections preserved.
- This task changed no existing tracked production source or protected refs.
  A concurrent NG documentation commit is recorded below.

## Final immutable payload candidate

```json
{
  "archive_bytes": 38758636,
  "unpacked_bytes": 145253936,
  "payload_files": 1278,
  "bytes_by_component": {
    "actionlint": 6074530,
    "bin": 396,
    "licenses": 582252,
    "manifest.json": 38349,
    "prettier": 13630504,
    "provenance": 19832,
    "runtime": 124902584,
    "wrappers": 5489
  },
  "archive_sha256": "2cf360792e94f46da9f535340d9d9f2aace5ecc76b7aaaefb9fd1d418f992853",
  "inventory_sha256": "3895a4c333a6b2bca1e5c3370c9af5b5ff17393e3e70d5f7bb022301358279c5"
}
```

R4 compressed payload: 49,917,388 bytes; R5: 38,758,636 bytes (**22.35% smaller**).
File count 1,715 to 1,278; raw bytes 194,690,776 to 145,253,936.
No ShellCheck, Python/PyYAML, glibc, libstdc++, libgcc or other shared-library files
are conveyed. Exact approved Node 22.23.4 / Actionlint 1.7.12 binaries unchanged.
JS tools retain Prettier 3.9.10, both plugins and 29 required runtime npm packages.
Parser yaml 2.9.0 is an existing lockfile dependency, ISC, no runtime dependencies;
no application dependency manifest or lockfile modified and no package installed.

## Runtime closure and isolation

Readelf: Node requires glibc 2.28, GLIBCXX_3.4.21, CXXABI_1.3.9, GCC_3.4;
DT_NEEDED includes only libdl/libstdc++/libm/libgcc_s/libpthread/libc/loader.
These are deliberately Ubuntu 24.04 platform prerequisites, not redistributed
files. Official Node BUILDING.md and Ubuntu package records were consulted;
Ubuntu 24.04 provides newer compatible ABI generations. This is static
compatibility evidence, NOT an actual Ubuntu 24.04 execution result.
No local Ubuntu 24.04 rootfs/image was available; no pull/download performed.
Actual Ubuntu 24.04 GitHub runner qualification remains pending by task boundary.

Final bundle runs hide host JS modules, installed npm packages, system Node,
Actionlint and ShellCheck. Kernel seccomp denies socket creation/connect/send calls.
Failed socket probe and poisoned host module prefix are recorded. Only documented
OS libraries remain available. Local Python/Bubblewrap are test drivers only;
all qualification YAML/inventory/format/test execution uses bundled Node/Actionlint.
The developer entry point requires no Python or downloaded bundle at all.

## Licensing/provenance assessment

44 component rows with exact versions, SPDX expressions, source/provenance, digest
scope, notices and obligations; 50 notice files. Full per-file SHA-256 inventory.
R3 exact Actionlint dirty-metadata exception and R4 accepted Node PGP evidence retained.
The exact binaries are unchanged. Go standard runtime and all 11 embedded Go
modules now have explicit license entries and tagged upstream license/NOTICE texts,
including go-yaml's Apache-2.0 AND MIT license/NOTICE/permission terms. Only legal text was retrieved, not new tools,
packages or executable archives. Builder subsequently works from these local inputs.

MIT/ISC/BSD/Apache grants and their conditions are evaluated against conveyed bytes;
unknown package grants are rejected. Node aggregate LicenseRef preserves all
upstream embedded notices; it is not falsely labeled as only MIT. GPL terms for
ICU configuration helpers remain in the upstream notice, but those helper program
files are not shipped. Omitted OS/ShellCheck copyleft executables are not replaced
with inadequate copyright-only/source-offer claims.

New qualification helper MIT scope is a concrete local proposal in LICENSE-SCOPE.md
and needs human approval before commit/publication; no existing project code is
relicensed. Plain preferred wrapper source and license/scope ship together.
Natural-sort's explicit upstream MIT declaration and author header remain intact,
with standard MIT terms supplied separately; no copyright year is fabricated.
This disclosed grant interpretation and the proposed new-code scope are review
items, not a blanket certification of all ownership/patent/trademark questions.
See LICENSING.md and licenses.json for the detailed obligations and primary sources.

## Open local path and report behavior

Documentation: docs/ci/ghostfolio-ng-ha-local-qualification.md, including manual
Ubuntu/Debian setup, user-owned npm prefix, trusted Node/Actionlint acquisition,
other Linux/architecture guidance, optional ShellCheck, and no automated installs.
Node 22.x with required test flag and exact versions of all required JS/static tools
are checked explicitly. Fully materialized non-promisor clones are required and
lazy fetching is disabled, so missing source objects cannot trigger network provisioning. P/C are archived from exact existing local Git objects into
temporary snapshots; current worktree changes cannot substitute their test source.

Actual final local execution: Node 22.23.4, Actionlint 1.7.12, Prettier 3.9.10,
plugins 1.0.0/6.0.2, yaml 2.9.0; optional installed ShellCheck 0.11.0 PASS.
Mode is always OPEN_LOCAL, explicitly not immutable hosted qualification.
Exit 0 SUCCESS, exit 2 missing/incompatible prerequisite, exit 1 failed tests/checks.
Negative tests exercised missing Actionlint and an intentionally failing temporary
P test fixture, with correct report status/failed_check. Real Git objects/refs and
source files were not altered. These fixture results are not counted as successful
qualification or substituted for the real 284-test pass.

## Validation and negative cases

Bundle rebuilt twice to identical final archive SHA-256. Payload verifier checks
exact file sets, safe paths, digests, sizes and executable flags using JS.
Missing/corrupt files, extra files, symlink, changed executable bit, unsafe/duplicate
inventory entry and malformed digest all rejected; restored inventory passes.
Actual final workflow hash segment replays reject altered archive/inventory/security
script and missing archive. YAML duplicate/malformed/missing inputs and formatting
failure/missing files all fail nonzero. No mandatory test skipped.
Actionlint, YAML unique keys, Prettier, Node/Python build-driver syntax, Bash syntax,
optional local ShellCheck and source whitespace checked. Unmodified raw upstream
legal/Go diagnostic text is preserved as evidence, not reformatted for whitespace.

## Security and preserved state

P `f6ea73ca1f28750abd3b061023cab6a4f3443638` and C
`bfaf9ff86325d3d6fb25c37785e854cc583077df` remain literal source identities.
H data uses server-selected immutable workflow_sha with actual SHA assertion;
literal archive/inventory/security-code hashes pass before any bundled code runs.
Inventory verification is now JS with equivalent strictness, no Python fallback.
Only branch push trigger, three credential-free checkouts, contents:read only,
no secrets inheritance or publication/release capability. All 284 hosted test
counts and zero skipped/failure/cancelled/todo assertions remain mandatory.

Protected local main/P/HA refs remain unchanged. During final review, NG advanced
concurrently from `649d61f90429483cac949c0c97c83d10c13f7c8e` to
`79b7cbe41db4830de907d36b7240621b75998a58`: 79b7cbe41 docs(distribution): identify Ghostfolio-NG enhanced distribution.
This task did not perform that commit or write the NG ref. Its previous baseline
therefore cannot be reported unchanged. No rollback or automatic baseline update
was attempted. P/C are still exact immutable qualification subjects. HA registry byte-identical to C:
generation 1, original reserved 3.97.1 identity and empty qualification/publication
maps. No recovery/allocation, image operation, remote write, system install or
other worktree edit performed. Global binaries unchanged.

## Next review and remaining risks

Approve the complete diff, helper-license proposal, disclosed natural-sort handling,
component obligations and hash pins. Then separately authorize the harness H commit
and branch-only nonforced push, collect real Ubuntu 24.04 run/job/H-P-C identities,
versions and 284 test/static outcomes. Do not use production dispatch as validation.
OS label security updates are not a frozen OS image; tooling payload is reproducible
on its documented ABI. Hosted image execution/performance remains untested here.
Stop before main activation or any production release. No commit is created by R5.

Suggested future commit: `test(distribution): qualify HA orchestrator with minimal offline tools`.

Final Git status (intended additions, empty staging; concurrent NG change above):

```text
## test/ghostfolio-ng-ha-orchestrator-ci
?? .github/workflows/ghostfolio-ng-ha-qualification.yml
?? ci-tooling/
?? docs/ci/
?? scripts/ghostfolio-ng-ha-qualification.test.mjs
?? scripts/qualify-ha-orchestrator-local.mjs
?? scripts/qualify-ha-orchestrator-local.sh
```
