# Changelog

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
