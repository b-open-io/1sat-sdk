# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`CLAUDE.md` is a symlink to `AGENTS.md` — edits to either go to the same file, so AI tooling that looks for `AGENTS.md` and tooling that looks for `CLAUDE.md` stay in sync.

## Tooling and Commands

Always use Bun and workspace scripts — never `npm`/`yarn`/`pnpm`. The repo is a Bun workspace declared in the root `package.json` with `workspaces: ["packages/*", "examples/*"]`.

- `bun install` install all workspace deps
- `bun run build` build every package (via `--filter '*' build`)
- `bun dev` watch/dev across workspaces
- `bun run lint` Biome check (tab indent, width 2 — see `biome.json`)
- `bun run lint:fix` Biome auto-fix
- `bun test` run all Bun tests (tests live in `packages/*/test/*.test.ts`)
- `bun run clean` `rm -rf packages/*/dist`
- `bun run --filter '@1sat/<pkg>' build` build one package
- `bun run --filter '@1sat/<pkg>' dev` watch one package
- `bun test packages/<pkg>/test/<file>.test.ts` run a single test file
- `bun test --test-name-pattern '<regex>'` filter by test name

The root `package.json` pins `@bsv/sdk` to `2.0.13` via `overrides` — don't bump that casually; it affects every package.

## Monorepo Layout

Packages under `packages/*` (all published as `@1sat/<name>` unless marked private). Current set:

**Foundations**
- `types` — type definitions and protocol constants (`API_HOST`, `ORDFS_HOST`, `ONESAT_MAINNET_URL`, etc.)
- `utils` — encoding, validation, key derivation helpers

**Network / data**
- `client` — API clients: indexer (Gorilla Pool), broadcast (`ArcadeClient`), ORDFS
- `engine` — WASM parser for BEEF/transactions (ships protobuf bindings under `src/*_pb.{js,d.ts}`)
- `knex-bun-sqlite` — Knex dialect backed by `bun:sqlite`

**Protocol / building**
- `templates` — Bitcoin script templates (Inscription, OrdLock, Lock, BSV20, BSV21, AIP, BAP, MAP, Sigma, BSocial). Subpath export `@1sat/templates/sigma`.
- `actions` — self-describing wallet actions for agents and tooling (`createOrdinals`, `transferOrdTokens`, …)
- `permission-module` — `WalletPermissionsManager` gate (BRC-0098 `hashOutputs` commitments captured at `createAction` time)
- `permission-module-ui` — React UI for permission prompts

**Wallet engine + runtimes**
- `wallet` — BRC-100 wallet engine, indexers, sync, backup, CWI
- `wallet-browser` — `createWebWallet()` (IndexedDB storage)
- `wallet-node` — `createNodeWallet()` (SQLite storage)
- `wallet-remote` — remote-only factory (no local storage)
- `wallet-server` — BRC-100 storage RPC server (carries most of the server-side tests)
- `wallet-mac` — macOS Secure Enclave + native UI (ships Swift via `swift/build.sh`)
- `wallet-desktop` (private) — Electrobun + Vite + Bun desktop app

**Browser dApp integration**
- `connect` — popup-based provider (`createOneSat`), postMessage protocol, session mgmt
- `extension` — toolkit for building `window.onesat` browser extensions (subpath exports `./popup`, `./storage`, `./keys`)
- `react` — `OneSatProvider`, `ConnectButton`, hooks (`useOneSatContext`, `useBalance`, …). Depends on `connect` only.
- `sweep-ui` — React UI for sweeping/migrating legacy BSV assets

**Vault / secrets**
- `vault` — platform-agnostic vault interface (used by `wallet-mac`, `wallet-desktop`)

**CLI**
- `cli` — `1sat` binary, built via `bun build --compile`. Resolves keys from `PRIVATE_KEY_WIF` env or `~/.1sat/keys.bep`.

**Note:** older docs referenced `@1sat/core` and `@1sat/sdk` aggregate packages — neither exists. Transaction-building primitives live in `templates` + `actions`; there is no aggregate re-export package.

Other top-level dirs:
- `examples/` — `browser`, `react`, `minimal-wallet`, plus `verify-docs.ts`
- `test-app/` — Vite React app used as a manual QA harness (see `test-app/QA-CHECKLIST.md`)
- `agents/ordinals.md` — long-form 1Sat Ordinals protocol notes
- `skills/<name>/SKILL.md` — 16 skill packs for AI tools (`1sat-cli`, `1sat-stack`, `dapp-connect`, `ordinals-marketplace`, `token-operations`, `transaction-building`, `wallet-setup`, `wallet-create-ordinals`, `timelock`, `sweep-import`, `opns-names`, `extract-blockchain-media`, `pow20-mining`, `sdk-publish`, `wallet-desktop-mcp`, …). Read the relevant skill before touching that area — they contain task-specific recipes that aren't duplicated here.
- `docs/` — architecture, protocols, research, plans

## Protocol Context

Primary domain: 1Sat + BSV protocols — ordinals, BSV20 (tick), BSV21 (origin), MAP (Magic Attribute Protocol), Sigma (data attestation), OrdLock (trustless listings), ORDFS (inscription content).

## Dependency Direction

Keep this direction stable:

`types` → `utils` → `client`/`engine` → `templates` → `actions` → `wallet` → `wallet-{browser,node,remote,server,mac,desktop}` → `examples`

