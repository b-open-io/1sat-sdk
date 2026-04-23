---
name: 1sat-cli
description: "This skill should be used when working with the 1Sat CLI tool for BSV operations from the terminal -- running wallet commands, minting ordinals, managing tokens, creating listings, locking BSV, sweeping assets, managing identity, OR running the wallet-storage RPC server (`1sat serve`) from the same binary. Triggers on '1sat CLI', 'command line wallet', '1sat init', '1sat wallet', '1sat ordinals', '1sat tokens', '1sat lock', '1sat sweep', '1sat action', '1sat serve', '1sat serve wallet', '1sat serve monitor', 'wallet server', 'BRC-100 storage server', 'bunx @1sat/cli', or 'terminal BSV operations'. Uses @1sat/cli and @1sat/wallet-server packages."
---

# 1Sat CLI

Bun-native command-line interface for 1Sat Ordinals and BSV operations. Binary name: `1sat`.

## Usage

```bash
# Run any command directly — no install needed
bunx @1sat/cli <command>

# Optional: install globally for frequent use
bun add -g @1sat/cli
# Then use the short form: 1sat <command>
```

## Quick Start

```bash
# Initialize wallet and configuration
bunx @1sat/cli init

# Check wallet balance
bunx @1sat/cli wallet balance

# List ordinals in wallet
bunx @1sat/cli ordinals list

# Send BSV
bunx @1sat/cli wallet send --to 1Address... --sats 50000
```

> If installed globally (`bun add -g @1sat/cli`), replace `bunx @1sat/cli` with just `1sat`.

## Configuration

Config directory: `~/.1sat/cli/` (file: `config.json`).

### Config command

```bash
1sat config show                                # Render full nested tree
1sat config set <dotted.path> <value>           # Set value; tries JSON.parse, falls back to string
1sat config unset <dotted.path>                 # Remove value at path
1sat config path                                # Print config directory
```

Values are stored in their native JSON type when the raw argument is valid JSON (numbers, booleans, arrays, objects, quoted strings); bare words fall back to string. Examples:

```bash
1sat config set chain main                      # "main" (string)
1sat config set server.port 8100                # 8100 (number)
1sat config set server.accounts.enabled true    # true (boolean)
1sat config set server.accounts.freeIdentityKeys '["02aa...","02bb..."]'
```

Nested subtrees (like `server` / `server.storage` / `server.accounts`) are created automatically on set and persist as JSON objects in the file.

### Monitor (Background Sync)

The CLI runs the wallet's transaction-lifecycle Monitor once on every invocation when local storage is active. The Monitor services pending broadcasts, merkle proofs, and related tasks. Individual tasks self-throttle on their own intervals, so running many CLI commands in rapid succession does not trigger repeated work — it's a cheap no-op once each task's interval is satisfied.

There is no user-facing monitor configuration. No interval knob, no disable flag — nothing to tune. If a remote is the active storage, the server runs its own monitor and the CLI skips firing one client-side.

### Database Locations

- **Wallet DB:** `~/.1sat/data/wallet-main.db` (or `wallet-test.db` for testnet)
- **Sync DB:** `~/.1sat/data/sync-<identityKeyPrefix>.db`
- **Config:** `~/.1sat/config.json`
- **Keys:** `~/.1sat/keys.bep`

### Key Management

Keys can be provided in three ways:

1. **Secure Enclave** (macOS arm64): Hardware-protected via `@1sat/vault` — keys encrypted with SE P-256 key, decryption requires Touch ID. Used by `bap touchid enable` and `clawnet setup-key`.
2. **Environment variable**: Set `PRIVATE_KEY_WIF` with your WIF private key
3. **Encrypted keystore**: Stored at `~/.1sat/keys.bep` (created during `bunx @1sat/cli init`)

```bash
# Using env var
PRIVATE_KEY_WIF=L1abc... bunx @1sat/cli wallet balance

# Using encrypted keystore (created by init)
bunx @1sat/cli init
bunx @1sat/cli wallet balance
```

## Commands

> All examples below use `bunx @1sat/cli`. If installed globally, use `1sat` instead.

### Wallet

```bash
bunx @1sat/cli wallet balance                                     # Show BSV balance
bunx @1sat/cli wallet address                                     # Show primary deposit address
bunx @1sat/cli wallet address --count 5 --start-index 0           # Derive multiple addresses
bunx @1sat/cli wallet address --prefix mcp --count 3               # Custom BRC-29 prefix
bunx @1sat/cli wallet send --to 1A... --sats 5000                 # Send BSV to address
bunx @1sat/cli wallet send --script <hex> --sats 5000              # Send to custom locking script
bunx @1sat/cli wallet send --data-asm "deadbeef cafe"              # Publish OP_RETURN (0 sats)
bunx @1sat/cli wallet send-all --to 1A...                          # Send entire balance
```

`wallet send` modes are mutually exclusive: `--to` (P2PKH), `--script` (custom hex), or `--data-asm` (OP_RETURN, 0 sats — rejects `--sats`). The ASM string is passed straight to `Script.fromASM('OP_0 OP_RETURN ' + asm)`, so multiple space-separated hex pushes are supported in one output.

