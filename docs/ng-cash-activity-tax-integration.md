# NG activity taxes and cash integration

## Scope and baseline

Task 11 is based on `96f2ade252a3237892c74474edf43c8bd2785db4` from
`integration/ghostfolio-all-pr`. It integrates the existing activity Tax field
with the Unified Cash Ledger. It does not change the original feature branches,
financial return definitions, schema, migrations, permissions or release workflows.

## Root cause and correction

`CashManagementService.orderAmount` calculated signed gross less fee, omitting tax.
It supplies both managed-account linked movements and automatic legacy-account
cash updates. The old ActivitiesService fallback already subtracted tax.

The same service's unchanged-value shortcut compared account, currency, date,
fee, quantity, type and unit price but omitted tax. A tax-only edit therefore kept
its previous cash amount. The correction includes normalized tax in this check.
Missing/null tax is zero for amount calculation and equality comparisons.

The centralized calculation now remains entirely in Big.js until the existing FX
boundary: BUY is `−quantity × unitPrice − fee − tax`; SELL/DIVIDEND/INTEREST are
`quantity × unitPrice − fee − tax`. FEE sign handling remains unchanged; ordinary
fee-only activities with zero tax keep their existing behavior. The combined net
amount uses the existing dated activity-currency to account-currency conversion
and existing precision normalization. There is no separate tax event or deduction.

The activity's gross value, fee and tax fields are not rewritten. Updates preserve
the linked event identity; repeated updates do not compound taxes. Deletion removes
the whole linked event. Existing account locks, transaction scope, overdraft
confirmation, revisions, sequence ordering and absolute reconciliations remain.

Both CreateOrderDto and UpdateOrderDto currently require tax >= 0. Tax credits or
negative taxes are not newly supported. The helper tolerates null/missing values
as zero; persistence and DTO contracts are otherwise unchanged (database Tax is
non-null with a zero default).

## Historical records

CashEvent values are materialized, not derived afresh during reads. No migration,
startup repair, bulk resynchronization or automatic reconciliation is introduced.

- Reads and a comment-only edit preserve an old linked cash amount, even if it
  predates the tax fix. Normalized zero tax does not force an unnecessary rewrite.
- A supported financial edit (tax, fee, quantity, unit price, type, account,
  currency or date) recalculates that activity's linked cash amount once.
- Later absolute reconciliations remain absolute. Review any separate manual tax
  corrections before financially editing historical activities to avoid duplication.
- Legacy accounts are not activated by this change. New automatic legacy cash
  updates use net amounts. The existing no-linked-ledger edit/delete behavior for
  legacy history is preserved; no historical balance repair is inferred.

An optional future historical repair requires **separate approval**. A safe design
would preview old/new values, affected dates and balances, later reconciliations
and possible manual compensations; retain an export and before-state audit;
require account ownership, locks and an unchanged revision/content fingerprint;
apply one atomic, explicitly confirmed change set; and treat a repeated operation
as a no-op. Rollback must compare the post-state and refuse to overwrite intervening
writes. Previously lost tax metadata requires the original trusted backup or user
confirmation, not reconstruction from cash differences. None of this is implemented.

## Imports, exports and restoration

No file format is changed.

- Activity CSV/ordinary JSON activity import already passes tax and disables
  automatic cash updating. This remains explicit: importing activities first must
  not create cash effects that a separate journal import would duplicate.
- Activity export already includes tax. The complete JSON restore previously
  dropped it during `order.create`, and its duplicate matching ignored tax.
  Task 11 preserves `tax ?? 0` and compares normalized tax. An existing activity
  with a different tax is not silently reused or overwritten.
- Complete JSON restore stores the supplied materialized cash amounts unchanged,
  remapping their activity links. Corrected net journals are not taxed again;
  historical gross-only journals also keep their historical values. Re-export/
  restore does not repair them or lose their recorded activity tax.
- Cash CSV new linked rows must match the current net amount, with the existing
  amount tolerance and all account/currency/date/activity matching checks.
- An identical row already persisted in the destination is an idempotent retry,
  including a historical gross-only amount. Equality of date, type, amount, fee,
  linked order, note, transfer reference and applicable sequence is checked before
  applying the current formula to a **new** row. Changed existing rows still
  conflict. No alternative gross-only formula is accepted for new imports.
- A pre-fix linked cash CSV cannot recreate an inconsistent gross-only row in a
  fresh journal. Use complete JSON restore to preserve that historical journal;
  do not edit the CSV amount as an undocumented historical repair.

## Guide translations

Only `ngGuideTaxCash`, `ngGuideTaxExample` and `ngGuideCashCsvLimits` change.
English and Italian describe the corrected behavior and the historical policy.
The existing CA, DE, ES, FR, NL, PL, PT and TR translations of these three messages
are explicitly marked `needs-translation` and display the updated English source
as a safe fallback. Their previous, now false tax warning is removed. These 24
localized targets require human translation review. Other messages and locales
are preserved; TWR/MWR tax-percentage limitations are deliberately unchanged.

## Validation

The delivery report records exact executed commands and current results.
New unit tests use the real cash service/calculator with a mocked persistence
boundary. PostgreSQL tests use an isolated migrated `cash_test_` database and real
ActivitiesService create/update/delete paths, with only external market/FX services
stubbed. They cover all four accounting examples, fee-only and zero/missing tax,
precision, dated FX, preference overrides, repetitions, deletion, moves, ordering,
reconciliations, rollback, historical values, CSV retries and JSON restore.
The original negative-tax DTO validation is also checked.

Representative commands with existing dependencies and Node 22.x:

```sh
ACCESS_TOKEN_SALT=local-test JWT_SECRET_KEY=local-test \
  node node_modules/jest/bin/jest.js --config apps/api/jest.config.ts --runInBand \
  --runTestsByPath apps/api/src/app/account-balance/cash-management.service.spec.ts
CASH_TEST_DATABASE_URL=postgresql://USER:PASS@127.0.0.1:PORT/cash_test_task11 \
  node scripts/test-cash-postgres.mjs
node --test --experimental-test-isolation=none scripts/ghostfolio-ng-guide.test.mjs
```

No production database, existing development database, remote registry, GHCR image
or GitHub workflow is used by these tests. No dependency installation is required.
