# Changelog

## 0.0.4

### Fixed
- Add missing transitive deps (dotenv, knex, better-sqlite3, @bsv/wallet-toolbox) so `bunx @1sat/cli` works
- Deps now resolve to latest published versions (actions@0.0.53, wallet-node@0.0.12, etc.)

## 0.0.3

### Fixed
- Removed 66MB compiled binary from npm package (only src/ needed — Bun runs TS natively)

## 0.0.2

### Added
- OpNS commands: register, deregister, lookup
- Sweep commands: scan (WIF-based UTXO discovery), import (sweep BSV/ordinals/tokens)
- Tokens buy command (purchaseBsv21)
- Generic action executor now fully wired (`1sat action <name> <json>`)

### Fixed
- tx decode output formatting (was showing [object Object] for nested data)
- printKeyValue signature in identity info
- Version display in compiled binary

## 0.0.1

Initial release of the 1sat CLI.

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
