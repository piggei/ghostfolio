# Ghostfolio-NG integrated guide: source traceability

## Scope and review baseline

The guide is researched against NG integration commit
`faf45da4e863420b5644ad453a1990e52f146d1a` (Ghostfolio 3.97.0).
Task 08 commit `08225d4f7517c1c324be8ba705ea64abeec132c4` is deliberately
not an ancestor of this feature branch. No version-display code is imported.

The implementation at this baseline is authoritative. PR descriptions were
read on 2026-11-05; the ten upstream contributions in
[docker/integrated-prs.json](../docker/integrated-prs.json) are integrated into NG
independently and were open upstream when inspected. An open upstream PR does
not mean that its feature is absent from NG. The related heads belong to
`piggei/ghostfolio`; a read-only search found no separate PRs targeting that fork.
No PR status or later head is used at runtime.

The page contains documentation only. No financial calculator, API endpoint,
database schema, release workflow, registry, permission or dependency is changed.
The additional API file is a regression test against the existing calculators.

## 1. Team and distribution

- **Implementation:** `apps/client/src/app/pages/about/ghostfolio-ng/chapters/team.chapter.html`.
- **Context:** NG branding commits `58efa36c5`, `469b0516a`; existing NG About
  section. Human/AI roles and the image were supplied and approved by PJ.
- **Verified instructions:** About → Ghostfolio-NG is an NG-only entry; the
  original About/Changelog/License/OSS navigation is preserved for standard builds.
- **Attribution:** links to the original project and independent fork; Codex and
  ChatGPT are explicitly AI assistants. No upstream endorsement is implied.
- **Image provenance:** original `Team NG.png`, 1535 × 1024, supplied from
  `C:/Users/PJ/Downloads/Team NG.png`. ImageMagick 7.1.2-18 converted it to WebP
  with `webp:lossless=true` and stripped metadata. Pixel comparison: zero different
  pixels. Aspect ratio and dimensions are unchanged. No generative editing.
- **Original PNG SHA-256:** `3582a44f0cfeebeeb7978be95cf4cbd5531f51c531aac77894e28aebb7914283`.
- **Web asset:** `apps/client/src/assets/images/ghostfolio-ng-team.webp`,
  1,581,220 bytes (original PNG 2,221,221 bytes).
  SHA-256: `b3eed9805218fcdb13240b8bf5056c1dcbd5289367e184543abae3a5bec25068`.
- **Limits:** the scene is an illustration, not evidence of human AI contributors.

## 2. Cash Management

