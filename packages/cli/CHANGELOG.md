# Changelog

## Unreleased

### Added
- `1sat permissions` manages what apps on `1sat serve wallet-api` may do, directly on the grant store — no wallet key, no running server.
  - `1sat permissions list [<origin>]` shows grants grouped by app origin.
  - `1sat permissions grant <origin> [--protocol <name> --level <0|1|2> --counterparty <hex|self|anyone>] [--basket <name>] [--label <name>] [--certificate <type> --fields <a,b>] [--spending <satoshis>] [--privileged]` writes them. Selectors can be combined in one call.
  - `1sat permissions revoke <origin> [same selectors] | --all` removes them.
  - The endpoint's manager reads the store on every check, so a grant written while `1sat serve wallet-api` is running applies to the app's next call; no restart.

### Changed
- `1sat serve wallet-api` serves the wallet through a `LocalWalletPermissionsManager` and is headless. Each app origin is limited to the permissions granted to it; anything else is denied immediately. There are no terminal prompts, no interactive mode and no auto-approve.
- A denial names the command that would allow the call, with every argument that request needs, e.g. ``permission denied for gib: run `1sat permissions grant gib --protocol "gib branch" --level 1` and retry``. A BRC-73 grouped request lists one command per permission it asked for. The message reaches the app unchanged as the 400 `{ error }` body, so the agent driving the app can read the fix out of the app's own output.
- The previous behaviour, where the endpoint answered every app with the full wallet and approved sensitive methods without a prompt unless `server.dapp.approve` was set, is deprecated and removed. `server.dapp.approve` is gone; there is no setting that approves requests without a grant.
- The endpoint rejects requests whose origin is the wallet's own admin originator.
- Transaction metadata an app writes through the endpoint is encrypted at rest (the wallet-toolbox default). The CLI's own commands now run against the permissions manager as the admin originator, which bypasses every check and decrypts that metadata on the way back, so descriptions and custom instructions still read as text. The CLI keeps writing its own metadata in plaintext, so other readers of the same storage (`1sat serve wallet`, remote clients) are unaffected.

## 0.0.115

### Added
- `sweep import` moves OpNS names and BSV-20 tickers (not only BSV, ordinals, and active BSV-21).
- `--only` / `--skip` select `bsv,ordinals,opns,bsv20,bsv21`. `--dry-run` prints the plan without broadcasting.
- Listed OrdLock inputs cancel into the destination wallet in the same sweep transaction.
- BSV-21 listed cancels are one transaction each so one invalid listing cannot sink the rest. Overlay `is_active` does not gate the sweep.

### Changed
- `sweep scan` reports every class, including OpNS, BSV-20, listings, locks, and RUN leftover.

## 0.0.111

### Changed
- Picks up `@1sat/actions@0.0.208`.

## 0.0.110

### Fixed
- Prevent SDK stale-session recovery from replaying signed writes. An explicitly approved payment permits one paid request; ambiguous writes require reconciliation.

## 0.0.109

### Fixed
- Authenticated HTTP requests preserve response status and do not replay writes after an unsigned response or ambiguous transport failure.
- Read-only requests can opt into plain HTTP fallback; mutation failures report that their outcome may be unknown.

## 0.0.108

### Changed
- Picks up `@1sat/actions@0.0.207` for counterparty ordinal and OpNS delivery metadata.

## 0.0.107

### Changed
- Picks up `@1sat/actions@0.0.206`, `@1sat/wallet-node@0.0.73`, and `@1sat/wallet-server@0.0.48`.

## 0.0.102

### Changed
- Picks up `@1sat/actions@0.0.202`, including corrected BSV21 authority selection and mint fee accounting.

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
