# Changelog

## 0.0.9

### Changed
- Removed knex, better-sqlite3, @bsv/wallet-toolbox from direct CLI deps (transitive via wallet-node)
- Pinned @1sat/wallet-node >= 0.0.13 for bun:sqlite auto-detect

## 0.0.8

### Fixed
- Republished with correct wallet-node@0.0.13 dep (0.0.7 still resolved to 0.0.12)

## 0.0.7

### Changed
- Uses wallet-node@0.0.13 with StorageBunSqlite (bun:sqlite replaces knex + better-sqlite3)

## 0.0.6

### Fixed
- Lint formatting fixes across command files

## 0.0.5

### Fixed
- Added sigma-protocol as direct dep (peer dep of @1sat/templates wasn't resolving via bunx)
- Removed better-sqlite3 from direct deps (Bun has built-in SQLite)

## 0.0.4

### Fixed
- Added missing transitive deps (dotenv, knex, @bsv/wallet-toolbox) for bunx compatibility

## 0.0.3

### Fixed
- Removed 66MB compiled binary from npm package (src/ only)

## 0.0.2

### Added
- OpNS commands: register, deregister, lookup
- Sweep commands: scan (WIF-based UTXO discovery), import (sweep BSV/ordinals/tokens)
- Tokens buy command (purchaseBsv21)
- Generic action executor fully wired (`1sat action <name> <json>`)

### Fixed
- tx decode output formatting (was showing [object Object] for nested data)
- printKeyValue signature in identity info
- Version display in compiled binary

## 0.0.1

Initial release.

### Added
- Pure Bun CLI with `1sat` binary name
- Interactive wallet setup (`1sat init`) with encrypted key storage
- Wallet commands: balance, address, send, send-all, info
- Ordinals commands: list, mint, transfer, sell, cancel, buy
- Token commands: balances, list, send
- Lock commands: info, lock, unlock
- Identity commands: create, info, sign (BAP)
- Social: on-chain post creation
- Generic action executor: `1sat action <name> <json>`
- Transaction decode: `1sat tx decode <hex>`
- Config management: show, set, path
- Output modes: --json, --quiet, --yes for automation
- Encrypted key storage in ~/.1sat/ using bitcoin-backup
- Environment variable support (PRIVATE_KEY_WIF, ONESAT_PASSWORD)
