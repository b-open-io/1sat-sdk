# Deploy StorageKnex wallet storage to ovh-n0001 (wallet.1sat.app)

Run every step on the server through the script:

```bash
ssh -t ovh-n0001 '~/pm2/deploy-storageknex.sh preflight'
ssh -t ovh-n0001 '~/pm2/deploy-storageknex.sh prepare'
ssh -t ovh-n0001 '~/pm2/deploy-storageknex.sh window'
ssh -t ovh-n0001 '~/pm2/deploy-storageknex.sh rollback'   # only if needed
```

Script: `2026-10-01-storageknex-deploy.sh` (this directory). Schema conversion details and the
local rehearsal: `2026-10-01-storagepg-to-storageknex-migration.md`.

## What changes

- `@1sat/cli` 0.0.125 → `VERSION` (not yet published). The new build opens `account_wallet` with
  wallet-toolbox `StorageKnex` (`@1sat/wallet-node` `StorageKnexPg`) instead of StoragePg.
  Toolbox: `@bsv/wallet-toolbox` → `npm:@bopen-io/wallet-toolbox@2.14.5`.
- Storage RPC moves out of `wallet-host` into a new PM2 app, `wallet-storage` (`1sat serve storage`,
  cluster ×4, `127.0.0.1:8110`). It is the toolbox `StorageServer` with nothing of ours in the
  request path: no capacity gate, no dbtype filter. `wallet-host` (`1sat serve`, `127.0.0.1:8100`)
  keeps `/account/*`, paymail, messagebox, `/exchange-rate` and the OpenAPI docs, and no longer
  answers `POST /`.
- nginx: `wallet.1sat.app` → `wallet-storage`, except `/account/` → `wallet-host` (clients call
  `<storage url>/account/status|payment|register|profile`). `messagebox.1sat.app` and `1sat.app`
  stay on `wallet-host`. Operator step during the window; see "nginx".
- BRC-104 sessions: both apps use `server.sessionStore.redisUrl` (already set) and the same server key,
  so a handshake on `wallet.1sat.app` made against `wallet-storage` also authenticates
  `/account/*` on `wallet-host`, and any of the 4 storage workers accepts it.
- `account_wallet` schema: converted by
  `1sat-sdk/scripts/migrations/2026-10-01-storagepg-to-storageknex.sql` (one transaction), then
  `StorageKnex.migrate` on first start adds 8 toolbox migrations (7 new tables, plus the managed-change
  default update on `default` baskets). StoragePg cannot run on the converted schema (13 `smallint`
  flags become `boolean`), so the code switch and the conversion happen in the same window.
- `~/.1sat/cli/config.json`: `server.trustProxy = "loopback"`.

## Current layout (surveyed 2026-10-01, read-only)

| Item | Value |
|---|---|
| PM2 | `wallet-monitor` (fork, id 83, cwd `~`, `serve monitor`), `wallet-host` (cluster ×4, ids 84–87, cwd `~/pm2`, `serve`), both `max_memory_restart` 5G |
| Install | `~/Code/1sat-cli` (npm project, `"@1sat/cli": "^0.0.125"`), run with `node`; Node 22.23.1, npm 10.9.8 |
| Config | `server.storage` = `pg`, `onesat@localhost:5000/account_wallet` (HAProxy → Patroni leader, PG 16.14); no pool settings |
| Database | 2975 MB, 22 `knex_migrations` rows; role `onesat` owns the tables, not superuser, no CREATEDB |
| nginx | `wallet.1sat.app`, `messagebox.1sat.app`, `1sat.app` → `127.0.0.1:8100`; sets `X-Forwarded-For $proxy_add_x_forwarded_for`; DNS points straight at the box (no CDN) |
| Tools | `pg_dump`/`pg_restore`/`psql` 16.14 in `/usr/sbin`; 4.1 TB free |

`wallet-monitor` rewrites `config.json` every 15 minutes (repricer: `server.exchangeRate`,
`server.accounts.satsPerUnit`); the script writes the file atomically and re-checks `trustProxy`
after the apps stop.

## trustProxy

`"loopback"`, read by `serve storage` only. The toolbox `StorageServer` sets Express `trust proxy` from it and keys its
pre-auth rate limit (300 POST/min per worker) on `req.ip`. nginx on this host connects from
127.0.0.1 and appends the client address to `X-Forwarded-For`, so trusting loopback gives the real
client address; addresses a client puts in `X-Forwarded-For` itself are not trusted. Unset, every
request counts against 127.0.0.1.

## Before you start

