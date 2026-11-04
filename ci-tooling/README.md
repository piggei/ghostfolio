# Minimal immutable qualification tooling — Task 05D-R5

This directory is the local review candidate for hosted CI tooling. The separate
open local entry point is `../scripts/qualify-ha-orchestrator-local.sh`; its setup
and result semantics are documented in
[local qualification](../docs/ci/ghostfolio-ng-ha-local-qualification.md).
Developer-installed validation is not equivalent to immutable hosted qualification.
No commit, push, workflow execution or publication has occurred.

## Hosted payload and platform contract

The only ELF executables conveyed are official Node **22.23.4** and Actionlint
**1.7.12**. JavaScript tools are Prettier **3.9.10**, organize-attributes **1.0.0**,
sort-imports **6.0.2**, and `yaml` **2.9.0** plus the full required runtime dependency
closure: 29 npm packages. `yaml` already exists in the repository lockfile, is ISC
licensed, and has no runtime dependencies. No application package manifest changed.

Python, PyYAML, ShellCheck, glibc, libstdc++, libgcc and all other shared libraries
are absent from the payload. The hosted runner is pinned to `ubuntu-24.04` AMD64.
OS shell/Git/tar/SHA-256 utilities and the OS C/C++ ABI are explicit platform
prerequisites, not redistributed tooling. Node needs glibc >=2.28,
GLIBCXX_3.4.21 and CXXABI_1.3.9. The local ABI audit records exact DT_NEEDED names;
the future actual Ubuntu 24.04 run remains to be performed. No local Ubuntu 24.04
rootfs was available and none was downloaded. A pinned OS label is not an
immutable OS image: the tool bytes are reproducible, OS security updates can vary.

This is a self-contained tool payload on that explicit platform, not a full OS.
No fallback to host Node, npm modules, YAML parser, Python or ShellCheck is allowed.
Actionlint explicitly disables optional host ShellCheck/Pyflakes discovery; its
workflow/schema/dependency/expression checks remain mandatory. Optional ShellCheck
is preserved on the independent open local route. No test was removed.

## Provenance and byte identities

`manifest.json` records exact tools, sources, accepted Node PGP verification R4,
the narrowly scoped Actionlint dirty-metadata exception R3, npm archive SHA-512
integrity from the existing lockfile, Go embedded module versions/directory hashes
and versioned notice sources. No dependency or executable was downloaded/installed
for R5; only additional upstream license/NOTICE texts were obtained for review.

Actionlint binary SHA-256:
`c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4`.
Node binary SHA-256:
`94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90`.
Both exact approved binaries are unmodified. The Node source archive was accepted
in R4 against its independently verified signed SHASUMS256.txt; raw PGP logs are
user-held, and are not represented as locally rerun verification.

`inventory.json` lists every payload path, size, executable status and SHA-256;
`SHA256SUMS` is its sorted text counterpart. The workflow independently pins the
archive, inventory and security test before running any bundled code. After
extraction, Node's `verify-inventory.mjs` rejects changed/missing/extra files,
symlinks, unsafe/duplicate paths, invalid digests and changed executable status.
No checksum file fetched beside unknown bytes is accepted as the trust anchor.

## Licensing assessment and proposal

See [LICENSING.md](LICENSING.md), `licenses.json` and `LICENSE-SCOPE.md`.
The inventory identifies exact version, SPDX expression, source/provenance,
SHA-256 with explicit digest scope, required notices and redistribution obligations.
Node's multiple embedded licenses are preserved in their complete upstream notice,
not mislabeled as a single MIT grant. Its runtime version metadata is recorded.
Actionlint's 11 Go dependencies and Go 1.26.1 runtime have separate notices,
including Apache NOTICE where supplied. No uncertain license was silently omitted.

The MIT scope for newly authored qualification helpers is a review proposal limited
to the listed new files. Existing project/third-party licenses are not changed.
The bundle carries readable helper source and its proposed license and scope.
The source header and publisher's explicit MIT declaration for natural-sort are
preserved together with standard MIT terms; those terms are not a fabricated grant
or invented attribution. Licensing is assessed against actual conveyed files and
obligations, not inferred merely from the presence of copyright files. Human
approval of the scope and normal redistribution review remain the checkpoint.

## Rebuild and local evidence

`build-local.py` repackages existing local verified sources only. It does not invoke
npm, install packages or contact the network. Missing inputs, mismatched integrity
or unknown package license fail. Tar ordering/ownership/modes/mtime and compression
settings are fixed; `finalize-review.py` updates review metadata and the extraction
helper's literal hashes. Do not regenerate hashes to approve unreviewed changes.

After independent review, run `verify-and-extract.sh NEW_DESTINATION`. That helper
checks archive/inventory hashes before extraction or execution. The workflow uses
the same ordering in its reviewed inline bootstrap, avoiding an unchecked helper.
`bin/node` clears host module/runtime overrides; all static code uses verified
payload paths. The Prettier wrapper reads the exact subject repository config and
pins both plugins, and the YAML wrapper uses `uniqueKeys: true` with file/location
errors. Both wrappers also support the explicitly selected local tool prefix;
that prefix is cleared by the bundled Node launcher in hosted mode.

`offline-run.py` and `qualify-local.py` are local test infrastructure using already
installed Python/Bubblewrap; they are not distributed runtime dependencies or
required by the developer entry point. They enforce socket denial in the kernel.
Final offline tests hide system JS modules, installed npm tools, system Node,
Actionlint and ShellCheck; only the documented OS ABI remains visible. Negative
integrity and no-host-prefix cases are recorded under `evidence/`.

## Workflow trust boundary

P/C source checkouts remain literal and logged. A sparse qualification-data checkout
uses immutable `github.workflow_sha` from the server-selected executing workflow H,
never an NG event-selected revision or moving ref. Its actual SHA is checked, and
three literal hash pins pass before extraction, inventory validation or execution.
The security script is separately hash-pinned. All 284 tests and static checks are
mandatory. Permissions remain only contents:read, branch-only push trigger,
no secrets inheritance, release entry point, reusable release call or publication.
Review the complete H diff/pins before separately authorizing its commit/push.
