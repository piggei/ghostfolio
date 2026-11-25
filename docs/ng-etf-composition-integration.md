# ETF Composition Integration in Ghostfolio-NG

## Architecture and audit

The audit at `f9516068c` found four fund-specific allowlists, fixed product
identifiers, empty-field-only replacement, and an ISIN resolver outside the
production enrichment flow. Data gathering did not carry saved ISINs into
enrichment and earlier enhancers could overwrite saved compositions.

The normal background asset-profile refresh now preserves ETF identities and
compares saved and incoming countries/sectors independently throughout the
enhancer chain. Non-ETF processing retains its existing behavior. Symbol-profile
matching includes both data source and symbol.

The four existing Nest enhancers keep their module registration and ordering;
Invesco and Amundi are appended after them.
Shared discovery, quality and date helpers sit beside the existing normalizer.
No database migration, portfolio calculation, release workflow or deployment
change is required.

## Identity and routing

An existing checksum-valid ISIN is used without a justETF lookup. Invalid existing
ISINs are preserved and enrichment stops. Missing ISINs first use the existing
justETF resolver: a unique candidate must have a verified canonical ISIN and
exchange listing. Canonical metadata must be unique and on the justETF origin.
An ambiguous primary resolution always stops enrichment.

For Vanguard Yahoo profiles without a stored ISIN, a NOT_FOUND or UNAVAILABLE
justETF result can fall back to the official Vanguard catalogue. Exactly one
equity ETF listing must publish the full requested RIC on the expected market;
its single ISIN must pass the shared checksum and verified-listing checks.
Duplicate listings, multiple matching products, incompatible fund types and
invalid identifiers are rejected. No fund-specific exceptions or ticker guesses
are used. The fallback supports .MI (ETFP/XMIL), .DE (XETR), .AS (XAMS) and .L
(XLON) only when the issuer publishes the exact requested RIC. The original
justETF provider still verifies .MI listings only; missing ISINs on other markets
remain unsupported for issuers without an official listing fallback. Amundi adds
the exact-RIC catalogue fallback documented below for .MI, .DE, .PA and .L.
Unverified identities preserve the
existing profile.

The instrument name routes to exactly one supported issuer; it is a hint, never
proof of product identity. Unknown or conflicting issuer names cause no issuer
requests. Names without an identifiable issuer are currently unsupported, even
when an ISIN is present. New tickers require no production configuration.

Discovery and identity results use a bounded, five-minute, process-local cache.
Fund discovery keys include issuer and verified ISIN; listing-resolution keys
include issuer, data source, exchange-qualified symbol and existing ISIN. Shared issuer
catalogues are cached separately. Failed discovery requests are not cached.
All requests have bounded timeouts and there are no automatic retry storms.

## Official discovery and data formats

| Issuer     | Discovery                                                                                     | Retrieval and identity evidence                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| iShares    | Official product search by ISIN, then UK product sitemap for the canonical product URL        | Active productIsin metadata must equal the requested ISIN. Product portfolio ID selects official CSV holdings; page and CSV dates must agree.        |
| Vanguard   | Portfolio IDs from the official home-page configuration, then GPX GraphQL profile identifiers | Exactly one portfolio must publish the requested ISIN. Existing cursor pagination retrieves holdings, with GICS or ICB industry classification.      |
| Xtrackers  | Official UK sitemap entry containing the exact ISIN                                           | Official PDP client route uses the discovered complete product identifier. Holdings must link to the requested fund's official constituent download. |
| WisdomTree | Official factsheet endpoint parameterized by verified ISIN                                    | PDF signature/content type and document ISIN are checked. Allocation page is found by heading, with multiline labels and variable category counts.   |
| Invesco    | Official DNG API addressed by verified ISIN                                                   | fundDetails proves ISIN and replication method; independently dated fund/index allocation responses echo the ISIN.                                   |
| Amundi     | Official ProductAPI addressed by verified ISIN, with exact-RIC catalogue fallback             | Unique product ID, ISIN, equity class, replication scope and scope-specific allocation date are checked.                                             |