1. Publish the new `@1sat/cli` from the laptop and set `VERSION` at the top of the script.
2. Copy the files (from `1sat-sdk/`):
   ```bash
   ssh ovh-n0001 'mkdir -p ~/pm2/storageknex'
   scp docs/plans/2026-10-01-storageknex-deploy.sh ovh-n0001:pm2/deploy-storageknex.sh
   scp scripts/migrations/2026-10-01-storagepg-to-storageknex.sql \
       scripts/migrations/storageknex-schema-describe.sql \
       scripts/migrations/2026-10-01-storageknex-schema.expected.txt ovh-n0001:pm2/storageknex/
   shasum -a 256 scripts/migrations/2026-10-01-storagepg-to-storageknex.sql \
       scripts/migrations/storageknex-schema-describe.sql \
       scripts/migrations/2026-10-01-storageknex-schema.expected.txt
   ```
   Preflight prints the server-side hashes to compare. The expected schema file must come from the
   toolbox build being deployed (26 migrations). It was regenerated against `2.15.0-bopen.2` (same build as `2.14.5`) on
   2026-10-01 (empty Postgres 17 database, `StorageKnexPg.migrate`) and matches the committed file
   unchanged: 26 migrations, last `2026-09-16-001 add auth message replay claims`, the 8 toolbox
   migrations below, `settings.dbtype` = `Postgres`. bopen.2 has no sync-states migration, so the
   conversion SQL's assumptions hold: it deletes StoragePg's `2026-09-30-001 unique sync state per
   storage identity` row and keeps the `sync_states_user_storage_identity` index.
3. Add the `wallet-storage` app to `~/pm2/wallet.config.js` (next to `wallet-host`; same `PATH` and
   `walletEnv` as the other entries). Preflight and the window check it; PM2 does not start it until
   the window.
   ```js
   {
     name: "wallet-storage",
     script: "/home/gorillapool/Code/1sat-cli/node_modules/@1sat/cli/dist/cli.js",
     args: "serve storage",
     interpreter: "node",
     exec_mode: "cluster",
     instances: 4,
     max_memory_restart: "5G",
     env: { NODE_ENV: "production", PATH, ...walletEnv, ONESAT_PORT: 8110 },
   },
   ```
   `ONESAT_PORT` overrides `server.port` (8100, which `wallet-host` keeps). No monitor runs in it.
4. Prepare the nginx change below (do not apply it until the window asks).

## nginx

`/etc/nginx/sites-available/wallet.1sat.app` holds the `wallet_backend` upstream (127.0.0.1:8100)
used by `1sat.app`, `wallet.1sat.app` and `messagebox.1sat.app`. Only `wallet.1sat.app` changes. If it
shares a `server` block with the other two names, first give it its own block (copy the block, keep
only `wallet.1sat.app` in `server_name`). Keep a copy of the current file for rollback.

```nginx
upstream wallet_storage {
    server 127.0.0.1:8110;
    keepalive 32;
}

server {
    server_name wallet.1sat.app;
    # ...existing listen / ssl / log lines unchanged...

    # Account routes stay on the host. Same proxy_set_header lines as the existing location.
    location /account/ {
        proxy_pass http://wallet_backend;
        # ...existing proxy_set_header / proxy_http_version lines...
    }

    # Storage RPC (POST /, PUT /action-batch/*, /.well-known/auth, GET /, /healthz).
    location / {
        proxy_pass http://wallet_storage;   # was http://wallet_backend
        # ...existing proxy_set_header / proxy_http_version lines...
    }
}
```

`X-Forwarded-For $proxy_add_x_forwarded_for` must stay on the `wallet_storage` location (rate limits
key on it). `client_max_body_size` must stay at least 8m (StorageServer's JSON and binary body
limits). Apply with `sudo nginx -t && sudo systemctl reload nginx` when step 8 of the window asks.

## preflight (read-only, safe any time)

Tools, PM2 status, installed version = 0.0.125, the three apps at 5G and the `wallet-storage` entry
(`serve storage`, `ONESAT_PORT` 8110), disk, SQL files and hashes, config (password hidden;
`server.sessionStore.redisUrl` must be set), database size/state (must be unconverted, 22 migrations), open
connections, row counts. Then `npm cache add @1sat/cli@VERSION` and a scratch install (copy of
`package.json` + `package-lock.json` in a temp dir, removed afterwards) that must show:

- `@1sat/cli` = `VERSION`
- exactly one wallet-toolbox in the tree: `node_modules/@bsv/wallet-toolbox` =
  `@bopen-io/wallet-toolbox@2.14.5` (`npm ls @bsv/wallet-toolbox` is printed too)
- every `@1sat/wallet-node` copy has `dist/storage-knex-pg.js`

## prepare (services keep running)

- Copies `~/Code/1sat-cli` to `~/predeploy-backups/storageknex/1sat-cli-0.0.125`.
- Copies `config.json` to `~/predeploy-backups/storageknex/config.json.pre-storageknex`, sets
  `server.trustProxy`, prints the diff. 0.0.125 ignores the key.

## window (downtime: wallet.1sat.app, messagebox.1sat.app, 1sat.app paymail)

