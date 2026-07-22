# Unified host on ovh-n0001: `1sat serve` cluster + nginx domain consolidation

Migrate the wallet-only PM2 cluster to the **unified host** (`1sat serve`), so the same
four redundant processes also serve paymail, messagebox, and hosting, and the
`messagebox.1sat.app` / paymail domains fold onto the same upstream.

Baseline: [`2026-04-24-wallet-server-cluster-deploy.md`](2026-04-24-wallet-server-cluster-deploy.md) (current wallet cluster).
Feature plan: [`2026-07-21-hosted-paymail.md`](2026-07-21-hosted-paymail.md).
**Top priority: do not break wallet storage.** Paymail/messagebox are less vital and staged last.

---

## Current state (ovh-n0001, verified 2026-07-22, read-only)

| Piece | Process | Listens | nginx |
|-------|---------|---------|-------|
| Wallet storage | 4× `bunx @1sat/cli@0.0.67 serve wallet` (fork, `ONESAT_PORT`) | `127.0.0.1:8101-8104` | `wallet.1sat.app` → `wallet_backend` upstream, sticky hash on `x-bsv-auth-identity-key` |
| Messagebox | 1× `serve messagebox` | `0.0.0.0:8771` | `messagebox.1sat.app` → `8771` |
| Monitor | 1× `serve monitor` (`wallet-monitor`) | none | — |
| Paymail | Go `1sat-stack` (systemd) | `0.0.0.0:8084` `/1sat` | `api.1sat.app` (full), `paymail.1sat.app` (Host→api), `1sat.app` (discovery only, Host→api) |
| Postgres | pgbouncer/pg | `localhost:5000` | DBs `account_wallet`, `messagebox` |

Paymail path layout (Go): discovery at root `/.well-known/bsvalias`; capabilities under `/1sat/bsvalias/*`; advertised host is whatever `Host` nginx forwards (hardcoded `api.1sat.app` in all three blocks today).

---

## Target topology

Four **identical** unified processes (redundancy + load-balancing preserved for every surface) + one dedicated monitor. All read one shared `~/.1sat/cli/config.json`.

| Piece | Process | Listens | nginx |
|-------|---------|---------|-------|
| Unified host ×4 | `1sat serve` (storage + hosting + paymail + messagebox, **monitor off**) | `127.0.0.1:8101-8104` | `wallet.1sat.app`, `messagebox.1sat.app`, paymail domains → `wallet_backend` |
| Monitor ×1 | `1sat serve monitor` | none | — |

The unified server mounts every surface flat at `/` on one port — wallet RPC (`POST /`), paymail (`/.well-known/bsvalias`, `/bsvalias/*`), hosting (`/hosting/*`), messagebox (`/sendMessage`, …, `/socket.io/`). Paths don't collide, so multiple `server_name`s can share one upstream; each domain exercises its own paths.

**Why not fold hosting into `serve wallet` / run a singleton host:** that would drop paymail/messagebox to a single non-redundant instance. The ×4 exists for redundancy + LB across *all* services, so all four run the full `1sat serve`.

---

## The monitor param (implemented this session)

The only surface that must not run four times is the **active monitor loop** (4× monitors = 4× broadcasts + 4× proof fetches; the PID lock does **not** arbitrate between `serve` monitors — it starts the loop then writes the pid unconditionally). Fix: a config gate so the four unified instances skip the monitor while one dedicated `serve monitor` runs it.

- **`server.monitor.enabled`** — defaults **true**. A lone `1sat serve` still runs the monitor (single-instance quick-start unaffected).
- `1sat serve` (all-mode) runs the monitor **unless** the flag is false. The repricer task rides the same loop and is gated with it.
- **`serve monitor` ignores the flag — always runs.** So one shared config with the flag off gives exactly the deploy: 4× `1sat serve` (no monitor) + 1× `serve monitor`.
- `serve wallet` never ran a monitor — unchanged.

Gate: [`serve.ts` `runMonitor`](../../packages/cli/src/commands/serve.ts) = `mode === 'monitor' || (mode === 'all' && resolved.monitorEnabled)`. Type: `ServerMonitorConfig` in [`config.ts`](../../packages/cli/src/config.ts).

```bash
1sat config set server.monitor.enabled false   # set on ovh-n0001 shared config
```

> Rejected alternative: auto-election lock (each instance races for the monitor with failover). Over-engineering — PM2 restarts a dead monitor and the monitor catches up on start (idempotent), so no hot-standby is needed. Request-serving redundancy ≠ the monitor needing a hot standby.

---

## Storage-safety validation (why the fleet swap is safe)

`serve wallet` → `1sat serve` on the fleet is a storage-safe swap:

1. **No schema migration on boot.** `migrate()` runs unconditionally but is idempotent; the migration set is identical between deployed `@1sat/wallet-node@0.0.52` and new `0.0.60` (15 migrations, same names). Every one is already recorded in `account_wallet.knex_migrations`, so all are skipped. No DDL, no data migration.
2. **Storage lib fork→official is a safe drop-in.** Deployed pins fork `@bopen-io/wallet-toolbox@2.1.21-parity-fix.2`; new pins official `@bsv/wallet-toolbox@2.1.24`. The fork's entire delta is 3 files, all present in `2.1.24` (PR #151). The only pg-path change (`EntityTransaction.mergeFind`) is functionally identical; the other two are IndexedDB-only.
3. Wallet RPC `POST /` + `/account/*` are the **same dispatch code** in `serve wallet` and unified.

