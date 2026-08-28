# Changelog

## 0.0.101

### Changed
- Picks up `@1sat/actions@0.0.199`.

## 0.0.95

### Fixed
- `1sat serve` picks up `@1sat/wallet-server` 0.0.41, which fixes `Uint8Array` fields being serialized as `{"0":..}` in storage JSON-RPC responses. Remote wallets on toolbox 2.4.2+ failed `signAction` with `Serialized BEEF must start with 4022206465 or 4022206466 but starts with 0`.

## 0.0.78

### Changed
- CLI wallet commands no longer run the toolbox monitor in-process. After the wallet closes, a detached `__monitor-once` child runs housekeeping; its stdout/stderr go to `<dataDir>/monitor.log` (default `~/.1sat/cli/data/monitor.log`). Skipped when `1sat serve` already owns the monitor or when a remote is the active store.
- Entry sets `DOTENV_CONFIG_QUIET` before loading wallet-toolbox so import-time dotenv tip lines no longer print on every command.

## 0.0.77

### Added
- Global `--env-file <path>` (and `--env-file=path`) loads env vars for the run; file values override existing env. Repeatable.

## 0.0.70

### Fixed
- `1sat init` crashed with `Error: text is not defined` when choosing "Import existing key" — the `text` prompt was never imported from `@clack/prompts`. The generate-key path was unaffected.

## 0.0.52

### Added
- `1sat serve` (all modes) initializes structured logging via `evlog`. Service name is `1sat-cli-serve-<mode>`. Picks up the request, lifecycle, monitor, and accounts events emitted by `@1sat/wallet-server`. One-shot CLI commands continue using `console.log` / `console.error`.
- Picks up `@1sat/wallet-server@0.0.13` (structured logging in the server itself).

## 0.0.50

### Fixed
- `1sat serve wallet` no longer fires the factory's initial monitor `runOnce` on startup. The mode is explicit: wallet workers should do no monitor work. Previously each wallet worker duplicated a startup sync pass, which was wasteful on single-instance deployments and actively compounded under cluster mode (4 workers × runOnce against the same DB).

## 0.0.49

### Added
- `ONESAT_PORT` env var overrides `server.port` from config. Enables PM2 cluster deploys where each worker gets a distinct port via `increment_var`, with a shared nginx upstream doing sticky routing on `x-bsv-auth-identity-key`. Precedence: `ONESAT_PORT` > `server.port` > default `8100`. Invalid values fail fast.
- `ordinals burn` subcommand — destroys owned ordinals permanently. Accepts `--outpoints <op1,op2,...>`, gated by a confirmation prompt unless `--yes` is passed.

## 0.0.47

### Changed
- `1sat init` no longer offers remote storage configuration inline. Init is now local-only, with a footer pointing at `1sat remote add <url>` and `1sat remote set-active <url>` for post-setup configuration. The prior prompt conflated active vs backup remotes and accepted only one URL.
- Picks up `@1sat/actions@0.0.113` (broadcast failure surfacing + deterministic BAP profile selection) and `@1sat/client@0.0.26` (arcade status whitelist).

## 0.0.45

### Added
- `wallet address` now accepts `--prefix`, `--start-index`, and `--count`. Non-JSON output prints one address per line when `--count > 1`; `--json` returns a single derivation for `--count 1` or the full array otherwise.
- `wallet send` supports `--script <hex>` (custom locking script) and `--data-asm "<asm>"` (OP_RETURN, 0 sats). The three destination modes (`--to`, `--script`, `--data-asm`) are mutually exclusive; `--data-asm` rejects `--sats`.
- `ordinals mint` accepts `--map <json>` (Record<string, string>) and `--sign-with-bap`.
- `identity sign` accepts `--encoding <utf8|hex|base64>` for how the `--message` string is decoded to bytes before BSM hashing.
- `social post` accepts `--content-type <text/plain|text/markdown>` and `--tags tag1,tag2` (comma-separated or repeatable). Tags land on both the on-chain MAP payload and the wallet output (`tag:<value>`).

### Changed
- Picks up `@1sat/actions@0.0.111` — `sendBsv21` paymail recipient branch removed (path was permanently stubbed; no paymail-BSV21 spec exists).

## 0.0.20

### Fixed
- Picks up `@1sat/actions@0.0.82` — AIP signed-message now includes the trailing `|` separator required by the canonical AIP protocol. BAP identity and profile signing via the CLI (`1sat identity ...`) produced signatures that were silently rejected by every AIP validator until this release.

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
