# Deploy @1sat/cli 0.0.124 to ovh-n0001 (wallet.1sat.app)

Upgrades the wallet storage server from `@1sat/cli` 0.0.104 to 0.0.124. On first start the new
version applies these `account_wallet` migrations:

- `2026-04-30-001` `wasBroadcast` / `rebroadcastAttempts` on `proven_tx_reqs` (plus a backfill UPDATE)
- `2026-07-14-002`, `2026-08-02-001`, `2026-08-17-001` indexes (built `CONCURRENTLY`)
- `2026-08-30-001` BRC-177 `noSendExpiry*` columns + 2 indexes on `transactions`
- `2026-09-30-001` removes the 37 duplicate `sync_states` pairs, adds a unique index
- `2026-09-30-002` re-files legacy `p 1sat …` baskets for every user (85,806 outputs in `p 1sat ordinals`)

The migrations run inside startup (`createNodeWallet` → `storage.migrate()`) with no lock, so only
one process may start first.

## Current layout (surveyed 2026-09-30)

| Item | Value |
|---|---|
| PM2 apps | `wallet-host` (cluster ×4, ids 67–70, `serve`), `wallet-monitor` (fork, id 71, `serve monitor`) |
| Ecosystem | `/home/gorillapool/pm2/wallet.config.js` (loads `~/.1sat/cli/wallet.env` at load time) |
| Script | `node /home/gorillapool/Code/1sat-cli/node_modules/@1sat/cli/dist/cli.js` (npm project, `package-lock.json`, `"@1sat/cli": "^0.0.104"`) |
| Runtime | Node v22.23.1 (`/usr/bin/node`), npm 10.9.8 |
| Listen | PM2 cluster master on 127.0.0.1:8100; nginx `wallet_backend` → 8100 for `wallet.1sat.app` and `messagebox.1sat.app` |
| Database | `account_wallet` 2.8 GB, via HAProxy `localhost:5000` → Patroni leader `postgres01` (this box, PG 16.14), replica `postgres03` |
| Backup tools | `pg_dump` 16.14 in `/usr/sbin`; no existing backup covers `account_wallet`; precedent dir `~/predeploy-backups/20260806/` |
| Disk | 4.0 TB free on `/dev/md3` (`/`, `/home`, `/backup`) |

The `wallet-host` restarts (310 of 314 since 09-03) are PM2's 1G `max_memory_restart`, triggered by
`listOutputs` calls with `include: 'entire transactions'` and up to 10,000 outputs. This deploy raises
the cap to 5G; the per-call limit is a follow-up (below). Because a restarted worker loads whatever is
installed, the new version is installed only after the apps are stopped.

## Prepare (services keep running)

1. Ecosystem file: raise the cap and keep a copy of the current file for rollback.
   ```bash
   cd ~/pm2 && cp wallet.config.js wallet.config.js.bak.0.0.104
   sed -i 's/max_memory_restart: *.1G./max_memory_restart: "5G"/' wallet.config.js
   diff wallet.config.js.bak.0.0.104 wallet.config.js
   ```
   The file is only read on `pm2 start|reload`, so the running apps are unaffected.
2. Pre-fetch the package so the in-window install is quick: `npm cache add @1sat/cli@0.0.124`.
3. Record counts for the after/before comparison (read-only):
   ```sql
   SELECT count(*) FROM knex_migrations;                                  -- 15
   SELECT count(*) FROM sync_states;                                       -- 2134
   SELECT b.name, count(*) FROM outputs o JOIN output_baskets b USING ("basketId")
    WHERE b.name LIKE 'p 1sat %' OR b.name = 'ordinals' GROUP BY 1;
   ```

## Backup

`pg_dump` 16.14 in custom format, taken after the services stop so it matches the state the
migrations start from:

```bash
mkdir -p ~/predeploy-backups/20260930
pg_dump "postgres://onesat@localhost:5000/account_wallet?sslmode=disable" \
  -Fc -f ~/predeploy-backups/20260930/account_wallet.dump
pg_restore -l ~/predeploy-backups/20260930/account_wallet.dump | head   # readable?
ls -lh ~/predeploy-backups/20260930/
```

The password is the one in `~/.1sat/cli/config.json` → `server.storage.dbUrl`; supply it via
`PGPASSWORD` or `~/.pgpass`, not the command line. Also keep the current install:
`cp -a ~/Code/1sat-cli ~/predeploy-backups/20260930/1sat-cli-0.0.104`.

## Window (wallet.1sat.app and messagebox.1sat.app are down from step 1 to step 5)

1. Stop both apps: `pm2 stop wallet-host wallet-monitor`
2. Backup (above).
3. Install 0.0.124 in place (updates the `^0.0.104` pin in package.json):
   ```bash
   cd ~/Code/1sat-cli && npm install @1sat/cli@0.0.124
   node node_modules/@1sat/cli/dist/cli.js --version        # 0.0.124
   ```
4. Start the monitor alone; it runs the migrations, then start the hosts:
   ```bash
   pm2 delete wallet-monitor && pm2 start ~/pm2/wallet.config.js --only wallet-monitor
   pm2 logs wallet-monitor --lines 100
   # wait until knex_migrations has 22 rows
   pm2 delete wallet-host && pm2 start ~/pm2/wallet.config.js --only wallet-host
   ```
   `delete` + `start` from the file applies the new cap and re-reads `wallet.env`.
5. Verify, then persist:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://wallet.1sat.app/        # 401 unauthenticated
   pm2 logs wallet-host --lines 200 | grep -iE 'error|rpc_error'
   pm2 save
   ```
   Re-run the counts: 22 migrations; no duplicate `sync_states` pairs; no outputs left in legacy
   baskets. Then test the yours-wallet build (`dave/storage-repair-basket-migration`).

## Rollback

- Code only: stop both apps, restore `~/predeploy-backups/20260930/1sat-cli-0.0.104` over
  `~/Code/1sat-cli`, `pm2 delete wallet-host wallet-monitor && pm2 start ~/pm2/wallet.config.js`. 0.0.104
  runs against the migrated schema (new columns are nullable and ignored; the `sync_states` unique
  index only turns its insert race into a retry).
- Data: stop both apps, `pg_restore --clean --if-exists` the dump, start 0.0.104 as above.
- The 2.14 client in the new yours-wallet build cannot unlock against 0.0.104, so a code rollback
  means the extension build under test stops working until the server is upgraded again.

## Follow-up (after this deploy)

- wallet-server: cap `listOutputs` at 100 per call when `include: 'entire transactions'` is requested.
- 1sat-sdk actions (BSV21 send `tokens/index.ts`, unlock `locks/index.ts`) and yours-wallet: page
  those calls within the same limit; select inputs first, then fetch BEEF for the chosen txids.
- StoragePg: return BEEF as `Uint8Array` (base64 on the wire) and batch tag/proof loading.