| Step | What | Expected time |
|---|---|---|
| 1 | `pm2 stop` both; wait until no other connections to `account_wallet`; re-check `trustProxy` | < 1 min |
| 2 | Row counts → `counts.before`; `pg_dump -Fc` → `account_wallet.pre-storageknex.dump`; TOC must list 18 tables | ~3 min (the 09-30 dump took ~3 min) |
| 3 | `npm install @1sat/cli@VERSION` in place; same tree checks as preflight | < 1 min |
| 4 | Conversion SQL (prints `altered <table> in <ms>`); state must be converted, 18 migrations | 18–33 s in rehearsal; budget 2 min |
| 5 | Start `wallet-monitor` alone; wait for `2026-09-16-001 add auth message replay claims` | seconds |
| 6 | Gate (hosts not started on failure): 26 migrations, none of the 4 StoragePg-only names, the 8 toolbox ones present, lock free, `settings.dbtype` = `Postgres`, no `smallint`/identity columns, `sync_states_user_storage_identity` unique index present, every sequence ≥ max(id), row counts identical to `counts.before`, schema matches the expected file except that index | < 1 min |
| 7 | Start `wallet-storage`, wait for 127.0.0.1:8110 (`GET /` = StorageServer banner); start `wallet-host`, wait for 127.0.0.1:8100; `pm2 save` | < 1 min |
| 8 | Operator applies the nginx change ("nginx"), script waits for `yes` | 1–2 min |
| 9 | `wallet.1sat.app`: `GET /` banner, `/healthz` 200, unauthenticated `POST /` 401 with `RateLimit` headers, unauthenticated `/account/status` 401 (host); messagebox and `1sat.app/.well-known/bsvalias` status; `trustProxy`; error lines in the three apps' new logs (new PM2 ids, so fresh log files) | 30 s |

Total downtime about 8–10 minutes; budget 15. Every run is kept in
`~/predeploy-backups/storageknex/` (`counts.*`, `schema.after.txt`, `schema.diff`).

If the window stops:

- Before or during step 4: the database is unchanged (the conversion is one transaction). Run
  `rollback`; it detects this and only restores the old install and config.
- After step 4: run `rollback` (restores the dump), or fix and continue by hand from the failed step.

## rollback

Starting 0.0.125 alone is not enough after step 4: StoragePg's SQL fails on the converted schema.
The script checks the database state and:

1. Asks the operator to put `wallet.1sat.app` back on `wallet_backend` for every path (0.0.125 serves
   storage RPC from `wallet-host`). Deletes `wallet-storage`, stops the other two apps, waits for
   connections to close.
2. If converted: in one transaction, drops every table and sequence in the schema and replays the
   dump (`pg_restore -f - | psql`), then `ANALYZE`. Checks the StoragePg schema is back (22
   migrations) and the row counts equal `counts.before`. A failure rolls the whole restore back.
3. Restores `~/Code/1sat-cli` from `1sat-cli-0.0.125` and `config.json` from the prepare-time copy
   (repricer values revert to that time; the monitor updates them again).
4. Starts monitor, then hosts; `pm2 save`. Remove the `wallet-storage` entry from the ecosystem.

`pg_restore --clean --if-exists` is not used: on the converted schema the renamed foreign keys and
the new toolbox tables keep `users`/`outputs` from being dropped (reproduced locally), and `onesat`
cannot create or rename databases, so the restore-into-new-database route in the migration runbook
is not available either.

Timing: not measured on production. The rehearsal restored the ~2 GB dump in 28 s with `-j 8` on a
laptop; this restore is single-threaded and runs through HAProxy with one replica, so expect a few
minutes. Budget 10 minutes for the restore, 15 for the whole rollback. Writes made after the window
are lost.

## After the deploy

- Watch `pm2 logs wallet-storage`: the StorageServer logs one JSON line per RPC
  (`"source":"StorageServer POST handler"`) and collapses internal errors to `WERR_INTERNAL`.
- Toolbox clients older than 2.15 (`@bsv/wallet-toolbox(-client)` 2.14.x, e.g. a yours-wallet build
  from before the bopen alias) reject storage whose `settings.dbtype` is `Postgres`
  (`"Wallet storage returned invalid settings."` on `makeAvailable`). `wallet-storage` reports
  `Postgres` and has no filter, so those clients cannot connect until they upgrade.
- The accounts capacity gate is gone: storage writes are no longer refused for over-capacity
  accounts. `/account/status` still reports usage and `/account/payment` still sells capacity.
- Clients that synced from the StoragePg server may be missing rows: StoragePg's paged sync queries
  had no `ORDER BY`, so full syncs skipped some rows (rehearsal: 42,359 of 237,526 output tag maps
  for the largest wallet). Incremental sync does not resend them. Affected wallets need one full
  resync; in yours-wallet, Repair Sync does a full read.
- Remove `~/predeploy-backups/storageknex/` once the new version has run cleanly for a while.