Sources:
[iShares search](https://www.ishares.com/varnish-api/core-search/search/products),
[iShares sitemap](https://www.ishares.com/uk/product-sitemap.xml),
[Vanguard](https://www.ie.vanguard/home),
[Xtrackers sitemap](https://etf.deutsche-am.com/en-gb/sitemap.xml),
[WisdomTree cloud factsheet](https://dataspanapi.wisdomtree.com/pdr/documents/FACTSHEET/UCITS/EU/EN-GB/IE00BJGWQN72/),
[Invesco product](https://www.invesco.com/ie/en/financial-products/etfs/invesco-sp-500-ucits-etf-acc.html),
[Amundi product](https://www.amundietf.lu/en/individual/products/equity/amundi-core-stoxx-europe-600-ucits-etf-acc/lu0908500753).

Document dates must be valid, nonfuture and at most 75 days old. Vanguard pages
must retain the same effective date; known SEDOL identifiers cannot repeat.
Xtrackers uses the dated DWS source disclaimer. Unsupported/missing dates,
ambiguous products, malformed responses and unsupported PDF structures preserve
existing data with a warning describing the reason.

## Independent comparison and replacement

Each dimension is validated for finite nonnegative weights, recognized categories,
duplicates and total weight not exceeding 100% plus the existing tolerance.
`Other` does not count toward classified coverage. Entry count is not a quality
criterion; missing exposure is never redistributed.

Existing classified coverage of at least 95% is conservatively retained. Otherwise,
a valid issuer candidate must strictly increase classified coverage. The original
issuer minimum-coverage gates still apply (95% for holdings; WisdomTree countries
90%, sectors 95%). Countries and sectors can therefore improve independently.

The schema has no per-dimension source/date provenance. Consequently equally
complete distributions are preserved, rather than treating an alternative
classification or a newer request time as evidence of improvement. This is the
minimal backwards-compatible comparison strategy; it does not claim to refresh
an already-complete stored distribution based on an unknown document date.

## Qualification matrix

The opt-in live suite uses `UNCONFIGURED.MI` for every ISIN to demonstrate that
ticker lists do not control production support.

| Issuer     | Products tested                                 |
| ---------- | ----------------------------------------------- |
| iShares    | IE00B4L5Y983, IE00B5BMR087, IE00BKM4GZ66        |
| Vanguard   | IE00BK5BQT80, IE00B810Q511, IE00B3XXRP09        |
| Xtrackers  | IE00BTJRMP35, IE00BGV5VN51 (XAIX), IE00BJ0KDQ92 |
| WisdomTree | IE00BZ56SW52, IE00BDVPNG13, IE00BJGWQN72        |

Ordinary tests use mocked HTTP and allocation text fixtures extracted from
official WisdomTree PDFs on 2026-11-25. The fixtures retain only allocation rows,
identity and date. Live tests remain excluded from ordinary CI.

The live PDF harness runs native PDF.js in a child Node ESM process because Jest
otherwise rewrites the dynamic import to CommonJS. It then runs the production
allocation parser; this workaround does not modify the application parser.

## Remaining format boundaries

- Routing requires an unambiguous issuer name; the system does not probe every issuer for unknown names.
- Only profiles classified as equity ETFs use these composition enhancers; bonds, commodities and non-ETFs retain normal processing.
- Vanguard classification values outside the shared ontology remain unclassified.
- WisdomTree refuses ambiguous truncated consumer-sector labels and requires the supported allocation headings/table layout and one unambiguous allocation page. Different chart-only or factsheet layouts safely remain unsupported.
- Complete saved compositions lack source-specific freshness metadata and are retained conservatively.
- Issuer endpoint availability is external; successful qualification is evidence for the listed products, not universal coverage of every issuer instrument.

## Implementation files

- `apps/api/src/services/data-provider/data-enhancer/etf-composition/etf-composition.date.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/etf-composition.date.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/etf-composition.discovery.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/etf-composition.discovery.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/etf-composition.normalizer.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/etf-composition.quality.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/etf-composition.quality.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/generic.live.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/ishares/ishares.client.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/ishares/ishares.client.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/ishares/ishares.service.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/ishares/ishares.service.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/vanguard/__fixtures__/official-listings.json`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/vanguard/__fixtures__/vusa-justetf-profile.html`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/vanguard/vanguard.client.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/vanguard/vanguard.client.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/vanguard/vanguard.identity.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/vanguard/vanguard.parser.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/vanguard/vanguard.parser.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/vanguard/vanguard.service.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/vanguard/vanguard.service.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/wisdomtree/__fixtures__/IE00BDVPNG13.json`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/wisdomtree/__fixtures__/IE00BJGWQN72.json`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/wisdomtree/wisdomtree.client.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/wisdomtree/wisdomtree.client.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/wisdomtree/wisdomtree.parser.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/wisdomtree/wisdomtree.parser.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/wisdomtree/wisdomtree.pdf.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/wisdomtree/wisdomtree.service.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/wisdomtree/wisdomtree.service.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/xtrackers/xtrackers.service.spec.ts`
- `apps/api/src/services/data-provider/data-enhancer/etf-composition/xtrackers/xtrackers.service.ts`
- `apps/api/src/services/data-provider/isin-resolver/providers/justetf/justetf.provider.spec.ts`
- `apps/api/src/services/data-provider/isin-resolver/providers/justetf/justetf.provider.ts`
- `apps/api/src/services/queues/data-gathering/data-gathering.service.spec.ts`
- `apps/api/src/services/queues/data-gathering/data-gathering.service.ts`
- `docs/ng-etf-composition-integration.md`

## Initial qualification results

Qualification on 2026-11-25 used Node 22.23.5, bounded 2 GiB Node heaps and sequential execution.

- Targeted tests: 286 passed, 26 suites, including real resolver/discovery wiring and non-ETF behavior preservation.
- API TypeScript: passed with no errors.
- Scoped typed ESLint: 0 errors, 382 warnings across the inspected source and tests.
- Official live qualification on final provider code: 12/12 passed.
- Full-project regression: all four projects passed. API executed; client, common and UI used valid Nx cache entries.
  - Test Suites: 12 skipped, 194 passed, 194 of 206 total
  - Tests: 178 skipped, 2189 passed, 2367 total
- Nx formatting and normal pre-commit checks (affected API lint with zero errors and uncommitted format check) pass for the local commits; no hooks are bypassed.
- No separate historical baseline, Docker build, migration, push or deployment was performed.

Live classified coverage (unclassified sector weights are excluded):

| Issuer     | ISIN         | Countries | Country coverage | Sectors | Classified sector coverage |
| ---------- | ------------ | --------: | ---------------: | ------: | -------------------------: |
| ISHARES    | IE00B4L5Y983 |        23 |          99.478% |      11 |                    99.438% |
| ISHARES    | IE00B5BMR087 |         1 |          99.887% |      11 |                    99.862% |
| ISHARES    | IE00BKM4GZ66 |        28 |          99.314% |      11 |                    99.313% |
| VANGUARD   | IE00BK5BQT80 |        52 |          99.993% |      11 |                     98.75% |
| VANGUARD   | IE00B810Q511 |         2 |          99.995% |      11 |                    99.262% |
| VANGUARD   | IE00B3XXRP09 |         1 |           100.0% |      11 |                    99.729% |
| XTRACKERS  | IE00BTJRMP35 |        34 |          99.767% |      12 |                     98.95% |
| XTRACKERS  | IE00BGV5VN51 |        10 |          99.981% |       6 |                    97.214% |
| XTRACKERS  | IE00BJ0KDQ92 |        35 |          99.986% |      12 |                    99.608% |
| WISDOMTREE | IE00BZ56SW52 |        10 |           93.23% |      10 |                     99.97% |
| WISDOMTREE | IE00BDVPNG13 |         7 |           99.98% |       5 |                     100.0% |
| WISDOMTREE | IE00BJGWQN72 |         3 |           100.0% |       4 |                     100.0% |

## Reproducing validation

Use the repository Node version (22.23.5). Run memory-intensive checks sequentially
with `NODE_OPTIONS=--max-old-space-size=2048`.

```sh
node --env-file=.env.example node_modules/.bin/nx run-many --target=test --all --parallel=1 --runInBand
node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.app.json
LIVE_ETF=1 node_modules/.bin/jest --config apps/api/jest.config.ts --runInBand --testPathPatterns=generic.live.spec --testPathIgnorePatterns=/node_modules/
```

The normal test run excludes live and snapshot qualification specs. Existing
repository skips are retained; no tests or commit hooks are bypassed.

## Follow-up: Vanguard profiles without an ISIN

The test database contained VUSA.MI with the expected name but NULL ISIN and
countries. Live justETF returned an empty Milan Reuters field, so the strict
primary resolver stopped before holdings retrieval. Vanguard independently
published RIC VUSA.MI on ETFP and ISIN IE00B3XXRP09.

The issuer catalogue now supplies the verified fallback described above and is
reused by normal product discovery, avoiding duplicate catalogue requests. The
normal enhancer still controls freshness, composition replacement and persistence;
there are no direct database updates or migrations in this fix.

Reduced public-source fixtures reproduce the empty Reuters field and official
listings for three different Vanguard products. Tests cover missing identity,
existing valid/invalid ISINs, ambiguity, duplicate listings, wrong markets, wrong
exchange suffixes, invalid checksums, non-ETF and non-equity products, unavailable
issuer responses and cache isolation for identical tickers on different markets.
The opt-in live suite additionally starts from VUSA.MI with no supplied ISIN.

Follow-up validation on 2026-11-25:

- 308 targeted tests passed across 27 suites.
- API TypeScript passed; scoped typed ESLint reported zero errors (114 warnings).
- All 13 live checks passed, including VUSA.MI starting with NULL ISIN and countries.
- The missing-ISIN live case returned IE00B3XXRP09 and US weight 0.9999993 (99.99993%).
- Full-project regression passed for all four projects: API executed, the other three used valid Nx cache entries.
  - Test Suites: 12 skipped, 195 passed, 195 of 207 total
  - Tests: 178 skipped, 2211 passed, 2389 total
- Normal pre-commit API lint and formatting checks are required; no hooks are bypassed.
- The database was inspected read-only; this fix does not insert an ISIN or country weights manually.

## Follow-up: Invesco and Amundi (2026-11-25)

The test database was inspected read-only: SPXS.MI and MEUD.MI were equity ETF
profiles with NULL ISIN and countries and existing complete sector compositions.
Both issuers are now registered after the existing ETF enhancers. Their verified
identities are retained by the data-gathering pipeline. Complete existing sectors
remain protected when filling missing geography.

Invesco uses its official DNG API, addressed by a verified ISIN. The fundDetails
response must echo that ISIN and publish a fresh date and supported replication
method. Physical funds use weightedHoldings/fund; synthetic funds use
weightedHoldings/index, so the collateral basket is never presented as the index
exposure. Each allocation endpoint independently verifies its own ISIN, date and
weights. No product URL, ticker-to-ISIN table or product-specific identifier is
embedded in production code.

Amundi uses its official ProductAPI. It verifies the unique product ID, ISIN,
equity classification and replication method. Direct(Physical) selects FUND
allocations; Indirect(Swap Based) selects INDEX allocations, with the corresponding
source date. Decimal weights are preserved without rescaling. If justETF is
unavailable or cannot resolve a missing Yahoo ISIN, the cached official catalogue
must publish one exact RIC and matching exchange. Ambiguous primary identities,
stored invalid identities, duplicate listings and unsupported markets are rejected.
The catalogue is bounded to 5,000 products and uses the existing five-minute cache.

Observed live results from the production enhancers, without database writes:

| Symbol  | Verified ISIN | Country result                                         |
| ------- | ------------- | ------------------------------------------------------ |
| SPXS.MI | IE00B3YCGJ38  | US 99.8%, Switzerland 0.1%, Netherlands 0.1%           |
| MEUD.MI | LU0908500753  | 18 published country rows, approximately 100% coverage |

Both exact symbols succeeded starting without an ISIN. The source dates were
2026-10-09 for SPXS index allocations and 2026-11-23 for MEUD fund allocations.
The 21-case live suite passed: three different products per issuer across all six
issuers, plus missing-ISIN VUSA.MI, SPXS.MI and MEUD.MI. The first run had a transient
Amundi connection failure; the complete repeat passed.

Limits observed in additional Invesco products are retained explicitly: EQQQ
(IE0032077012) country weights include -0.11% cash/derivatives, so geography is
rejected while valid sectors remain available. MSCI World (IE00B60SX394) index
sector weights sum to 100.1%, so sectors are rejected while countries remain
available. Neither case is silently clipped or normalized. Missing country labels
such as Other remain unclassified; the published weights are not redistributed.

Deterministic fixtures include the public official allocation responses. Tests
cover percentage versus decimal units, camelCase labels, synthetic exposure,
wrong ISINs, invalid/stale/future dates, negative/nonfinite/overweight/duplicate
allocations, missing dimensions, listing market verification, ambiguity, complete
composition protection and identity persistence in data gathering.

No database migration, manual database repair, push or deployment is part of this
change. A running test instance must load the new code before its normal asset
refresh can persist the newly recovered data.

Final validation for the Invesco/Amundi follow-up:

- All 21 opt-in official-source live checks passed (one earlier Amundi network failure was not counted as a pass).
- Full-project Nx regression passed for four projects: API executed; common, UI and client used valid local cache entries.
  - API suites: 196 passed, 12 skipped, 208 total.
  - API tests: 2,264 passed, 178 skipped, 2,442 total.
  - This adds 53 deterministic passing tests to the previous API result.
- API TypeScript passed on the final code.
- Scoped typed ESLint reported zero errors; warnings remain (339 in the initial scoped run).
- The normal pre-commit API lint and formatting checks run without bypassing hooks.
- A separate baseline run, Docker build, migration and deployment were not performed.
