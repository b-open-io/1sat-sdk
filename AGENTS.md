# AGENTS

Agent instructions for the `1sat-sdk` monorepo.

## Goals
- Keep package boundaries clean and dependency direction stable.
- Preserve browser/node runtime compatibility.
- Prefer small, focused changes with validation.

## Tooling and Commands
Always use Bun and workspace scripts.

- `bun dev` run watch/dev scripts across workspaces
- `bun run build` build all packages/examples
- `bun run lint` Biome check
- `bun run lint:fix` Biome auto-fix
- `bun test` run tests
- `bun run --filter '@1sat/<package>' build` build one package
- `bun run --filter '@1sat/<package>' dev` watch one package

## Monorepo Layout
- `packages/types` shared type definitions and constants
- `packages/utils` shared helpers (encoding/validation/metadata)
- `packages/client` API clients and network services
- `packages/core` transaction building, protocol implementations (MAP, Sigma, OrdLock, ordinals), and high-level core flows
- `packages/actions` wallet actions
- `packages/wallet` wallet runtime and indexers
- `packages/connect` browser connection layer
- `packages/extension` extension toolkit
- `packages/react` React bindings
- `packages/sdk` aggregate SDK exports
- `examples` usage samples

## Dependency Order (High Level)
Follow this direction for new code:

`types` → `utils` → `client` → `core` → `actions/wallet` → `sdk` → `examples`

Additional constraints:
- `connect` is browser-focused and should remain independent from core wallet logic.
- `react` depends on `connect` only.
- `sdk` is an export aggregator; avoid adding business logic there.

## Protocol Context
Primary domain: 1Sat + BSV protocols (ordinals, BSV21 tokens, MAP, Sigma, OrdLock listings, ORDFS content).

## Skills Catalog

Agent skills are colocated with the code they document (`packages/<pkg>/skills/<name>/SKILL.md`)
so they stay current with the code. Claude Code discovers them via the `skills` globs in
`.claude-plugin/plugin.json`; other harnesses can read this catalog. Start with
`action-patterns` to understand the action/context pattern, then use the domain skill for
the task. The full generated list of all actions lives in `action-patterns` (regenerate
with `bun run scripts/gen-action-index.ts`).

| Skill | Path | Use when |
|-------|------|----------|
| action-patterns | `packages/actions/skills/action-patterns` | Understanding the action/context pattern, two-phase signing, BEEF, the registry, baskets/tags (the generated action index) |
| payments | `packages/actions/skills/payments` | Sending BSV, batch payments, OP_RETURN, deriving deposit addresses |
| tokens | `packages/actions/skills/tokens` | BSV21 tokens — balances, send, deploy (mint/auth), mint, purchase |
| ordinals-create | `packages/actions/skills/ordinals-create` | Creating inscriptions and ordinal collections |
| ordinals-marketplace | `packages/actions/skills/ordinals-marketplace` | Browsing, transferring, listing, buying, cancelling, burning ordinals |
| locks | `packages/actions/skills/locks` | Time-locking BSV to a block height and unlocking |
| opns | `packages/actions/skills/opns` | Claiming or buying OpNS names at 1sat.name; publishing, listing, transferring, or deregistering owned names |
| sweep | `packages/actions/skills/sweep` | Sweeping/importing BSV, ordinals, tokens; claiming deposits |
| mnee | `packages/actions/skills/mnee` | MNEE stablecoin — config, balance, utxos, history, send |
| identity | `packages/actions/skills/identity` | BAP identity (publish/rotate/profile) and social posts |
| signing | `packages/actions/skills/signing` | BSM signing, BRC-77 auth tokens, counterparty encrypt/decrypt, friend pubkeys |
| sync-cosign | `packages/actions/skills/sync-cosign` | Multi-device address/message sync and cosigner attestation |
| wallet-setup | `packages/wallet/skills/wallet-setup` | Creating a BRC-100 wallet (node / browser / remote) |
| dapp-connect | `packages/connect/skills/dapp-connect` | Connecting a dApp to an existing wallet (extension / desktop / Sigma) |
| cli | `packages/cli/skills/cli` | The `@1sat/cli` terminal commands |
| stack-api | `packages/client/skills/stack-api` | The api.1sat.app unified indexer API |
| blockchain-media | `packages/client/skills/blockchain-media` | ORDFS content access (service-level; no SDK action) |
| desktop-mcp | `packages/wallet-desktop/skills/desktop-mcp` | wallet-desktop MCP browser-automation tools |
| sdk-publish | `.claude/skills/sdk-publish` | Internal maintainer workflow; not distributed by the public plugin |
| test-app | `skills/test-app` | Driving the test-app harness to exercise actions, tags and permission prompts against a real gated wallet |

## Coding Conventions
- Use Bun for all scripts and package operations.
- Use Biome for linting/formatting.
- Do not use `Buffer` or browser polyfills for conversions; use `@bsv/sdk` utils.
- Do not use star imports (`import * as ...`).
- Keep runtime-specific entrypoints separate (`browser` vs `node`) where applicable.
- Prefer explicit named exports from package entrypoints.

