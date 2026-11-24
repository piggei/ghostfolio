# ETF Composition Integration in Ghostfolio-NG

## Overview

Ghostfolio-NG extends ETF country and sector composition data using information published by ETF issuers.

The initial implementation supports selected funds from:

- iShares (BlackRock)
- Vanguard
- Xtrackers (DWS)

The enhancement integrates with Ghostfolio's existing data-gathering pipeline and portfolio allocation views.

## Upstream contribution

The reusable ETF composition normalizer is proposed independently in [Ghostfolio PR #8469](https://github.com/ghostfolio/ghostfolio/pull/8469).

This pull request provides shared country and sector normalization without introducing issuer-specific network clients.

The issuer-specific enhancers are maintained separately and are not represented as merged upstream functionality.

## Implementation provenance

| Component                   | Reference                                  |
| --------------------------- | ------------------------------------------ |
| Shared normalizer           | `71290c8b38db93e31a91d439e3a0e962ab72f41f` |
| Issuer enhancers            | `94fff7a47bc154ce3eccf6952f32602346565da5` |
| Vanguard GraphQL correction | `1e7530b4d96af940077b125cc77ea8f857493e7c` |
| Ghostfolio-NG integration   | `b6ebe398b164fdb4a34743e9129c966dd7fdd23a` |

The NG integration preserves the existing portfolio functionality and registers the additional data enhancers in the data-provider module.

## Data normalization

Issuer country names and ISO codes are mapped to Ghostfolio's country representation.

Issuer sector classifications are mapped to the existing Ghostfolio sector ontology.

Duplicate exposures are aggregated using decimal arithmetic.

Incomplete allocations are preserved rather than artificially scaled to 100%.

Unclassified and missing country exposure is tracked separately.

Sector coverage distinguishes total allocation coverage from classified coverage, excluding the `Other` category from classified sector coverage.

## Data quality and failure handling

The enhancers validate allocation weights and reject invalid or inconsistent distributions.

Insufficient coverage prevents incomplete issuer data from replacing existing composition information.

External requests may fail because of network errors, unavailable issuer services, changed response formats, or missing fund information.

Issuer-specific support is not guaranteed for every ETF managed by the supported issuers.

## Functional validation

The initial development validation used:

| ETF       | Issuer    |
| --------- | --------- |
| `SWDA.MI` | iShares   |
| `VWCE.DE` | Vanguard  |
| `XMME.MI` | Xtrackers |

The tests confirmed acquisition and persistence of country and sector allocations.

The integrated Ghostfolio-NG application was subsequently tested with the complete application test suite and a local functional startup.

## Limitations

- ETF composition depends on externally published issuer data.
- Data availability and freshness vary by issuer and fund.
- The implementation does not guarantee coverage of every ETF.
- Country and sector allocations do not necessarily represent a complete security-level holdings breakdown.
- This enhancement does not change portfolio return calculations, investment transactions, or historical market prices.

## Related documentation

- [Ghostfolio-NG README](../README-NG.md)
- [Docker integration and releases](../docker/INTEGRATION.md)
- [Upstream normalizer PR #8469](https://github.com/ghostfolio/ghostfolio/pull/8469)
