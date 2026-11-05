# Ghostfolio-NG 3.98.0 candidate

## Scope and provenance

The candidate integrates the exact upstream `3.98.0` release
(`f3840ed29ae634c5f484529718975401ae940608`) into the existing
Ghostfolio-NG integration at `260b9674a`. It does not include the seven
post-release commits present on upstream main at inspection time.

Worktree: `/home/pj/repo/ghostfolio-398-candidate`.
Branch: `integration/ghostfolio-3.98-candidate`.
Remote destination: `fork` (`piggei/ghostfolio`).

The non-destructive merge completed without conflicts. The original main,
all-PR integration, and individual feature branches were left unchanged.
The release merge changes 55 upstream files; the additional candidate
workflow change enables the existing AMD64/ARM64 Docker build and runtime
smoke tests for this branch, with `push: false`. No image publication,
release, tag creation, or deployment is part of this update.

## Compatibility review

- Package and lockfile both report `3.98.0`; their contents match the upstream
  release exactly. Dependencies are installed with Node 22.23.4 and `npm ci`.
- No Prisma schema or migration changes relative to the NG integration. All
  existing migrations, including
  `20261029000000_removed_redundant_currency_from_order`, apply successfully
  to a fresh disposable PostgreSQL 15 database. No existing database was used.
- NG financial calculators, Cash Management, portfolio restore, tax linkage,
  and the snapshot cache code remain unchanged by the merge. Existing
  regression tests validate the integration with upstream changes.
- Automatically merged activities and allocations components preserve NG
  behavior and incorporate upstream mobile dialog sizing. API info retains
  NG build metadata; upstream security-token reset now removes auth devices.
- All 14 XLF catalogs parse as XML without duplicate IDs. All 266 NG-added
  entries per catalog retain their source and target content. The removed
  upstream pricing message is replaced by the new upstream pricing wording.
- Angular translation parser tests, NG guide tests, build metadata tests, and
  release tooling tests pass. Dockerfile and release publishing workflow
  remain unchanged.

## Validation

Logs and diagnostic inventory are saved outside the repository at
`/tmp/ghostfolio-398-validation/`.

| Check                                         | Result                                                        |
| --------------------------------------------- | ------------------------------------------------------------- |
| Lockfile installation                         | Passed (`npm ci`)                                             |
| Migration deployment to disposable PostgreSQL | Passed                                                        |
| Lint (API, client, common, UI)                | Passed, all four projects                                     |
| Prettier on changed supported files           | Passed; XLF checked separately                                |
| NG/distribution script tests                  | Passed, 158 tests                                             |
| Common library                                | Passed, 191 tests in 6 suites                                 |
| UI library                                    | Passed, 6 tests in 2 suites                                   |
| Client                                        | Passed, 61 tests in 5 suites                                  |
| Cash/restore gate, Europe/Rome                | Passed, 102 tests in 3 suites, no skips                       |
| Full API suite, UTC                           | Passed, 1,184 tests in 116 suites, no skips                   |
| Full production build                         | Passed: API, all 14 client locales, Storybook, build metadata |

Environment notes: an initial offline install lacked cached packages and
was replaced by a successful online lockfile install. Restricted local
process/socket access affected initial runs; the definitive script tests
and lint ran with the required local process access. The Nx formatting
wrapper failed, so changed supported files were checked directly with
Prettier; XLF content was validated separately. These attempts are not
reported as passing runs.

The UTC API JSON report confirms all 1,184 assertions passed, including
69 Cash Management, 23 portfolio restore, and 10 cash-ledger contract
assertions. Jest retained Redis connection handles after writing its
successful report; the verified test process was terminated after completion.
Its process exit is therefore not presented as a clean Jest exit.

## Limits

GUI interaction and full HTTP end-to-end export/preview/restore were not
performed locally. PostgreSQL integration tests exercise the real export
and restore services. AMD64/ARM64 container smoke tests are configured to
run after the candidate push; their results are not claimed here.
