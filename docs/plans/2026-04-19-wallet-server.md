# @1sat/wallet-server Package

> **Status (2026-04-20): Phase 1–3 shipped. Scope reframed — see update below.**
>
> What's in `master` (sdk commit `0dc0c6f`):
> - `@1sat/wallet-server` package with `createWalletRpcHandler` (Web-standard dispatcher + preDispatch hook), `createWalletServer` (Express + BRC-100 + optional bearer), `createBearerServer` (Bun.serve bearer-only), `createWalletMonitor` (monitor factory), and the accounts layer (metering, BRC-0121 402 pricing, BRC-29 payment validation, migrations, repo). 49 unit tests green.
> - `@1sat/cli` `serve` command (`serve`, `serve wallet`, `serve monitor`) driven entirely by `~/.1sat/cli/config.json`. Built on `createNodeWallet` so the server and CLI operate on the **same wallet instance** (same storage, same `activeRemote`, same `backups`, same `storageIdentityKey`). Server identity via existing `loadKey()`.
> - Config commands extended with dotted-path setter (`1sat config set server.port 8100`) and JSON-literal coercion.
>
> What's in `1sat-stack` branch `wallet-server` (commit `7a98f67` = `a9119f7` + merged master):
> - Wallet-mode config (`embedded` | `remote`) with `remote_url` for pointing at a TS wallet server. `initRemote` uses go-wallet-toolbox `storage.NewClient` with BRC-100 auth. Go `cmd/wallet-server` binary still present as fallback. Messagebox extracted via `MessageBoxClient`.
>
> **Reframe (see `~/.claude/plans/it-was-but-i-calm-ripple.md` for the decision log):**
> - Bearer `/internal` route exists in code but **dropped from the primary architecture**. Only `/` (BRC-100) is deployed. `1sat serve wallet` now passes `internalPath: null`.
> - Accounts layer is **opt-in per-deployment** (`enabled: false` default). Only enabled where the operator wants metering.
> - Messagebox port → **not happening**. `go-messagebox-server` stays as a separate Go service.
> - Go `pkg/account/` + `pkg/payment/` + `pkg/wallet/billing*.go` on `dave/OPL-1883-account-billing-layer` left untouched — not merged, not deleted.
> - Secrets management for production: deferred, tracked in [OPL-1905](https://linear.app/openprotocollabs/issue/OPL-1905/secrets-management-for-wallet-server-production-deployment).
>
> **Next: mss1 cutover.** See [mss1-cutover.md](./2026-04-20-mss1-wallet-server-cutover.md) for the step-by-step.
>
> ---

**Original goal:** Introduce a TypeScript wallet storage RPC server as a sibling to `@1sat/wallet-remote`. Provides a postgres-backed `StorageKnex` wallet server that accepts BRC-100 mutual auth on a public endpoint and API-key-gated trusted-identity calls on an internal endpoint. Replaces the Go `cmd/wallet-server` on the 1sat-stack [wallet-server branch](../../../1sat-stack) for the internal consumer path and adds a public proxy gateway on 1sat-stack.

**Architecture:** One TS process per deployment owns the wallet storage (`StorageKnex` + postgres), exposes a JSON-RPC dispatcher over two routes, and optionally runs the wallet `Monitor` daemon. `OneSatServices` from `@1sat/client` provides chain services by calling 1sat-stack's public API. 1sat-stack itself is both a consumer (via its existing `storage.NewClient` path) and an exposer (new public proxy handler that terminates external BRC-100 auth, runs account/payment gates, then forwards JSON-RPC to the wallet server's internal route).

**Tech Stack:** TypeScript, Bun, `@bsv/wallet-toolbox` (StorageKnex, Monitor, WalletError), `@1sat/client` (OneSatServices), `@bsv/auth-express-middleware` (optional, for BRC-100 route only), Knex with `pg` driver, `@1sat/cli` for CLI surface.

**Linear:** (to be filed — epic for the package + CLI subcommand + 1sat-stack proxy handler + retirement of Go `cmd/wallet-server`)

---

## Deployment model

One TS process exposes two endpoints on the same server:

| Route | Auth | Intended caller |
|---|---|---|
| `POST /` | BRC-100 mutual auth (stock) | Direct wallet clients; 1sat-stack's existing internal `storage.NewClient` path |
| `POST /internal` | `Authorization: Bearer <token>` + `X-Identity-Key: <pubkey>` | 1sat-stack's public proxy handler (firewalled leg) |

Both routes back the **same** `StorageKnex` instance. Wallet state is identical whether a client reaches it via `/` directly or via 1sat-stack's proxy → `/internal`.

Three deployment patterns fall out of this without code changes:

- **Public storage-as-a-service** — `/` open to the world; `/internal` reachable only from 1sat-stack.
- **1sat-stack gateway only** — `/` firewalled; all public traffic goes through 1sat-stack to `/internal`.
- **Both** — `/` open for direct BRC-100 clients that don't need account/payment gates; 1sat-stack's proxy available for billed/gated flows.

`/internal` always requires the API key regardless of whether `/` is exposed.

---

## File Structure

### New package: `packages/wallet-server/`

- `packages/wallet-server/package.json`
- `packages/wallet-server/tsconfig.json`
- `packages/wallet-server/README.md`
- `packages/wallet-server/src/index.ts` — public exports
- `packages/wallet-server/src/createWalletRpcHandler.ts` — core dispatcher (web-standard `Request → Response`)
- `packages/wallet-server/src/createWalletServer.ts` — full-stack factory (handler + optional monitor + HTTP listener)
- `packages/wallet-server/src/resolvers/brc100.ts` — BRC-100 mutual-auth identity resolver
- `packages/wallet-server/src/resolvers/bearer.ts` — API-key + `X-Identity-Key` header resolver
- `packages/wallet-server/src/resolvers/index.ts`
- `packages/wallet-server/src/dispatch.ts` — method dispatch switch, entity validation, error marshaling
- `packages/wallet-server/src/types.ts` — config types, `IdentityResolver` type
- `packages/wallet-server/src/monitor.ts` — thin wrapper around `wallet-toolbox` `Monitor` for lifecycle

### New files in `@1sat/cli`

- `packages/cli/src/commands/serve.ts` — `1sat serve`, `1sat serve wallet`, `1sat serve monitor`

### Modified files

- `packages/cli/src/cli.ts` — register `serve` subcommand
- `packages/cli/package.json` — add `@1sat/wallet-server` dep

### New files in `1sat-stack` (Go)

- `1sat-stack/pkg/wallet/proxy.go` — public BRC-100 → `/internal` forwarder
- `1sat-stack/pkg/wallet/proxy_routes.go` — HTTP route wiring
- `1sat-stack/wallet-server-config.example.yaml` — update with new fields (API key, internal URL)

### Modified files in `1sat-stack`

- `1sat-stack/pkg/wallet/config.go` — add `InternalURL`, `InternalAPIKey` for the proxy path
- `1sat-stack/cmd/server/config.go` — wire proxy handler config
- `1sat-stack/admin/routes.go` — mount proxy handler
- `1sat-stack/admin/ui/src/pages/SetupWizardPage.tsx` — surface new config fields

### Removed (after migration validated)

- `1sat-stack/cmd/wallet-server/` — Go standalone wallet server retired once TS replacement is live
- `1sat-stack/Dockerfile.wallet` — retired

---

## Package API

### `createWalletRpcHandler(config)`

Framework-agnostic core. Returns a Web-standard `(req: Request) => Promise<Response>` handler.

```ts
interface WalletRpcHandlerConfig {
  storage: WalletStorageProvider   // typically StorageKnex
  resolveIdentity: IdentityResolver
  adminIdentityKeys?: string[]
  makeLogger?: MakeWalletLogger
}

type IdentityResolver = (req: Request) => Promise<{
  identityKey: string
  userId?: number
}>
```

### Built-in resolvers

```ts
brc100Resolver({ wallet })                // stock BRC-100 mutual auth
bearerResolver({ token, header? })        // API key + X-Identity-Key header
```

### `createWalletServer(config)`

Full-stack factory. Wires two handlers (one per route), optionally starts the monitor daemon, returns `{ start, stop }`.

