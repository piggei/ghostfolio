# Proposed license scope for newly authored qualification code

For this local review, `ci-tooling/LICENSE` proposes MIT terms only for the new,
independently authored qualification helpers created in Tasks 05C–05D-R5:

- `ci-tooling/build-local.py`, `finalize-review.py`, `qualify-local.py`, `offline-run.py`.
- `ci-tooling/verify-and-extract.sh` and `ci-tooling/source/bin/*`.
- `ci-tooling/source/wrappers/*.mjs`.
- `scripts/qualify-ha-orchestrator-local.sh` and `.mjs`.
- `scripts/ghostfolio-ng-ha-qualification.test.mjs`.
- `.github/workflows/ghostfolio-ng-ha-qualification.yml`.

The human review checkpoint includes approval of this new-code license scope
before any commit/publication. No existing tracked project code or project-wide
license is changed. P/C source remains under its original project license.

Third-party archives, binaries, npm modules, provenance materials, licenses and
NOTICE files are expressly excluded from this new-code grant. Their original
licenses and notices govern them. A copy of the proposed MIT license accompanies
the authored runtime wrappers in the payload; their preferred source is the
unmodified readable `.mjs` / `.sh` files included there.