- **PR:** [#8305](https://github.com/ghostfolio/ghostfolio/pull/8305), integrated
  by `a8bbfd48f`; later integration retained in `cd7838a4c`.
- **Sources:**
  - `apps/api/src/app/account-balance/cash-management.service.ts`: draft versus
    persisted state, `requireState`, `createEvent`, `updatePreferences`, `transfer`,
    CSV preview/import/export and restoration.
  - `apps/api/src/app/account-balance/cash-balance-calculator.ts`: ordered
    movements and absolute checkpoints.
  - `apps/api/src/services/activities/activities.service.ts`: cash-fee projections,
    cash positions and financial activity currency conversion.
  - `apps/client/src/app/components/cash-management/`: journal form, preferences,
    edit/delete/source navigation, preview, duplicate matching and confirmation.
  - `apps/client/src/app/components/account-detail-dialog/account-detail-dialog.html`:
    Cash Balances tab.
  - `apps/client/src/app/pages/accounts/transfer-balance/` and
    `libs/common/src/lib/dtos/transfer-balance.dto.ts`: actual transfer controls.
  - `apps/client/src/app/pages/resources/guides/resources-guides.component.html`:
    existing cash and CSV instructions, reused as corroboration.
- **User actions:** Accounts → account details → Cash Balances; positive deposit
  or withdrawal plus a separate fee; actual-balance reconciliation; transfer from
  Accounts; preview then confirm cash CSV. Account currency must be set.
- **Financial semantics:** deposits add amount less fee; withdrawals subtract
  amount plus fee; checkpoints replace the balance at their sequence. Linked
  financial cash effects already contain their costs. External cash movements
  change wealth, not investment profit. Base-currency cash is excluded from
  investment returns; foreign-currency cash can produce FX effects. Cash inclusion
  and automatic financial-activity cash updating are independent preferences.
- **Important boundary:** ROI/ROAI investment-only performance excludes standalone
  fees; cash fees still reduce wealth and count in fee totals. The regression
  contract demonstrates wealth gain 236 versus investment performance 238 after
  a 2-unit deposit fee. The manual deliberately does not equate these quantities.
- **Worked example:** 1000 − 2 − 100 − 1 = 897, checkpoint → 880, internal
  same-currency transfer 200 → 680 + 200 = 880. No investment gain is created.
- **Limits/discrepancies:** this baseline's transfer form has only From, To and
  Value. The service uses today's date and converts the destination at the
  available current exchange rate. There are **no independent source/destination
  fee inputs, historical date or custom received-amount input**. Transfer entries
  are paired and cannot be edited/deleted individually. This differs from a
  possible future transfer interface and is stated explicitly in the guide.
- **CSV:** required Date/Operation/Amount/Currency; optional Fee/Sequence/Note/
  Reference; UTF-8 comma/semicolon, decimal point, ISO dates, matching account
  currency, no FX conversion. Exact existing references skip; changed references
  conflict; ambiguous activity matches require a choice. Limits: 2 MB/5000 records
  including metadata. Activities must already exist; one transfer leg cannot
  recreate a new transfer. Preview/cancel is read-only and import is atomic.
- **Tests:** `cash-management.service.spec.ts`, `cash-ledger-csv.spec.ts`,
  `cash-management.integration.spec.ts`, `cash-balance-calculator.spec.ts`,
  `portfolio-calculator-cash-ledger-contract.spec.ts`, client cash-management tests.
  The PostgreSQL integration suite is a source reference, not claimed as executed
  by Task 09 unless separately reported.

## 3. Tax Management

- **PR:** [#8252](https://github.com/ghostfolio/ghostfolio/pull/8252), integrated
  as `4b78112bd`.
- **Sources:** activity dialog form/template, `activities.service.ts`,
  `cash-management.service.ts` (`orderAmount`), shared activity DTOs,
  `apps/api/src/app/portfolio/calculator/portfolio-calculator.ts` (monetary net
  performance), CSV import/export services.
- **User actions:** create/edit BUY, SELL, DIVIDEND or INTEREST in Activities;
  enter Tax as a monetary amount in the displayed activity currency; review the
  Tax column and correct the source activity. JSON and financial-activity CSV
  tax import are distinguished from cash CSV.
- **Semantics:** Economic interpretation is BUY gross + fee + tax and SELL/income gross − fee − tax.
  However, the integrated cash service `orderAmount` subtracts fee but omits tax,
  for both managed and legacy cash update paths. `synchronizeOrder` also omits tax
  from its unchanged-value comparison. This is a documented baseline limitation,
  not corrected here. The older ActivitiesService fallback deducts tax but is not
  the injected cash-service path. Date-specific currency conversion still applies.
  Monetary net investment performance deducts recorded taxes; omitted tax is zero.
- **Example:** gross dividend 100, tax 26, fee 0 → economic net receipt 74, but the
  current automatic cash amount is 100. The guide says to compare the statement
  and reconcile the verified balance, while retaining gross income and avoiding
  a second tax deduction. The actual amount routine is covered by a new test.
- **Verified limitation:** the integrated TWR `getPortfolioAdjustmentsByDate` and
  MWR `getActivityCashFlows` do not explicitly include `tax`. The new guide test
  confirms a 20-unit tax reduces monetary gain from 100 to 80 while those
  percentage results remain 10%. The guide recommends ROAI/ROI when reviewing
  returns net of recorded taxes. This task does not fix that business logic.
- **Tests:** `portfolio-calculator-tax.spec.ts`, activities/import/export CSV tax
  tests, `ng-guide-examples.spec.ts` (two percentage-limitation cases).
- **Limits:** no tax rates, jurisdiction engine, filing, or tax-return generation.
  A short professional-advice disclaimer is localized in the guide.

## 4. Profit and Loss Calendar

- **PR:** [#8158](https://github.com/ghostfolio/ghostfolio/pull/8158), integrated
  as `be8a1d1be`.
- **Sources:** `apps/client/src/app/components/portfolio-pnl-calendar/` (helper,
  component, template/styles); `home-overview/home-overview.html`;
  `apps/api/src/app/portfolio/portfolio.service.ts`, calendar percentage method.
- **User actions:** Home → Overview, outside Zen Mode; Daily/Weekly/Monthly/Last
  30 days; month/year arrows; amount/% toggle subject to visibility permissions.
  Weekly sums are clipped to the selected month and weeks start Monday.
- **Amounts:** consecutive calendar-date differences of cumulative
  `netPerformanceWithCurrencyEffect`. Missing multi-day intervals are not
  mislabelled as one-day PnL. Complete-period sums require observed elapsed days.
  A non-trading day is not automatically treated as zero; valuation/income/cost/FX
  data determine the observation.
- **Percentages:** independent ROAI recalculation for each requested period.
  `getCalendarPerformancePercentages` refuses other selected methods, even though TWR/MWR
  are implemented elsewhere. Cumulative percentage-point differences in the
  helper are not presented as daily ROI. Period percentages cannot be summed.
- **Example:** cumulative 0,12,7,10 → +12,−5,+3 → total +10. Missing intermediate
  dates make the one-day assignment unavailable, not zero.
- **Tests:** calendar helper tests, `portfolio-calculator.calendar.spec.ts`,
  guide rendering/limitations tests.
- **Limits:** missing observations, restricted/hidden values and non-ROAI
  percentage mode can produce a dash; monetary PnL is not total wealth change.

## 5. Financial Performance and Returns

- **PRs:** [#8211](https://github.com/ghostfolio/ghostfolio/pull/8211),
  [#8220](https://github.com/ghostfolio/ghostfolio/pull/8220),
  [#8221](https://github.com/ghostfolio/ghostfolio/pull/8221),
  [#8233](https://github.com/ghostfolio/ghostfolio/pull/8233),
  [#8288](https://github.com/ghostfolio/ghostfolio/pull/8288).
  Local selector extension `b9e12e3e0` enables TWR/MWR options absent in the
  calculation-only upstream proposals. Calendar-day integration `9ab058dbb`.
- **Sources:** `apps/api/src/app/portfolio/calculator/{roi,roai,twr,mwr}/`, base
  calculator, `roai/accounting-days.ts`, user-account-settings template,
  `apps/api/src/app/endpoints/benchmarks/benchmarks.service.ts`, benchmark comparator.
- **Controls:** Settings → Experimental Features → Performance Calculation,
  subject to settings permissions and impersonation restrictions. Analysis
  benchmark comparator uses available configured benchmark profiles.
- **ROI:** net monetary gain / invested capital. Portfolio denominator accumulates
  positive net invested-cost changes, keeps sold capital counted, and includes
  hidden same-day peak adjustments. Holding denominator uses its buy amounts.
  Date ranges start from opening market value. Base-currency cash is excluded.
- **ROAI:** whole-history holding averages use elapsed accounting-day intervals
  between investment events and terminal valuation. Date-range recalculation uses
  daily weights, includes the final day, and adds opening unrealized gain to
  opening cost. The two paths can legitimately show different denominators.
  The guide describes this distinction, not an assumed universal inclusive-day
  formula. DST handling is calendar based; same-day activity semantics remain.
- **TWR:** geometrically linked daily factors with investment cash flows removed
  and income/fee adjustments included. Native output is cumulative, not annualized.
- **MWR:** dated investor-perspective flows plus terminal value, XIRR with actual
  calendar days/365. Native output is annualized, including for short periods.
  Same-day flows aggregate. The deterministic solver can return zero with no root
  or insufficient dated flows, and multiple roots are possible.
- **Benchmarks:** price change from the first available comparison price with
  relative FX adjustment; no matching of the investor's contribution schedule,
  fees/taxes or separate dividend reinvestment. It does not become an MWR merely
  because MWR is selected. Price-series adjustments depend on the data provider.
- **Numerical evidence:** new `ng-guide-examples.spec.ts` executes the real
  calculators, not a reimplementation:
  1. 1000 → 1100 over 365 days, no flows/costs/FX: all four methods 10%.
  2. Invest 1000 day 1 and 1000 day 3, end 2100 day 4: ROI 5%; whole-history
     average 1333.33 gives ROAI 7.5%; selected-range average 1500 gives 6.6667%.
  3. Two 365-day periods, +20% then −10%, add 1000 between: finish 1980;
     cumulative TWR +8%, annualized MWR approximately −0.66815477%. TWR's
     annualized equivalent is about +3.92%, shown only as an explanatory comparison.
  4. Tax limitation described above is explicitly reproduced for TWR and MWR.
- **Tests:** eleven new guide cases; existing TWR/MWR suites, ROI same-day cases,
  ROAI cash/tax/calendar/accounting-day/remaining-cost regressions.
- **Limits:** experimental selection, incomplete prices, foreign-currency context,
  method-specific cash/fee/tax boundaries; compare identical range/scope/basis.

## 6. Other improvements

- **Portfolio JSON restore:** #8305, portfolio-restore dialog, import services and
  existing Resources guide. Steps cover private Export Data, account mapping,
  preview, both transfer accounts and atomic confirmation. Empty/compatible
  destination rules and legacy-account preservation are explicit. Credentials
  and server configuration are not transferred. Missing shared MANUAL metadata
  remains an upstream export limitation.
- **Remaining average cost:** #8211 / `52c71e73d`, base holding valuation and
  `roai/portfolio-calculator-average-cost-after-partial-sell.spec.ts`. Example
  10@100, sell5@110, buy5@200, sell10@210 → realized gross gain 650. This is a
  tracking calculation, not a jurisdiction-specific fiscal cost-basis choice.
- **Same-day ROI capital:** #8220 / `721939767`, ROI calculator and same-day tests.
  Capital reused from 1000 to 1100 on one day counts 1100, not 2100 or zero.
- **Fee names:** [#8315](https://github.com/ghostfolio/ghostfolio/pull/8315),
  `8596fc710`, ActivitiesService update path and fee-rename tests. Editing a
  standalone fee name protects shared/admin profiles and does not change its amount.
- **Excluded:** Italian localization as a feature, release tooling/CI, unimplemented
  asset classifications and speculative tax/transfer functionality. #8366 background
  refresh handling and the local FX-cache-context patch were inspected as integrated
  infrastructure; no separate end-user controls are invented for them.

## Navigation, localization and verification

- One lazily loaded page with six focused chapter templates/components, a chapter
  index and return anchors. Uses existing RouterLink and anchor scrolling.
- `canMatch` strictly requires `isGhostfolioNg === true`; direct standard-build
  access is rejected. The parent AuthGuard remains unchanged.
- The About tab is inserted only for NG. A book icon distinguishes it on mobile.
  The shared tab anchor receives its existing label as `aria-label` because the
  visual label is hidden on mobile; no routing or visibility logic is changed.
- Existing typography/Bootstrap grids, a one-column mobile/two-column desktop
  index, responsive lossless image, scrollable CSV sample and focusable chapter
  anchors. No new UI dependencies or runtime GitHub calls.
- English source and complete Italian XLIFF targets with stable `ngGuide*` IDs.
  Other languages use the established English fallback. Italian control names
  follow the checked-in UI catalog rather than replacing its existing translations.
- Guide tests cover route gating, standard/NG tab inventories, accessible mobile
  labels, chapter order, fragments, image attributes, attribution links and limits.
  Node tests verify all guide message coverage, Angular XLIFF parsing, exact image
  hash and responsive CSS invariants. These are not real-device browser tests.

Local commands (existing dependencies, Node 22.x):

```sh
node --test --experimental-test-isolation=none scripts/ghostfolio-ng-guide.test.mjs
node node_modules/jest/bin/jest.js --config apps/client/jest.config.ts --runInBand \
  --runTestsByPath apps/client/src/app/pages/about/ghostfolio-ng/ghostfolio-ng-page.component.spec.ts \
  apps/client/src/app/pages/about/overview/about-overview-page.component.spec.ts
ACCESS_TOKEN_SALT=local-test JWT_SECRET_KEY=local-test \
  node node_modules/jest/bin/jest.js --config apps/api/jest.config.ts --runInBand \
  --runTestsByPath apps/api/src/app/portfolio/calculator/ng-guide-examples.spec.ts
```

Production client compilation, TypeScript, project-aware ESLint, formatting,
full-catalog XML/ID checks and Git whitespace checks are recorded in the delivery
report. No browser/device execution, PostgreSQL integration run or remote CI is
implied by static/DOM tests.
