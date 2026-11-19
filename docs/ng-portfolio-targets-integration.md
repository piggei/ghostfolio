# Portfolio Targets in Ghostfolio-NG

## Provenance

Integrated from [upstream PR #8458](https://github.com/ghostfolio/ghostfolio/pull/8458),
source branch `feat/portfolio-targets-v1` at `1f7e7bc1ab911eb36d8cd47c47ca3de0d4ff9993`.
NG baseline: `84676134dd1d1991329571288b4266694534f6ea`. Only the feature changes are imported; upstream
dependency/Prisma upgrades from the source branch are not included.

## Usage

Open **Portfolio → Targets**, between Allocations and FIRE. Choose one of five
editable presets or a custom allocation, adjust the allowed deviation and save.
The saved configuration is global. Selecting an account changes the comparison,
not the saved target. Portfolio value, total/max drift, allocation chart and
per-class statuses use the same eligible portfolio/account selection.

## NG compatibility

- Permanently excluded accounts remain excluded.
- `summary.accountCashInBaseCurrency` exposes the already calculated eligible
  cash from `AccountService.getCashDetails()`. In NG this excludes cash hidden by
  `includeCashInPortfolio: false`, even though the existing `summary.cash` can
  still report that recorded balance. No new queries or FX conversions are added.
- The calculator uses NG's existing per-account `cashValueInBaseCurrency` when
  determining negative cash exposure. A hidden negative native balance does not
  make otherwise eligible long-only securities unsupported. An included negative
  cash exposure remains unsupported. Older fixtures without the projection keep
  the upstream balance-based behavior; provided invalid projections are unavailable.
- Hidden cash-only accounts contribute no allocation value. Securities in those
  accounts remain included. Synthetic cash and separately valued CASH instruments
  keep the upstream distinction, so account cash is never counted twice.
- Cash Management, taxes, portfolio restoration, performance formulas and cached
  FX context are retained. No schema or database migration is introduced.
- The new independent summary cash and NG's account/platform cash projections are
  covered by monetary-value redaction. Subscription/impersonation restrictions
  continue to mask the summary and prevent restricted allocation comparisons.
- NG's existing translations take precedence on shared messages. New Targets
  units are imported into all 14 catalogs; NG guide and Cash Management units
  are preserved.

## Numerical and functional boundaries

Independent cash avoids emergency-fund cancellation. Separate rounding budgets
remain for holdings, snapshot totals, accounts and cash; no fixed monetary
threshold or financial rounding is added. Missing independent cash is unavailable,
without fallback to adjusted summary fields. Negative included exposures are valid
financial scenarios but unsupported by this long-only v1.

Differing FX dates, stale snapshots and intervening balance updates can still
produce a non-ready result. Aggregate comparisons cannot prove completeness below
floating-point precision or detect all compensating omissions. Targets is analysis,
not trade execution, investment advice or automatic rebalancing.

## Verification scope

Regression coverage includes upstream Targets cases plus NG hidden positive and
negative cash, eligible securities/cash-only accounts, hidden-cash summary behavior,
account filtering and projection redaction. Validation results for this integration
are recorded separately from the source PR; source manual tests are not claimed as
manual tests of the integrated NG build.
