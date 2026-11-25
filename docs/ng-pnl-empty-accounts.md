# PnL calendar: empty accounts and first deposits

## Problem

Adding an included account without cash history made the entire portfolio NAV
unavailable. After its first deposit, the calendar only resumed the following day
because daily PnL needs both opening and closing NAV.

For managed accounts, daily-managed-cash-projection discarded the automatic zero
opening and began coverage at the first movement. For unmanaged accounts, the
persisted reader could not distinguish an entirely empty account from a legacy
account with incomplete history. composeDailyNav correctly rejected a missing
included balance; changing that safeguard would hide real data gaps.

## Correction

- A managed automatic zero opening remains part of the canonical balance
  projection, including days before the first movement and an empty ledger.
- An automatic ledger migrated from legacy checkpoints still starts at the first
  checkpoint. Explicit openings still do not provide balances before their date.
- For an unmanaged account, the reader checks counts of all activities and all
  stored balances in the same transaction, independently of the requested range.
  Only an account with neither may contribute zero. A past activity or future
  balance prevents that inference, even when the requested window contains no
  rows. Stored cash-management projection rows also prevent an inferred zero.
- No creation timestamp is used as a historical cutoff: imported accounts may
  have activities long before their database creation date.

The daily PnL formula, external-flow classification, historical FX checks, fees,
taxes, precision and missing-valuation safeguards are unchanged. A zero foreign
balance does not require a historical FX rate. A deposit classified as external
capital increases NAV and external flows by the same converted amount, without
increasing profit.

## Verification

The local test database was queried in forced read-only mode. The newly funded account was in EUR,
with an automatic zero opening and an EXTERNAL_CAPITAL deposit of EUR 200 on
2026-11-15. The production cash reader now returns zero on 2026-11-01 and
2026-11-14 and EUR 200 on 2026-11-15 and 2026-11-16, with no unavailable balance
in the requested November range. The pre-existing account also retains available
balances. The
production classification reader verifies the EUR 200 external flow on the 15th
and no external flows on the adjacent days.

Regression coverage includes empty managed/unmanaged accounts, the first deposit,
a zero foreign-currency account without FX, complete account history outside the
requested window, explicit openings and migrated checkpoints. Portfolio-level
tests compare PnL before and after adding an empty account or a new externally
funded account; PnL remains unchanged while NAV includes the deposit.

PostgreSQL qualification uses an isolated disposable cash_test_ database on port
5433, separate from the user's database on 5432. Schema deployment and test writes
are confined to that temporary database. No schema change, historical data repair,
production migration, push or deployment is part of this fix.

Validation on 2026-11-25:

- API TypeScript compilation passed.
- Full-project Nx regression passed for all four projects: API and client ran;
  common and UI used valid local cache entries.
- The initial targeted check passed 163 tests across seven suites; the subsequent
  complete API run also includes the additional zero-USD regression.
- Complete API regression: 196 suites passed, 12 skipped; 2,272 tests passed,
  180 skipped, 2,452 total. PostgreSQL-only tests require their separate gate.
- All five PostgreSQL gate suites passed without skips in UTC and Europe/Rome:
  143 tests per timezone. The disposable container and its data were removed.
- Existing development data was only read; no data repair or classification
  changes were made by the agent.
- Normal commit hooks check affected API lint and formatting. No hooks are bypassed.
- Browser/E2E tests and a Docker image build are outside this verification.
