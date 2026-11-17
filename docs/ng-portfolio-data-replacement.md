# Portfolio data replacement

## Scope

Ghostfolio-NG adds **Replace Data** alongside the existing **Import Data**
operation in user settings.

Import Data restores accepted records without deleting the existing
portfolio. Replace Data instead removes the user's existing portfolio
accounts, financial activities and cash movements and reconstructs them
from a Ghostfolio JSON backup.

This is a Ghostfolio-NG feature developed independently in
[PR #10](https://github.com/piggei/ghostfolio/pull/10).
It is not part of the official upstream Ghostfolio release.

## Replacement procedure

1. Export the current portfolio before proceeding.
2. Open user settings and select Replace Data.
3. Select a Ghostfolio JSON backup.
4. Review the accounts, activities and cash movements scheduled for
   deletion and the data to be restored.
5. Explicitly acknowledge the permanent replacement and confirm.

Every source account must be recreated. Existing destination accounts
cannot be reused or excluded.

Preview performs no financial writes.

## Transactional guarantees

Replacement deletes and reconstructs the financial portfolio within
one database transaction.

Validation or reconstruction failure rolls back the operation,
preserving the previous portfolio.

Confirmation requires a matching preview digest. Relevant changes
to the destination financial state or import choices require a new preview.

## Preserved data

Replacement preserves:

- Personal settings and login credentials.
- Watchlist and configured benchmarks.
- Historical manual asset profiles and prices.

The operation does not repair information missing from an incomplete
backup.

Replacement is unavailable during impersonation or restricted view
and requires the appropriate account and activity permissions and scopes.

## Compatibility and documentation

The existing Import Data behavior remains unchanged.

The user guide documents both operations and includes translations
for all 13 supported non-English locales.

See the application's Resources > Guides section and
[Cash Ledger documentation](cash-ledger-csv.txt) for the complete
JSON restoration and cash-management behavior.

## Integration provenance

- Feature branch: `feat/ghostfolio-ng-replace-portfolio`
- Integration commit: `758a28bfba4b811ad1a0589ad0705b2fbe1b9338`
- Documentation and localization commit: `676e86070ed4cebea7643cc4e0b0742eb461d7db`

The feature was qualified together with the Ghostfolio-NG PostgreSQL CI
and baseline formatting fixes in the temporary qualification PR #13.
That PR is not intended for merge.