```ts
interface WalletServerConfig {
  chain: 'main' | 'test'
  serverPrivateKey: string           // BRC-100 identity for root route
  storage: { knex: Knex.Config; storageName: string }
  services?: WalletServices           // default: new OneSatServices(chain, onesatURL)
  onesatURL?: string
  listen: { port: number; host?: string }
  routes: {
    publicPath?: string               // default '/'; set null to disable
    internalPath?: string              // default '/internal'; set null to disable
    internalAPIKey?: string           // required if internal route enabled
  }
  monitor?: { enabled: boolean }
  adminIdentityKeys?: string[]
}
```

### Exports from `@1sat/wallet-server`

```ts
export { createWalletRpcHandler } from './createWalletRpcHandler'
export { createWalletServer } from './createWalletServer'
export { brc100Resolver, bearerResolver } from './resolvers'
export type { WalletRpcHandlerConfig, WalletServerConfig, IdentityResolver } from './types'

// Convenience re-exports
export { StorageKnex, Monitor } from '@bsv/wallet-toolbox/out/src/index.client.js'
```

---

## Dispatcher implementation notes

Inline notes for the dispatch module (`src/dispatch.ts`):

- Method surface is what Go's [rpcWalletStorageProvider](../../../go-wallet-toolbox/pkg/storage/client_gen.go#L118) expects — 22 methods: `migrate`, `makeAvailable`, `setActive`, `findOrInsertUser`, `createAction`, `processAction`, `abortAction`, `internalizeAction`, `insertCertificateAuth`, `relinquishCertificate`, `relinquishOutput`, `listCertificates`, `listOutputs`, `listActions`, `listTransactions`, `getSyncChunk`, `findOrInsertSyncStateAuth`, `processSyncChunk`, `findOutputBasketsAuth`, `findOutputsAuth`, plus `destroy` (ignored) and `getSettings` (no auth).
- JSON-RPC wire format matches the existing [StorageServer](../../../wallet-toolbox/src/storage/remoting/StorageServer.ts) — `{jsonrpc, method, params, id}` in, `{jsonrpc, result|error, id}` out. Go client uses `go-jsonrpc` with method-name formatter stripped of namespace, matching TS method names.
- Per-method auth rules replicate the switch in [StorageServer.ts:163-217](../../../wallet-toolbox/src/storage/remoting/StorageServer.ts#L163-L217): `destroy` ignored, `getSettings` open, `findOrInsertUser` must match authenticated identity, `adminStats` admin-gated, `processSyncChunk` needs entity normalization, default runs `validateParam0`.
- `validateParam0` injects `reqAuthUserId` and optionally `userId` into `params[0]` based on resolver output.
- Entity date/Buffer normalization (`validateEntity`/`validateEntities`) copied from StorageServer — needed for cross-runtime serialization.
- Errors marshaled via `WalletError.unknownToJson` / `WalletErrorFromJson` (already exported from `@bsv/wallet-toolbox`).

---

## 1sat-stack proxy handler

New Go package in [1sat-stack/pkg/wallet/](../../../1sat-stack/pkg/wallet/):

```go
type ProxyHandler struct {
    targetURL  string   // e.g. http://wallet-server:8100/internal
    apiKey     string   // Bearer token for /internal
    accountSvc AccountService   // plugs in account+payment gating
    logger     *slog.Logger
}

// ServeHTTP:
// 1. BRC-100 auth middleware on inbound (existing 1sat-stack auth stack) — sets identityKey
// 2. Call accountSvc.Check(identityKey, method, params) — returns allow/deny + debit
// 3. Read inbound JSON-RPC body
// 4. POST to targetURL with:
//      Authorization: Bearer <apiKey>
//      X-Identity-Key: <identityKey>
//      Content-Type: application/json
//    and the inbound body unchanged
// 5. Relay response body + status to client
```

The handler is deliberately not a `storage.NewClient` consumer — it does not deserialize JSON-RPC responses into Go types. It's a transparent body forwarder with auth replacement at the boundary.

Account/payment `AccountService` is an interface for now; implementation deferred to whichever billing system wins. The interface-only dependency keeps the proxy handler decoupled from the billing decision.

---

## CLI

`@1sat/cli` adds a `serve` command with subcommands:

```
1sat serve                    # full server (BRC-100 + bearer) + monitor
1sat serve wallet             # full server (BRC-100 + bearer), no monitor
1sat serve rpc                # bearer-only, no Express, native Bun.serve
1sat serve monitor            # monitor daemon only
1sat serve --config <path>    # explicit yaml config path (same flag on subcommands)
```

`serve rpc` is the lean path that 1sat-stack uses internally — no BRC-100 machinery, trusted header + API key only. `serve` / `serve wallet` are the safe default for anyone standing up a server without a proxy in front of it.

Config schema mirrors `WalletServerConfig`. Thin wrapper around `createWalletServer` with yaml loading via viper-equivalent (Bun-compatible).

Binary distribution: `@1sat/cli` already compiles to a single Bun binary. `serve` inherits that build.

---

## Phases

### Phase 1 — Package skeleton and dispatcher
- [ ] Scaffold `packages/wallet-server/` with package.json, tsconfig, README
- [ ] Implement `dispatch.ts` (method switch, entity validation, error marshaling)
- [ ] Implement `createWalletRpcHandler.ts` (Web-standard handler over `StorageKnex`)
- [ ] Implement `bearerResolver` + `brc100Resolver`
- [ ] Unit tests: bearer auth paths, identity injection, method rejection, error marshaling

### Phase 2 — Full-stack factory and monitor
- [ ] `createWalletServer` — dual-route listener, monitor lifecycle
- [ ] Postgres smoke test via docker-compose
- [ ] Round-trip test: Go `storage.NewClient` → TS root route → StorageKnex (validates wire compat)

### Phase 3 — CLI integration
- [ ] `1sat serve` subcommand tree
- [ ] Config loading (yaml + env)
- [ ] Build integration into existing Bun binary

### Phase 4 — 1sat-stack public proxy
- [ ] `ProxyHandler` Go package
- [ ] Wire into existing auth middleware
- [ ] `AccountService` interface stub (implementation deferred)
- [ ] Config fields for `InternalURL`, `InternalAPIKey`

### Phase 5 — Retire Go wallet-server
- [ ] Validate production parity: run TS wallet-server alongside Go for comparison period
- [ ] Switch 1sat-stack's `remote_url` to TS server
- [ ] Remove `1sat-stack/cmd/wallet-server/` and `Dockerfile.wallet`
- [ ] Update [wallet-server branch](../../../1sat-stack) commit (or new branch)

---

## Open decisions

1. **Branch strategy on 1sat-stack side** — extend the existing [wallet-server branch](../../../1sat-stack) commit (a9119f7) or start a new branch after it. The branch currently has 1 commit adding remote-mode wallet + `HTTPWalletServices` + `MessageBoxClient`. The proxy handler is additive; either approach works.
2. **`WalletServices` choice on TS side** — default to `OneSatServices` pointing at 1sat-stack's public API, or keep it user-supplied with no default. Leaning: default to `OneSatServices` for zero-config.
3. **Messagebox direction** — unchanged in this plan. Paymail's [MessageBoxClient](../../../1sat-stack/pkg/paymail/messagebox_client.go) stays separate.
4. **`storage-as-a-service` rate limiting** — out of scope for Phase 1. The `/` route is either open or firewalled; if opened publicly, rate limiting becomes a separate concern (likely at the ingress layer).

---

## References

- [Go wallet-server branch commit](../../../1sat-stack) — baseline Go standalone wallet-server
- [go-wallet-toolbox storage client](../../../go-wallet-toolbox/pkg/storage/client.go) — the RPC client that 1sat-stack already uses
- [TS StorageServer](../../../wallet-toolbox/src/storage/remoting/StorageServer.ts) — reference dispatcher and auth flow
- [OneSatServices](../../../1sat-sdk/packages/client/src/services/OneSatServices.ts) — chain services via 1sat-stack public API
- [@1sat/wallet-remote](../../../1sat-sdk/packages/wallet-remote) — client-side symmetric counterpart
- [AuthFetch (BRC-100)](../../../ts-sdk/src/auth/clients/AuthFetch.ts), [auth-express-middleware](../../../wallet-toolbox/node_modules/@bsv/auth-express-middleware/src/index.ts) — session-based mutual auth
