# Ghostfolio-NG Home Assistant Add-on Changelog

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
