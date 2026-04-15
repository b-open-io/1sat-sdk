---
name: 1sat-cli
description: "This skill should be used when working with the 1Sat CLI tool for BSV operations from the terminal -- running wallet commands, minting ordinals, managing tokens, creating listings, locking BSV, sweeping assets, or managing identity from the command line. Triggers on '1sat CLI', 'command line wallet', '1sat init', '1sat wallet', '1sat ordinals', '1sat tokens', '1sat lock', '1sat sweep', '1sat action', 'bunx @1sat/cli', or 'terminal BSV operations'. Uses @1sat/cli package."
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
bunx @1sat/cli wallet send --to 1Address... --amount 50000
```

> If installed globally (`bun add -g @1sat/cli`), replace `bunx @1sat/cli` with just `1sat`.

## Configuration

Config directory: `~/.1sat/`

### Monitor (Background Sync)

The CLI runs a background monitor that automatically syncs wallet state on wallet commands. Configured via `monitorIntervalMinutes` in `~/.1sat/config.json` (default: 5 minutes).

- Monitor runs automatically when you run wallet-related commands
- No manual `wallet sync` needed — just run your command
- Set to `0` to disable auto-monitor

```bash
# Check current config
bunx @1sat/cli config show

# Disable auto-monitor (set to 0)
bunx @1sat/cli config set monitorIntervalMinutes 0
```

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
bunx @1sat/cli wallet balance              # Show BSV balance
bunx @1sat/cli wallet send                 # Send BSV to address
bunx @1sat/cli wallet send-all             # Send entire balance
bunx @1sat/cli wallet utxos                # List payment UTXOs
```

### Remote Storage

```bash
bunx @1sat/cli remote add <url>                    # Add remote as backup (no immediate validation)
bunx @1sat/cli remote list                         # Show all remotes and status
bunx @1sat/cli remote delete <url>                 # Remove a remote from backup list
bunx @1sat/cli remote set-active <url>             # Migrate TO this remote as primary
bunx @1sat/cli remote set-active local             # Switch back to local-primary
```

### Ordinals

```bash
bunx @1sat/cli ordinals list               # List ordinals in wallet
bunx @1sat/cli ordinals inscribe           # Inscribe a file as ordinal
bunx @1sat/cli ordinals transfer           # Transfer ordinal to recipient
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
bunx @1sat/cli tokens send                 # Send tokens to recipient
```

### Locks (Timelock)

```bash
bunx @1sat/cli locks status                # Show lock summary
bunx @1sat/cli locks create                # Lock BSV until block height
bunx @1sat/cli locks unlock                # Unlock all matured locks
```

### Identity (BAP)

```bash
bunx @1sat/cli identity publish            # Publish BAP identity
bunx @1sat/cli identity profile            # View/update profile
bunx @1sat/cli identity attest             # Publish attestation
```

### Social (BSocial)

```bash
bunx @1sat/cli social post                 # Create a social post
bunx @1sat/cli social search               # Search posts
```

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
3. Encrypts and stores the key at `~/.1sat/keys.bep`
4. Writes config to `~/.1sat/config.json`
5. Tests connectivity to `api.1sat.app`

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

The CLI wraps `@1sat/actions`, `@1sat/wallet-node`, and `@1sat/client` into a single command-line interface.
