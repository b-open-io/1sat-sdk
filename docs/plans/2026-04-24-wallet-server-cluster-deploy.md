# Wallet-server on ovh-n0001: PM2 cluster + nginx sticky routing

> **Note on location**: Per the user's CLAUDE.md, project artifacts should live in the project filesystem, not `~/.claude/plans/`. Plan mode's harness required writing here. Propose relocating to `1sat-sdk/docs/plans/wallet-server-cluster-deploy.md` after plan approval.

## Context

`wallet.1sat.app` on ovh-n0001 currently runs a single `bunx @1sat/cli@0.0.47 serve` process bound to `127.0.0.1:8100`. Under load, this is a single-core bottleneck. We want to scale to N worker processes on one box without breaking the BRC-100 auth session cache that each worker holds in memory.

### Why stickiness (not shared sessions)

The `@bsv/auth-express-middleware` middleware caches post-handshake `PeerSession` state in an in-memory `Map` (default `SessionManager` from `@bsv/sdk`). The interface is synchronous, so swapping in Redis would require either (a) porting the middleware into 1sat-sdk or (b) an upstream PR to make the `SessionManager` interface async — both larger projects than the current problem warrants.

Stickiness sidesteps the whole question: if every request from a given peer always lands on the same worker, that worker's in-memory cache is authoritative for that peer. Multi-request handshakes (including certificate flows) stay on one worker. Worker restarts cause the peers routed to that worker to re-handshake on their next request — a protocol-level recovery that's effectively invisible.

### Deployment shape

- 4× `1sat serve wallet` processes on ports 8101–8104 (PM2 fork mode)
- 1× `1sat serve monitor` process (PM2 fork mode, no HTTP binding)
- Nginx `wallet.1sat.app` upstream block with consistent hashing on `x-bsv-auth-identity-key` header
- Ad-hoc `bunx` process stopped

## Required code change: port override in CLI

The CLI reads `server.port` from `~/.1sat/cli/config.json` (default `8100`). There's no env var or CLI flag path today — see [serve.ts#L148-L149](1sat-sdk/packages/cli/src/commands/serve.ts#L148-L149) and [config.ts#L86-L95](1sat-sdk/packages/cli/src/config.ts#L86-L95). To assign a different port per PM2 instance, we add one env var override.

