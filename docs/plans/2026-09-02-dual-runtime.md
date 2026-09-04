# Plan: `1sat serve` on Node and Bun (dual runtime)

Status: **Code complete, not deployed**
Date: 2026-09-02

## Why

n0001 runs four `bunx @1sat/cli serve` processes on ports 8101-8104 behind an
nginx upstream that hashes on the identity-key header. That layout dates from
April 2026, when BRC-104 sessions lived in per-process memory and stickiness
was the workaround. Redis-shared sessions landed in July (wallet-server
0.0.33), so any instance can now serve any peer and the hash is dead weight.

Bun cannot use pm2 cluster mode (it relies on Node's `cluster` module). Making
the CLI run under Node opens the simpler deployment: N workers on **one**
port, `pm2 reload` with zero downtime, and a single `proxy_pass` in nginx.
Bun stays the default dev runtime and keeps working.

## What was Bun-only

| Item | Fix |
|------|-----|
| CLI bin was the TypeScript source with a `bun` shebang; preinstall refused to install without Bun | `bun build --target=node --packages=external` → `dist/cli.js` with a `node` shebang. `bin`/`main` point at it. `engines: { node: ">=22.13", bun: ">=1.2" }`. Preinstall check removed. `build:bin` keeps the `--compile` binary. |
| `bun:sqlite` imported statically by the SQLite storage provider (and so by the wallet factory) | `wallet-node/src/sqlite-driver.ts`: `openSqlite()` picks `bun:sqlite` or `node:sqlite` via `process.getBuiltinModule` (synchronous in both runtimes, invisible to bundlers). Node driver wraps `DatabaseSync` behind the same `run` / `query().get|all` / `close` surface, uses `exec` for multi-statement schema blocks, and coerces booleans/undefined the way Bun does. |
| `bun:sqlite` dynamic import in the actions sync store | Same builtin-module selection inline (actions cannot depend on wallet-node). |
| `Bun.serve` in the bearer-only RPC server | Ported to `node:http`; handle gained `ready: Promise<number>` and a live `port` getter. |
| `Bun.stdin` in the MCP proxy | `for await (const chunk of process.stdin)`. |
| Extensionless relative imports in every package's tsc output (`from './errors'`) — Bun tolerates, Node ESM does not | Codemod added `.js` (or `/index.js`) to 600 relative specifiers across 156 files in the CLI's workspace closure: types, utils, client, templates, wallet, wallet-node, wallet-server, actions, cli. TypeScript's `bundler` resolution and Bun both map `./x.js` to `./x.ts`. **Convention going forward: relative imports carry `.js`.** |

Packages outside that closure (connect, react, extension, sdk, wallet-desktop,
permission-module) are browser/bundler targets and were left alone.

## Verification

- `packages/cli/scripts/node-smoke.mjs` (`bun run --filter @1sat/cli test:node`
  after a build): `node dist/cli.js help` loads, and `StorageBunSqlite`
  migrates + reads settings on `node:sqlite` in memory.
- `bun test` across the closure; `tsc --noEmit` clean in every closure package.
- Known pre-existing failures unrelated to this work: actions tests needing
  `TEST_WALLET_WIF`, and a cosign round-trip asserting `p 1sat` vs `onesat`.

## Deployment (not done — discuss first)

Target on n0001:

```
pm2 start "node $(npm root -g)/@1sat/cli/dist/cli.js serve" -i 2 --name wallet-server   # cluster mode, one port
pm2 start "... serve monitor" --name wallet-monitor
```

- `ONESAT_PORT` unset; all workers share `server.port` (8100).
- nginx `wallet_backend` → single `server 127.0.0.1:8100;`, drop the
  `hash $http_x_bsv_auth_identity_key` line (Redis sessions make it moot).
- Redis `sessionStore` stays required for multi-worker.
- Node on the box is 22.23.1 (`node:sqlite` unflagged since 22.13); prod uses
  Postgres so SQLite is only relevant for `1sat storage` maintenance commands.
- The `--compile` binary remains available for Bun-only installs.