### Remote Storage

```bash
bunx @1sat/cli remote add <url>                    # Add remote as backup (no immediate validation)
bunx @1sat/cli remote list                         # Show all remotes and status
bunx @1sat/cli remote delete <url>                 # Remove a remote from backup list
bunx @1sat/cli remote set-active <url>             # Migrate TO this remote as primary
bunx @1sat/cli remote set-active local             # Switch back to local-primary
bunx @1sat/cli remote status [url]                 # Per-identity capacity + pricing snapshot
bunx @1sat/cli remote topup [url]                  # Manual BRC-29 top-up to `/account/payment`
```

### Ordinals

```bash
bunx @1sat/cli ordinals list                                                # List ordinals in wallet
bunx @1sat/cli ordinals mint --file image.png                               # Inscribe a file
bunx @1sat/cli ordinals mint --file note.txt --type text/plain              # Override detected MIME
bunx @1sat/cli ordinals mint --file image.png --map '{"name":"NFT 1"}'      # Attach MAP metadata
bunx @1sat/cli ordinals mint --file image.png --sign-with-bap               # Sign inscription with BAP identity
bunx @1sat/cli ordinals transfer --outpoint <op> --to <addr>                # Transfer ordinal
```

### Marketplace (OrdLock)

```bash
bunx @1sat/cli ordinals list-for-sale      # List ordinal for sale
bunx @1sat/cli ordinals cancel-listing     # Cancel an active listing
bunx @1sat/cli ordinals purchase           # Purchase a listed ordinal
```

### Tokens (BSV21)

```bash
bunx @1sat/cli tokens balances             # Show all token balances
bunx @1sat/cli tokens list                 # List token UTXOs
bunx @1sat/cli tokens send                 # Send tokens to address or counterparty
```

Paymail recipients are not supported for BSV21 transfers — there is no ecosystem spec for paymail-delivered token outputs. Use `--to <address>` instead.

### Locks (Timelock)

```bash
bunx @1sat/cli locks status                # Show lock summary
bunx @1sat/cli locks create                # Lock BSV until block height
bunx @1sat/cli locks unlock                # Unlock all matured locks
```

### Identity (BAP)

```bash
bunx @1sat/cli identity create                                           # Create/publish BAP identity
bunx @1sat/cli identity info                                             # Show identity key
bunx @1sat/cli identity update-profile --profile '{"name":"..."}'        # Update profile (JSON blob)
bunx @1sat/cli identity sign --message "hello"                           # BSM sign with identity key
bunx @1sat/cli identity sign --message 68656c6c6f --encoding hex         # Sign hex-encoded bytes
```

`identity sign` uses BSM (Bitcoin Signed Message) compact format. `--encoding` accepts `utf8` (default), `hex`, or `base64` — it only controls how `--message` is decoded to bytes; the same bytes always produce the same signature.

### Social (BSocial)

```bash
bunx @1sat/cli social post --content "hello world"
bunx @1sat/cli social post --content "# heading" --content-type text/markdown
bunx @1sat/cli social post --content "ordinals drop" --tags bsv,ordinals,nft
bunx @1sat/cli social post --content "..." --app my-app                    # MAP attribution
```

Tags (`--tags a,b,c`) land on the on-chain post's MAP payload and on the wallet output as `tag:<value>`, so `wallet list-outputs --tags tag:bsv` finds your own posts by tag. `--content-type` accepts `text/plain` (default) or `text/markdown`.

### OpNS Names

```bash
bunx @1sat/cli opns register               # Register identity on OpNS name
bunx @1sat/cli opns deregister             # Remove identity binding
```

### Sweep / Import

```bash
bunx @1sat/cli sweep bsv                   # Sweep BSV from external WIF
bunx @1sat/cli sweep ordinals              # Sweep ordinals from external WIF
bunx @1sat/cli sweep tokens                # Sweep BSV21 tokens from external WIF
```

### Serve (Wallet Storage RPC Server)

The same binary can run a BRC-100 wallet storage RPC server backed by the **same wallet instance** the CLI commands use.

```bash
1sat serve              # Wallet server + monitor daemon (single process)
1sat serve wallet       # Wallet server only (no monitor loop)
1sat serve monitor      # Monitor daemon only (no HTTP)
```

Key properties:

- **Same wallet instance** — `serve` wraps the wallet created by `createNodeWallet` using the exact same config inputs (`chain`, `dataDir`, `storageIdentityKey`, `activeRemote`, `backups`) as `1sat wallet <command>`. There's one wallet on disk at `~/.1sat/data/wallet-${chain}.db`; HTTP and CLI access the same one.
- **Server identity = CLI identity** — loaded via `loadKey()` (`PRIVATE_KEY_WIF` env or `keys.bep` + `ONESAT_PASSWORD`). No separate server key.
- **Storage provider** — defaults to `bun-sqlite`. Set `server.storage.provider` to `pg` for Postgres deployments.
- **Accounts layer (opt-in)** — per-identity capacity metering on billable writes. Reads always free. Over-capacity writes get an HTTP `507 Insufficient Storage` with a JSON body describing deficit + pricing. Top-up via `POST /account/payment` (BRC-29 payment body). Toggle via `1sat config set server.accounts.enabled true`.