## Action Conventions (packages/actions)
- **All actions** must use `createTrackedAction` instead of raw `wallet.createAction`. This adds ID tags to basketed outputs for targeted lookups.
- **Actions spending wallet-owned inputs** take the asset's `id` (the bare value of its `id:` tag) — not a `WalletOutput` and not `inputBEEF`. Use `loadBasketOutputBeef(wallet, basket, id)` to load the row and its BEEF in one lookup, or `loadBasketOutput` when only tags and customInstructions are needed.
- **Self-kept outputs** re-file into the same basket with carried tags via `ordinalSeedTags(source)` plus the action's own markers, and get a fresh `id:` from `createTrackedAction`. Do not use `resolveOrdinalTags` to decide the basket for an asset already under management.
- **Actions spending external inputs** (e.g. purchasing a listing from another user) require `inputBEEF` plus the outpoint — the caller's wallet has no BEEF for outputs it doesn't own, and BEEF alone doesn't say which output.
- **All two-phase actions** (signAndProcess: false) must use `completeSignedAction` for signing. It handles BEEF merge, script verification, signAction, and abort on failure.
- **Template methods** (`OrdLock.cancelWithWallet`, `Lock.unlockWithWallet`) must be used for contract unlocking instead of manual signature construction. They handle sighash byte appending correctly.

## Working Rules for Agents
- Edit the smallest set of files required.
- Avoid cross-package deep imports; import through package entrypoints.
- If you add a public API:
  - update the package `src/index.ts`
  - update `package.json` `exports` when needed
  - update README/examples if behavior changed
- Keep temporary artifacts out of commits (`dist`, scratch files, debug scripts).

## Publishing Packages

When bumping a package version and publishing to npm:

1. **Bump the version** in `package.json`
2. **Delete `bun.lock`** and run `bun install` to regenerate it. `workspace:*` references resolve from the lockfile — if the lockfile is stale, `bun publish` will resolve to the old version even though `package.json` has the new one.
3. **Clean `dist/`** before building (`rm -rf packages/<pkg>/dist`). Old `.d.ts` files from previous builds persist and get included in the published tarball.
4. **Build** the package (`bun run --filter '@1sat/<pkg>' build`)
5. **Verify the lockfile** has the correct version: `grep -A3 '"name": "@1sat/<pkg>"' bun.lock`
6. **Commit and push** before publishing
7. **Publish connect before react** — react depends on connect via `workspace:*`. The resolved version at publish time comes from the lockfile.
8. **After publishing**, verify the dependency chain: `npm view @1sat/react@<ver> dependencies`

## wallet-desktop Logging

`src/bun/log.ts` is a side-effect module that calls `initLogger` with a composite drain. The drain fans out to three destinations:

1. **File** (`~/.1sat-wallet/logs/*.jsonl`) — NDJSON with date rotation (`2026-03-24.jsonl`), 7-day max retention. Uses `createFsDrain` from `evlog/fs` wrapped in `createDrainPipeline` from `evlog/pipeline` (batches 25 events or 2s).
2. **MCP ring buffer** — queryable via `wallet_logs` MCP tool (last 500 events). Pushed inline in the composite drain.
3. **stdout** — standard evlog structured output.

The `initLogger` call sets `env: { service: '1sat-wallet' }` — evlog auto-detects environment, version, etc.

### How it's wired

- `src/bun/log.ts` is imported as a side effect in `index.ts` (`import './log'`) before any logging calls.
- `flushLogs()` is called on app quit to flush buffered events to disk.
- `index.ts` is the **only** file that imports from `./log` (for side-effect init and `flushLogs`).

### Adding logging in wallet-desktop bun modules

Import directly from `evlog` — **not** from `./log`:

- `createLogger({ context: 'startup' })` — non-request logging
- `createRequestLogger({ method, path })` — HTTP request logging
- `log.set()` — accumulate context fields on the wide event
- `log.emit()` — flush the wide event

### Debugging the installed app

When the signed/notarized build fails (window doesn't open, skeletons forever):

```bash
tail -30 ~/.1sat-wallet/logs/$(date +%Y-%m-%d).jsonl
```

Startup events in order: `url_resolved` → `window_created` → `dom_ready` → `http_listening` → `mcp_listening` → `setup_complete`. Whichever is missing tells you where it stopped.

### Debugging for other users

Have them send `~/.1sat-wallet/logs/`. Key things to check:
- `dom_ready` with `hasKey: false` → no wallet created, should see onboarding
- `dom_ready` with `hasKey: true` → wallet exists, should see unlock screen
- `start_failed` in stack context → 1sat-stack sidecar didn't start (data won't load)
- `onboarding_required` → stack needs setup wizard completed
- No events at all → bun process crashed before `initLogger` (missing dependency)

### MCP Server

The wallet-desktop runs three local services:

| Service | Port | Auth | Purpose |
|---------|------|------|---------|
| BRC-100 HTTP | 3321 | BRC-31 | dApp wallet connectivity |
| BRC-100 HTTPS | 2121 | BRC-31 + TLS | Same, with self-signed cert |
| MCP Server | 3322 | BRC-103/104 | Agent tools (28 tools: browser, tabs, mainview, data, wallet, logs) |

The `1sat mcp-proxy` CLI command bridges stdio to the MCP server with authenticated BRC-31 handshake. The 1sat plugin ships `.mcp.json` that runs this automatically.

Agent identity keys: `~/.1sat-wallet/mcp-agent.key` (client), `~/.1sat-wallet/mcp-identity.key` (server).

## Validation Checklist
Run after meaningful changes:

1. `bun run lint`
2. `bun run build`
3. `bun test` (when tests exist or behavior changed)

For package-scoped changes, run targeted builds first, then run full repo checks before finalizing.