---

## nginx changes (delta from the cluster-deploy doc)

Hand-written by the operator. `wallet.1sat.app` upstream block is unchanged (still 8101-8104; the instances behind it just became unified).

- **`messagebox.1sat.app`**: repoint `proxy_pass` from `127.0.0.1:8771` to the `wallet_backend` upstream. Add WebSocket upgrade headers for `/socket.io/` (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_http_version 1.1;`). WS has no consumers yet, but the headers are harmless for HTTP.
- **Paymail (`api.1sat.app`, `paymail.1sat.app`, `1sat.app`)**: cut `proxy_pass` from Go `8084` to `wallet_backend`. The TS host serves capabilities at root `/bsvalias/*` (not Go's `/1sat/bsvalias/*`) and advertises `server.paymail.baseUrl` in the discovery doc — so drop the hardcoded `Host api.1sat.app` rewrite and set `baseUrl` to the intended paymail domain. Apex `1sat.app` keeps its narrow location set (only `/.well-known/bsvalias`; everything else 302→www).
- **Global on the consolidated blocks**: `client_max_body_size 30m` (unified body limit is 30 MB). The unified server sets wide-open CORS itself — don't add a second CORS layer at nginx. `GET /docs` + `/openapi.json` are public (swagger auto-on) — block them at nginx if the API surface shouldn't be advertised.

---

## Cutover rule (validated resilience)

The wallet **client** is safe if messagebox is briefly down: unlock/balance/outputs/normal sends don't touch it, and the paymail inbox poll (`syncMessages`) is fire-and-forget, caught, self-healing.

The caveat is the paymail **receive** path: the host broadcasts the tx *then* delivers to messagebox, so **paymail-up + messagebox-down = HTTP 500 after broadcast → sender sees "failed," balance not decremented, retry double-sends.** In the unified process paymail + messagebox are the same process (die together → paymail fails *before* broadcast, clean). The window only exists during transition from the split (Go paymail 8084 + separate messagebox 8771).

→ **Move paymail and messagebox together; never leave paymail serving receives while its messagebox target is down.**

---

## Testing plan (staged; wallet storage last-touched, always rollback-able)

**Prereq:** publish a `@1sat/cli` that includes both this session's fixes — `server.monitor.enabled` and the `createHostServer` `/.well-known/auth` handshake mount (current local `0.0.83`, box runs `0.0.67`).

- **Phase 0 — parallel, zero wallet risk.** Stand up one `1sat serve` on a spare port against a **separate** host storage DB and a test/staging domain. E2E the host pack: subscribe (402 → receipt in `HOSTING_BASKET`) → publish an OpNS name (PushDrop bind) → paymail resolve returns the identity key → P2P pay → inbox delivery. Nothing on `wallet.1sat.app` is touched.
- **Phase 1 — fleet swap (the sensitive one).** Swap **one** `serve wallet` instance to `1sat serve` (monitor off), leave it in the upstream. Watch `pm2 logs wallet-server` and run a wallet smoke test via `@1sat/cli` against a test wallet (createAction / listOutputs / signAction). RPC is byte-identical, so this should be invisible. Green → roll the other three. Rollback = restart the instance on `serve wallet@0.0.67`.
- **Phase 2 — messagebox.** Repoint `messagebox.1sat.app` → `wallet_backend` (+ WS headers). Keep the old `8771` process warm. Verify inbox sync from yours-wallet; a brief outage is client-safe. Rollback = revert the nginx block.
- **Phase 3 — paymail (move with messagebox).** Cut `api`/`paymail`/apex → `wallet_backend`; keep Go `8084` as fallback. Verify `/.well-known/bsvalias`, a capability resolve, and a real P2P send + receive (recipient inbox internalizes). Rollback = revert the nginx blocks to `8084`.

---

## Files / artifacts

- [`packages/cli/src/config.ts`](../../packages/cli/src/config.ts) — `ServerMonitorConfig` + `server.monitor` (done this session).
- [`packages/cli/src/commands/serve.ts`](../../packages/cli/src/commands/serve.ts) — `runMonitor` gate (done this session).
- [`packages/wallet-server/src/createHostServer.ts`](../../packages/wallet-server/src/createHostServer.ts) — mount the BRC-104 `/.well-known/auth` handshake (done this session). **Required pre-publish**: the unified host mounts auth per-route (not globally like `serve wallet`), so without this it 404s the handshake and serves *no* remote wallet client. Caught by the local yours-wallet test.
- `ovh-n0001:~/Code/pm2/wallet.config.js` — change `wallet-server` args `serve wallet` → `serve`; keep `wallet-monitor` as `serve monitor`; bump the pinned `@1sat/cli` version (deploy artifact).
- `ovh-n0001:/etc/nginx/sites-enabled/{messagebox,api,paymail,1sat}.1sat.app` — repoint + WS/body headers (deploy artifacts).

## Out of scope

- Multi-box scaling. Single-box today, so the filesystem PID lock + one `serve monitor` is right; multi-box would move monitor election to a Postgres advisory lock (all instances share `account_wallet`).
- Auto-election monitor lock (rejected above).
- Merging storage metering into the host pack.