Server-specific settings live under `server.*` in the config — edit via `1sat config set`:

```bash
1sat config set server.port 8100
1sat config set server.host 0.0.0.0
1sat config set server.accounts.enabled true
1sat config set server.accounts.baselineBytes 1073741824      # free baseline per identity
1sat config set server.accounts.purchaseUnitBytes 1073741824  # chunk size (default 1 GB)
1sat config set server.accounts.satsPerUnit 1000000           # price per chunk
1sat config set server.accounts.durationBlocks 4383           # validity window (~1 month)
```

Pricing model: new payments charge `unitsCharged × satsPerUnit` (rounded up to a whole chunk) for `durationBlocks` from now, minus a prorated refund credit for unused time on the prior payment. One active payment row per account at a time.

Defaults when keys are unset:
- `server.host` → `127.0.0.1`
- `server.port` → `8100`
- `server.storage.provider` → `bun-sqlite`
- `server.accounts.enabled` → `false`
- `server.accounts.baselineBytes` → `1073741824` (1 GB)
- `server.accounts.purchaseUnitBytes` → `1073741824` (1 GB)
- `server.accounts.satsPerUnit` → `1000000`
- `server.accounts.durationBlocks` → `4383`

### Action Escape Hatch

Any registered action can be invoked directly by name with a JSON input:

```bash
# Run any action from the action registry
bunx @1sat/cli action <name> <json>

# Examples
bunx @1sat/cli action sendBsv '{"requests":[{"address":"1A...","satoshis":5000}]}'
bunx @1sat/cli action lockBsv '{"requests":[{"satoshis":10000,"until":900000}]}'
bunx @1sat/cli action inscribe '{"base64Content":"SGVsbG8=","contentType":"text/plain"}'
```

This is the escape hatch for any operation supported by the `@1sat/actions` registry, even those without dedicated CLI subcommands.

### Origin Tag Resolution

When working with ordinal outputs from `ordinals list --json`, the `tags` array indicates origin relationships for building content URLs:

- **`"origin"`** (bare tag, no colon) — This output **IS the origin**. Use the output's own `outpoint` for content URLs.
- **`"origin:<txid.vout>"`** (tag with colon and outpoint) — This is a **transfer**. Use the origin outpoint from the tag for content URLs.

**Example:**
```json
{
  "outpoint": "5148d8dae125c2851283ca90519eae787ab24baca5a008ee72c03ba3c290def4.1",
  "tags": ["origin:04fc3e5f92004f89c7efe94fb97113bd672faa87708f9e0cd67fdef861767c2c.0", ...]
}
```
→ Content URL: `.../content/04fc3e5f92004f89c7efe94fb97113bd672faa87708f9e0cd67fdef861767c2c.0` (from tag)

```json
{
  "outpoint": "a70be5c136d23ab10fbe1e4344552797faa5017ff7f5a58c4b9bf14e7a3e1006.0",
  "tags": ["origin", ...]
}
```
→ Content URL: `.../content/a70be5c136d23ab10fbe1e4344552797faa5017ff7f5a58c4b9bf14e7a3e1006.0` (own outpoint)

**Outpoint format:** Always use the outpoint as-is (`txid.vout` or `txid_vout`). Do NOT modify the separator.

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON (for scripting/piping) |
| `--quiet, -q` | Suppress output |
| `--yes, -y` | Skip confirmations |
| `--chain <main\|test>` | Network (default: main) |
| `--help, -h` | Show help |
| `--version, -v` | Show version |

## Output Modes

```bash
# JSON output (for scripting/piping)
bunx @1sat/cli wallet balance --json

# Quiet mode (minimal output)
bunx @1sat/cli wallet send --to 1A... --amount 5000 --quiet

# Auto-confirm prompts (non-interactive)
bunx @1sat/cli wallet send --to 1A... --amount 5000 --yes
```

## Init Flow

```bash
bunx @1sat/cli init
```

The init command:
1. Prompts for network selection (mainnet/testnet)
2. Generates or imports a private key (WIF)
3. Sets a password and encrypts the key to `~/.1sat/keys.bep`
4. On macOS arm64, optionally enables Touch ID to cache the password via `@1sat/vault`
5. Optionally configures a primary remote storage URL (local becomes backup)
6. Writes config to `~/.1sat/config.json` (chain, generated `storageIdentityKey`, `activeRemote`)

## Requirements

- Bun runtime (not Node.js)
- Network access to `api.1sat.app`

## Package

```bash
# Run without installing
bunx @1sat/cli

# Or install globally
bun add -g @1sat/cli
```

The CLI wraps `@1sat/actions`, `@1sat/wallet-node`, `@1sat/client`, and `@1sat/wallet-server` (for the `serve` subcommand) into a single command-line interface.