**File to modify**: `packages/cli/src/commands/serve.ts`
**Change in `resolveServe()`** (around [L149](1sat-sdk/packages/cli/src/commands/serve.ts#L149)):

```ts
port: Number(process.env.ONESAT_PORT) || server.port || DEFAULT_PORT,
```

That's the entire code change. One line, resolves precedence as env > config > default.

**Publish**: bump `@1sat/cli` patch version, publish to npm. Deployment then does `bunx @1sat/cli@<new> serve …`. Existing direct `import { createWalletServer }` consumers are unaffected.

**No wallet-server changes.** No new packages, no middleware fork, no Redis dependency.

## PM2 ecosystem file

**Location on ovh-n0001**: `~/Code/pm2/wallet.config.js` (matches the convention used for `stack.config.js` on rack).

```js
module.exports = {
  apps: [
    {
      name: 'wallet-monitor',
      script: 'bunx',
      args: '@1sat/cli@latest serve monitor',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'wallet-server',
      script: 'bunx',
      args: '@1sat/cli@latest serve wallet',
      interpreter: 'none',
      instances: 4,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      increment_var: 'ONESAT_PORT',
      env: {
        NODE_ENV: 'production',
        ONESAT_PORT: 8101,
      },
    },
  ],
}
```

`increment_var` makes PM2 assign `ONESAT_PORT=8101`, `8102`, `8103`, `8104` to the four `wallet-server` instances. The monitor process has no HTTP binding so it doesn't need a port.

**Start**: `pm2 start ~/Code/pm2/wallet.config.js && pm2 save`

All four wallet workers + the monitor share `~/.1sat/cli/` (same config, same key, same pg database). Postgres handles the concurrent connections. The monitor process holds the PID lock via [writeMonitorPid](1sat-sdk/packages/cli/src/commands/serve.ts#L239); wallet workers skip that path.

## Nginx change for `wallet.1sat.app`

**Current** (`/etc/nginx/sites-enabled/wallet.1sat.app`): single upstream `proxy_pass http://127.0.0.1:8100`.

**New**: upstream block with consistent hashing on the BRC-100 identity key header.

```nginx
upstream wallet_backend {
    hash $http_x_bsv_auth_identity_key consistent;
    server 127.0.0.1:8101;
    server 127.0.0.1:8102;
    server 127.0.0.1:8103;
    server 127.0.0.1:8104;
    keepalive 32;
}

server {
    listen 443 ssl;
    server_name wallet.1sat.app;
    access_log /var/log/nginx/wallet.1sat.app-access.log;
    error_log /var/log/nginx/wallet.1sat.app-error.log;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_certificate     /etc/letsencrypt/live/wallet.1sat.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wallet.1sat.app/privkey.pem;

    location / {
        client_max_body_size 100m;
        proxy_pass http://wallet_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host wallet.1sat.app;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name wallet.1sat.app;
    return 301 https://$server_name$request_uri;
}
```

Notes:
- `hash $http_x_bsv_auth_identity_key consistent;` — nginx lowercases header names, so this matches the `x-bsv-auth-identity-key` header BRC-103/104 peers send on every request.
- `consistent` uses ketama hashing so adding/removing upstream servers only reshuffles ~1/N of peers, not all of them.
- If a request arrives with no identity-key header (health check, etc.), nginx falls back to distributing across upstreams — correctness is unaffected because those non-auth paths don't use the session cache.
- `keepalive 32` + HTTP/1.1 without `Connection` header lets nginx reuse upstream connections.

**Apply**: edit the file, `sudo nginx -t`, `sudo systemctl reload nginx`.

## Cutover steps

In order:

1. Publish CLI patch with `ONESAT_PORT` env var support and wait for it to be on npm.
2. On ovh-n0001: stop the ad-hoc process (`kill 2230628` or matching pid at the time).
3. Write `~/Code/pm2/wallet.config.js`.
4. `pm2 start ~/Code/pm2/wallet.config.js`
5. Verify: `pm2 list` shows 5 online processes (1 monitor + 4 wallet), `ss -tlnp | grep 810` shows ports 8101–8104 listening.
6. Smoke-test one worker directly: `curl http://127.0.0.1:8101/health` (or whatever existing health endpoint the wallet-server exposes).
7. Update nginx config with the upstream block. `sudo nginx -t`, `sudo systemctl reload nginx`.
8. `pm2 save` so the config survives PM2 or box restart.
9. Verify via `wallet.1sat.app` from outside the box.

## Verification

- **Before vs after concurrency**: run a `wrk` or `hey` burst against `https://wallet.1sat.app/<known-endpoint>` with and without the change. With sticky routing, N peers should spread across N workers.
- **Session stickiness**: issue consecutive requests from one peer identity and confirm they consistently land on the same worker (check via per-worker logs or inject a response header like `X-Worker-Port` for debugging).
- **Worker restart recovery**: `pm2 restart wallet-server-1`; verify the peers that were sticky to that instance re-handshake and resume successfully on next request.
- **Monitor singleton**: `pm2 restart wallet-monitor`; verify only one monitor-loop instance is ever logging. `writeMonitorPid` should keep other processes out of that path.

## Files touched

- `1sat-sdk/packages/cli/src/commands/serve.ts` — one-line port override (code change)
- `1sat-sdk/packages/cli/package.json` — patch version bump
- `ovh-n0001:~/Code/pm2/wallet.config.js` — new file (deploy artifact)
- `ovh-n0001:/etc/nginx/sites-enabled/wallet.1sat.app` — upstream block added (deploy artifact)

## Explicitly out of scope

- Redis-backed `SessionManager` / shared session store. Deferred — stickiness solves the current problem without it.
- Porting `@bsv/auth-express-middleware` into 1sat-sdk. Deferred.
- Multi-box horizontal scaling. Would require revisiting stickiness at a proper L4/L7 LB; out of scope until the use case exists.
- 1sat-stack (Go) clustering. Unrelated to this plan — 1sat-stack stays single-instance as-is.
