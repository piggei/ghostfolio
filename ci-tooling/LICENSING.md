# Scoped redistribution assessment — 05D-R5 local review

## Decision and exclusions

The hosted payload is restricted to the approved unmodified Node and Actionlint
binaries, required npm runtime files, newly authored source wrappers and notices.
Python/PyYAML, ShellCheck and all redistributed OS shared libraries were removed.
The runner supplies its own glibc/C++ runtime; those OS packages are not conveyed
by this bundle. The standalone local path installs nothing and conveys no copy of
a developer's optional ShellCheck or system packages.

No claim of blanket legal certification is made. The review considers grants,
actual conveyed files, modifications, notices, source obligations and provenance.
Components with an unknown/unhandled package grant fail packaging instead of being
silently admitted. New helper MIT scope is a proposed license choice for the
human review checkpoint; no existing tracked project source is relicensed.

## Component inventory and obligations

`licenses.json` is the exact-version component inventory; `inventory.json` binds
all conveyed bytes. Digest scopes are explicit: raw executable SHA-256, npm archive
SHA-256/SHA-512 integrity, Go h1 directory SHA-256 or parent-binary coverage for
embedded code. A notice digest is not represented as an executable digest.

- **MIT** packages: retain original copyright, permission text and disclaimer.
- **ISC** (`yaml`): retain the copyright and permission notice.
- **BSD-3-Clause** Go components: reproduce conditions/disclaimer in accompanying
  materials and respect non-endorsement terms.
- **Apache-2.0** components: retain license and applicable notices; shipped NOTICE
  texts are included. Runtime source files are unmodified. The manifest records
  omission of non-runtime published tests/types/maps/docs, not a change to retained
  program files. Mark future source modifications and observe patent termination
  and trademark restrictions where applicable.
- **Node aggregate**: `MIT AND LicenseRef-Node-ThirdParty-Notices` refers to the
  complete unmodified upstream multi-component LICENSE, not a new license or a
  claim that Node's embedded components all use MIT. The exact Node release and
  available embedded runtime versions are recorded. GPL text in the ICU notices
  refers to configuration helper files and their additional permissions; those
  build/configuration files are not shipped as program files here. It is not a
  reason to discard required upstream notices or relicense the Node binary.
- **New helper source**: proposed MIT scope is explicit in `LICENSE-SCOPE.md`, with
  copyright/terms and readable preferred source in the payload. Approval of this
  choice is part of the pre-commit review.

Primary texts consulted: [MIT](https://spdx.org/licenses/MIT.html),
[ISC](https://spdx.org/licenses/ISC.html),
[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0),
[BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html), and the exact upstream
[Node 22.23.4 LICENSE](https://github.com/nodejs/node/blob/v22.23.4/LICENSE).
The actual copied license/NOTICE files and their hashes are the review evidence.

## Natural-sort 0.7.1 handling

The integrity-verified published archive explicitly declares `MIT` in package.json
and says in its source header that it is released under MIT, naming Jim Palmer
and the Dave Koelle algorithm attribution. These upstream notices are retained
verbatim. The archive has no standalone license text. Standard MIT permission
terms, taken from an already bundled MIT dependency's license text, accompany the
original notice under `licenses/npm/.../MIT-TERMS.txt`. No author/year was invented,
no upstream source was modified and no supplementary text is presented as a new
grant from the packager. The rights basis is the publisher's explicit MIT grant,
not the mere addition of a license file. This interpretation is disclosed for
human redistribution review, rather than hiding the upstream packaging limitation.

## Actionlint embedded components

The top-level MIT license alone was insufficient inventory for a statically linked
Go executable. Versioned upstream LICENSE/NOTICE texts for every module in the
binary's embedded module metadata and the Go 1.26.1 standard runtime are retained.
For go-yaml v4 the correct SPDX expression is `Apache-2.0 AND MIT`: upstream
NOTICE identifies ported internal/libyaml files under Kirill Simonov's MIT terms.
The Apache license, original NOTICE/copyright and standard MIT permission text
are all included. This mixed grant was reviewed rather than inferred solely from
the top-level Apache LICENSE. Only legal
texts were acquired, not module archives or executables. Each source URL, exact
module version, Go h1 identity and notice SHA-256 is recorded. These text snapshots
are independently reviewable inputs; they are not falsely described as SLSA build
attestations. The executable's unchanged bytes remain covered by the approved
Actionlint SLSA provenance and exact digest exception R3.

## Remaining review boundaries

This assessment does not determine rights to unrelated project assets, certify
third-party ownership, grant trademarks or waive patent conditions. Before public
redistribution, review the explicit helper-license proposal, the disclosed
natural-sort grant interpretation and all component obligations. No source offer
for omitted copyleft executables is invented as a substitute for meeting their
terms: those executable/library bytes are not in the payload. Local installation
instructions leave package choice and package-license responsibilities with the
developer; they do not change the hosted payload's scope.
