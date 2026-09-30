# Changelog

## 0.0.80

### Changed
- Peer dependency is upstream `@bsv/wallet-toolbox` ^2.14.4 instead of the `@bopen-io` fork. Storage backends import from the toolbox's public entry points instead of `out/src/**` file paths.

## 0.0.73

### Fixed
- Accept Node `Buffer` values as SQLite blob bindings under current Bun type definitions.

### Changed
- Picks up `@1sat/wallet@0.0.106`.
