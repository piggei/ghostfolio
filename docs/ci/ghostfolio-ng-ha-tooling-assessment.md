# Task 05D: offline tool provenance assessment

Historical assessment, superseded by Tasks 05D-R3, 05D-R4 and 05D-R5. The official
Actionlint archive was checksum-verified and SLSA-attested; the user accepted the
exact official binary despite upstream dirty metadata. Node archive provenance
was independently PGP-verified and accepted by the user in R4. The offline bundle
and harness integration are now locally qualified; see
[current review](../../ci-tooling/REVIEW.md). Historical blocked status below
records the earlier checkpoint and is not the current integration status.

## Result: blocked before bundle creation

The existing harness branch remains based on P
`f6ea73ca1f28750abd3b061023cab6a4f3443638`. No Task 05C file was
changed. No tools were installed or downloaded, and no binary bundle was copied.
The harness's explicit BLOCKED gate remains in place.

## Verified local sources

| Component                 | Local version/source                                            | Assessment                                                                                                                  |
| ------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Node                      | `/usr/bin/node`, 22.22.1                                        | Distribution build, dynamically linked to libnode and numerous libraries; copying this binary alone is insufficient         |
| Node portable alternative | `~/.nvm/versions/node/v22.23.4`, cached upstream-format archive | Potential compatible revision; not substituted, qualification and archive provenance verification still required            |
| Actionlint                | `/usr/local/bin/actionlint`, reports 1.7.12                     | Provenance blocker described below                                                                                          |
| Prettier                  | 3.9.10, existing localization node_modules                      | Lockfile contains resolved URL and SHA-512 integrity; installed tree not independently authenticated against cached archive |
| organize-attributes       | 1.0.0, same node_modules                                        | MIT, lockfile integrity present                                                                                             |
| sort-imports              | 6.0.2, same node_modules                                        | Apache-2.0; runtime dependency closure still requires verification                                                          |
| PyYAML                    | 6.0.3, `/usr/lib/python3/dist-packages/yaml`                    | Distribution package 6.0.3-1build1; Python runtime also required                                                            |
| Python                    | 3.14.4, `/usr/bin/python3`                                      | Distribution runtime, dynamically linked; not independently portable                                                        |

Prettier/plugins live in an unrelated worktree and were only read. That worktree
was not modified. Lockfile integrity records describe expected archives; they do
not prove that the current installed trees match those archives.

## Actionlint evidence

`go version -m /usr/local/bin/actionlint` reports:

- Module: `github.com/rhysd/actionlint v1.7.12+dirty`.
- `vcs.modified=true`.
- VCS revision: `914e7df21a07ef503a81201c76d2b11c789d3fca`.
- Go 1.26.1; Linux AMD64; CGO disabled; statically linked executable.
- Embedded installation description says downloaded from release page.

Local binary SHA-256:
`c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4`.

No official archive/checksum or locally verifiable clean source was found in the
examined caches/locations. This does not prove malicious modification or that an
official release could not have these build flags. It does mean the embedded
version/installation strings alone are insufficient to authenticate provenance.
Hashing the same binary establishes an inventory identity, not upstream trust.

Under Task 05D's explicit requirement to report unverifiable local sources rather
than improvise, this blocks approval of the bundle. No fallback version is used.

## Portability and license work still required

Host glibc is 2.43. Distribution Node and Python cannot be presumed compatible
with GitHub's ubuntu-latest. A future bundle must include compatible runtimes,
shared-library/loader closure and Python standard library, or a separately
verified portable distribution. The available portable Node binary is about
120 MiB before compression: repository file limits and archive layout need review.

The sort-imports direct dependencies are Babel generator/parser/traverse/types,
javascript-natural-sort, lodash-es, minimatch and parse-imports-exports. Transitive
runtime dependencies and their licenses must be inventoried before copying.
Prettier and organize-attributes report MIT; sort-imports reports Apache-2.0.
No complete redistribution/license inventory is claimed, and no partial binary
bundle is offered as redistributable. Distribution copyright records for Node
and PyYAML exist locally but do not resolve the whole closure.

## Checks performed and checks not performed

Local Node suites: 107 orchestrator, 174 HA and 3 harness-security tests.
Local source static checks can use the existing tools; their success is not
qualification of a bundled toolchain. See the task report for final results.

Not performed: bundle-only static checks, network-disabled wrapper qualification,
missing/corrupt bundle tests, full license/size inventory, inventory trust-anchor
integration or GitHub Actions qualification. There is no bundle, so these cannot
be reported as passing. No wrappers or inventories are fabricated to bypass the
provenance blocker. No bundle SHA-256 manifest or bundle size exists yet.

## Minimal future integration, after provenance is resolved

Keep literal P/C test-subject checkouts, sole contents:read permission, and no
production entry points. Add a separate checkout of the immutable harness/tool
revision H; its source must be an independently approved full SHA. An alternative
is the existing triggering harness revision verified against an approved external
SHA, but never execute arbitrary event-supplied source as a substitute for approval.

Before executing any bundled code, use a reviewed verifier and independent pinned
inventory digest to validate the exact file set, paths, sizes, executable modes
and SHA-256 values. Reject missing/extra/corrupt files and unsafe links. Do not
trust SHA256SUMS solely because it arrived with the bundle. The inventory and
verifier require review before commit/publication; no self-referential H is assumed.

Use bundled Node for every test/syntax/Prettier invocation and bundled Python for
`yaml-unique.py`; run Actionlint from its verified bundle path. Keep repository
Prettier options, changing only plugin resolution to bundled verified entry
points. Replace the BLOCKED gate only in that reviewed diff, then qualify offline
and rerun all 284 tests. No such workflow change has been made in this task.

## Required next checkpoint

Supply a locally available Actionlint 1.7.12 archive/source with independently
verifiable provenance and license, or explicitly authorize a separate acquisition
and verification task. Task 05D does not authorize that acquisition. Then finish
runtime/package closure verification, bundling, licensing, offline tests and
integration review before any commit or push. Production state remains untouched.