Cross-cutting constraints:
- `connect` is browser-only and must NOT pull in core wallet logic.
- `react` may only depend on `connect` (plus `types`/`utils`).
- `extension` is independent of `wallet`/`actions` — it implements the provider surface.
- `vault` is below `wallet-mac` and `wallet-desktop`; do not let it depend upward.
- No deep imports across packages — import through the package entrypoint (`src/index.ts`).
- No star imports (`import * as X`).
- No `Buffer` or browser polyfills for conversions — use `@bsv/sdk` `Utils` (`toArray`, `toBase64`, `toHex`, …).
- Keep `browser` vs `node` entrypoints separate where applicable.

## Action Conventions (`packages/actions`)

These are non-obvious and easy to break:

- All actions use `createTrackedAction` (not raw `wallet.createAction`). It tags basketed outputs with IDs so they can be looked up later.
- Actions that spend **wallet-owned** inputs: `inputBEEF` is optional — fall back to `resolveBeef`, which looks up BEEF via the output's ID tag.
- Actions that spend **external** inputs (e.g. buying another user's listing): `inputBEEF` is required — the caller's wallet has no BEEF for outputs it doesn't own.
- Two-phase actions (`signAndProcess: false`) must sign via `completeSignedAction`. It merges BEEF, verifies the script, calls `signAction`, and aborts on failure.
- Contract unlocks use the template's `*WithWallet` method (`OrdLock.cancelWithWallet`, `Lock.unlockWithWallet`, …) — they handle sighash byte appending. Don't construct signatures manually.

## Working Rules

- Edit the smallest set of files required.
- When you add a public API:
  - update the package's `src/index.ts`
  - update the `exports` field in its `package.json` if you're adding a subpath
  - update relevant README/examples or `skills/<name>/SKILL.md`
- Keep `dist/`, scratch scripts, and debug files out of commits.

## Publishing Packages

The `sdk-publish` skill has the full procedure. Short version:

1. Bump `version` in the package's `package.json`.
2. Delete `bun.lock` and run `bun install` to regenerate it. `workspace:*` references resolve from the lockfile — a stale lockfile means `bun publish` ships the old version even with a new `package.json`.
3. `rm -rf packages/<pkg>/dist` before building (old `.d.ts` files persist otherwise).
4. `bun run --filter '@1sat/<pkg>' build`.
5. Verify the lockfile: `grep -A3 '"name": "@1sat/<pkg>"' bun.lock`.
6. Commit + push before publishing.
7. **Publish `connect` before `react`** — `react` depends on `connect` via `workspace:*`; the publish-time version comes from the lockfile.
8. Verify the dependency chain: `npm view @1sat/react@<ver> dependencies`.

## wallet-desktop Logging (specific)

`packages/wallet-desktop/src/bun/log.ts` is a side-effect module that calls `initLogger` with a composite drain. The drain fans out to:

1. **File** (`~/.1sat-wallet/logs/*.jsonl`) — NDJSON, date-rotated, 7-day max retention. Uses `createFsDrain` from `evlog/fs` wrapped in `createDrainPipeline` from `evlog/pipeline` (batches 25 events or 2s).
2. **MCP ring buffer** — queryable via the `wallet_logs` MCP tool (last 500 events). Pushed inline in the composite drain.
3. **stdout** — standard evlog structured output.

`initLogger` sets `env: { service: '1sat-wallet' }`; evlog auto-detects environment, version, etc.

Wiring rules:
- `src/bun/log.ts` is imported as a side effect in `index.ts` (`import './log'`) before any logging.
- `flushLogs()` is called on app quit.
- `index.ts` is the **only** file that imports from `./log` (for side-effect init + `flushLogs`).
- All other bun modules import from `evlog` directly: `createLogger({ context: 'startup' })`, `createRequestLogger({ method, path })`, `log.set()`, `log.emit()`.

Debugging a signed/notarized build that hangs:

```bash
tail -30 ~/.1sat-wallet/logs/$(date +%Y-%m-%d).jsonl
```

Startup event sequence: `url_resolved` → `window_created` → `dom_ready` → `http_listening` → `mcp_listening` → `setup_complete`. The missing one tells you where it stopped.

Debugging other users (have them send `~/.1sat-wallet/logs/`):
- `dom_ready` with `hasKey: false` → no wallet created, should see onboarding
- `dom_ready` with `hasKey: true` → wallet exists, should see unlock screen
- `start_failed` in stack context → 1sat-stack sidecar didn't start (data won't load)
- `onboarding_required` → stack needs setup wizard completed
- No events at all → bun process crashed before `initLogger` (missing dependency)

### wallet-desktop local services

| Service | Port | Auth | Purpose |
|---------|------|------|---------|
| BRC-100 HTTP | 3321 | BRC-31 | dApp wallet connectivity |
| BRC-100 HTTPS | 2121 | BRC-31 + TLS | Same, with self-signed cert |
| MCP Server | 3322 | BRC-103/104 | Agent tools (26 tools: browser, tabs, data, wallet, logs) |

`1sat mcp-proxy` bridges stdio to the MCP server with an authenticated BRC-31 handshake. The 1sat plugin ships `.mcp.json` that runs this automatically. Agent identity keys: `~/.1sat-wallet/mcp-agent.key` (client), `~/.1sat-wallet/mcp-identity.key` (server).

## Validation Checklist

After meaningful changes:

1. `bun run lint`
2. `bun run --filter '@1sat/<pkg>' build` for packages you touched
3. `bun run build` before finalizing cross-package changes
4. `bun test` (or scoped `bun test packages/<pkg>/...`) when tests exist or behavior changed
