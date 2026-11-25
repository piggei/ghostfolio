# Ghostfolio-NG Home Assistant Add-on Changelog

## 3.100.7

### Integration-specific changes

- feat(data-provider): add WisdomTree ETF composition enhancer (f9516068c)
- feat(data-provider): improve Xtrackers ETF composition parsing (d966d747e)
- fix(data-provider): make justETF canonical parsing order-independent (74d6309da)
- feat(data-provider): add experimental ISIN resolver (8103072be)

## 3.100.6

### Integration-specific changes

- docs(ng): pin ETF integration documentation reference (a15864298)
- docs(ng): document ETF composition integration (0fa814791)
- feat(ng): integrate ETF composition data enhancers (b6ebe398b)

## 3.100.5

### Integration-specific changes

- fix(ng): preserve synthetic cash activity precision (0ace723fa)

## 3.100.4

### Integration-specific changes

- test(ng): update About guide assertions for portfolio targets (151ce040a)
- i18n(it): refine fixed income terminology (ec0be3726)
- docs(ng): document portfolio targets and update release references (c74aeabaf)
- feat(ng): integrate portfolio targets and drift analysis (ebde0bd0e)
- fix(dev): align Node.js version with engine requirement (84676134d)

## 3.100.3

### Integration-specific changes

- i18n(it): improve Italian localization in Ghostfolio NG (90a493835)

## 3.100.2

### Integration-specific changes

- fix(about): support chapter navigation in scroll container (b53f21f71)
- fix(portfolio): preserve complete weekly PnL across months (088491ae5)

## 3.100.1

### Integration-specific changes

- fix(i18n): localize portfolio replacement across supported languages (19b56ee7b)
- docs(distribution): register portfolio replacement in release notes (ff4922822)
- docs(portfolio): add NG replacement integration reference (f25fa7282)
- docs(portfolio): document replacement and localize user guide (676e86070)
- feat(portfolio): add transactional portfolio data replacement (758a28bfb)
- style: normalize Ghostfolio-NG integration baseline formatting (71ced2d2a)
- fix(ci): align cash PostgreSQL port mapping with test guards (06032d561)

## 3.100.0

### Official Ghostfolio updates

#### [Ghostfolio 3.100.0](https://github.com/ghostfolio/ghostfolio/releases/tag/3.100.0)

##### Changed

- Upgraded the `Node.js` engine from version `>=22.23.4` to `>=22.23.5` (`package.json`)
- Upgraded `dotenv` from version `18.0.3` to `18.0.9`
- Upgraded `stripe` from version `23.0.1` to `23.1.0`
- Upgraded `undici` from version `8.12.3` to `8.12.4`

##### Special Thanks

- @dtslvr
- @KenTandrian
- @ZainnQureshii

### Integration-specific changes

- fix(ci): align distribution workflows with Node.js 22.23.5 (a106bb1c2)
- chore(ng): merge upstream Ghostfolio 3.100.0 (28fae438c)

## 3.99.4

### Official Ghostfolio updates

No new official Ghostfolio release since the previous integration build (3.99.0).

#### Additional upstream changes

##### Changed

- Upgraded `@modelcontextprotocol/core` and `@modelcontextprotocol/server` from version `2.3.1` to `2.4.0`
- Upgraded `@modelcontextprotocol/node` from version `2.1.1` to `2.1.2`
- Upgraded `@rekog/mcp-nest` from version `2.0.8` to `2.0.9`

### Integration-specific changes

- fix(ng): isolate portfolio module provider registration test (a881f79d8)
- fix(ng): update API security snapshot and isolate ESM tests (79400b573)
- feat(ng): finalize integrated distribution and documentation (2957c0974)
- feat(ng): expose gated MWR and TWR benchmark comparison modes (219f72bf9)
- feat(benchmark): evaluate annualized activity-matched MWR series (32d0b8727)
- refactor(mwr): extract XIRR with strict legacy numerical parity (82d0bc7b4)
- feat(benchmark): add incremental daily TWR evaluator (afc67fa84)
- merge(ng): integrate activity-matched benchmark (6ca7cd8ac)
- docs(ng): fix README file permissions (f7e69bd18)
- docs(ng): add feature screenshots and distribution README (67d094447)

## 3.99.3

### Integration-specific changes

- ci: trigger Ghostfolio-NG integration release (f0c04418d)

## 3.99.2

### Integration-specific changes

- fix(distribution): improve Ghostfolio-NG release descriptions (376872bf1)

## 3.99.0

### Official Ghostfolio updates

#### [Ghostfolio 3.99.0](https://github.com/ghostfolio/ghostfolio/releases/tag/3.99.0)

##### Added

- Added `comment` to the `AccountBalance` database schema as a preparation for notes in the account balances
- Added the discovery endpoints of OAuth 2.1 to the server of the Model Context Protocol (MCP) (experimental)

##### Changed

- Improved the _Storybook_ stories of the accounts table component
- Improved the _Storybook_ stories of the activities table component
- Changed the build executor of the client from `@nx/angular:browser-esbuild` to `@nx/angular:application`
- Improved the language localization for German (`de`)
- Improved the language localization for Polish (`pl`)
- Improved the language localization for Spanish (`es`)
- Upgraded `ngx-skeleton-loader` from version `13.0.0` to `14.0.0`

##### Special Thanks

- [**@dtslvr**](https://github.com/dtslvr)
- [**@KenTandrian**](https://github.com/KenTandrian)
- [**@kodzonko**](https://github.com/kodzonko)
- [**@Lyndros**](https://github.com/Lyndros)

### Integration-specific changes

- test(roai): update cash ledger balance mocks ([c8613e2](https://github.com/piggei/ghostfolio/commit/c8613e2ebe2df70e26a3479ad39ca3a25860c431))
- ci: qualify Ghostfolio-NG 3.99 candidate ([f46d511](https://github.com/piggei/ghostfolio/commit/f46d511d6ff760bd6701f37e323bfef243710893))
- Merge Ghostfolio 3.99.0 into Ghostfolio-NG candidate ([796c996](https://github.com/piggei/ghostfolio/commit/796c9961a3365047f527641651e4f719a0e3d801))
