# mss1 Wallet Server Cutover

**Status: not started — ready to execute.**

Cut mss1 over from the embedded Go wallet (inside 1sat-stack on port 8082) to a standalone TS wallet server (`1sat serve wallet`) pointed at the same SQLite file the CLI already uses.

## Preconditions (verified 2026-04-20)

- Host: `ssh mss1` → `shruggr@mss1` (Fedora 43, Linux 6.18).
- `1sat-stack.service` (user systemd) runs from `/home/shruggr/workspace/1sat/stack` on port 8082.
- 1sat-stack source is on `master` at an older commit (`1fcbb6e`). Does **not** have `a9119f7` / `initRemote`. Needs `git fetch` + `git checkout wallet-server`.
- 1sat CLI is `/home/shruggr/workspace/1sat/1sat` → `bun src/cli.ts` from `/home/shruggr/workspace/1sat/sdk/packages/cli`. sdk is on `master` at `6c98a94`. Needs `git pull` to get commit `0dc0c6f`.
- CLI wallet data at `~/.1sat/cli/data/wallet-main.db`: 1 user (identity `037a8da3…3084af`), 12 transactions, 49 outputs, 34 UTXOs, 25 tags, 4 baskets. Schema is already wallet-toolbox Knex-style (`users`, `transactions`, `outputs` — no `bsv_` prefix). Matches what StorageBunSqlite / createNodeWallet expects.
- CLI key loaded via `ONESAT_PASSWORD` env var + `~/.1sat/cli/keys.bep`. Same path the server will use via `loadKey()`.
- `~/.1sat/wallet.sqlite` (the old Go-embedded wallet DB) is orphan — the CLI switched to local-active some time ago. Safe to ignore during cutover; delete afterwards if desired.
- No postgres installed. Staying on bun-sqlite.

## Port plan

- Stack (1sat-stack) stays on `8082`.
- Wallet server binds a fresh port. Default in code is `8100`. No current user of `8100` on mss1 (verify with `ss -tln | grep 8100` before start).

## Cutover steps

### 1. Update sources

```bash
ssh mss1
cd ~/workspace/1sat/sdk && git fetch origin && git checkout master && git pull --ff-only
bun install                                # picks up @1sat/wallet-server + new deps

cd ~/workspace/1sat/stack && git fetch origin && git checkout wallet-server && git pull --ff-only
# wallet-server branch has master merged in (commit 7a98f67)
```

Uncommitted bun.lock/landing-ui artifacts on stack are fine to leave in the working tree; they don't collide with `wallet-server`.

### 2. Rebuild stack binary

```bash
cd ~/workspace/1sat/stack
go build -o server ./cmd/server
```

(Don't `go run` — systemd executes `./server`.)

### 3. Write server config

```bash
# Bind to 0.0.0.0 so the Cloudflare tunnel can reach the port
1sat config set server.port 8100
1sat config set server.host 0.0.0.0
# Keep accounts off on mss1 (metering disabled for dev)
```

Nothing else needed — provider defaults to `bun-sqlite`, dbPath derives from `dataDir + chain`, server identity comes from `loadKey()`.

### 4. Stand up wallet-server as a systemd user unit

Create `~/.config/systemd/user/1sat-wallet-server.service`:

```ini
[Unit]
Description=1Sat Wallet Server (BRC-100 storage RPC)
After=network-online.target

[Service]
Type=simple
User=%u
Group=%g
WorkingDirectory=/home/shruggr/workspace/1sat
Environment="ONESAT_PASSWORD=<redacted — same value 1sat-stack.service uses>"
ExecStart=/home/shruggr/workspace/1sat/1sat serve wallet
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now 1sat-wallet-server.service
systemctl --user status 1sat-wallet-server.service
journalctl --user -u 1sat-wallet-server.service -n 50
```

Expected log: `[wallet] listening on 127.0.0.1:8100`.

### 5. Configure 1sat-stack to point at the TS wallet server

The wallet-server branch exposes wallet-mode settings in the stack's config store. Set via the admin UI or SQLite directly:

```bash
sqlite3 ~/.1sat/config.db <<SQL
INSERT OR REPLACE INTO config (key, value) VALUES ('wallet.mode', 'remote');
INSERT OR REPLACE INTO config (key, value) VALUES ('wallet.remote_url', 'http://127.0.0.1:8100/');
SQL
```

(Confirm the exact key names after `git pull` — they were defined in `a9119f7`.)

### 6. Point 1sat CLI at the local wallet server

```bash
1sat config set activeRemote http://127.0.0.1:8100/
1sat config unset backups              # drop the old http://127.0.0.1:8082/1sat/wallet entry
1sat config set backups '["https://api.1sat.app/1sat/wallet"]'
```

### 7. Restart the stack

```bash
systemctl --user restart 1sat-stack.service
journalctl --user -u 1sat-stack.service -n 100
```

Expected: stack logs a BRC-100 session to `127.0.0.1:8100` instead of spinning up the embedded wallet.

### 8. Verify

```bash
1sat wallet balance              # hits local wallet-server
1sat wallet utxos                # should still see the 34 UTXOs
1sat ordinals list               # existing ordinals surface
```

Stack-side: poke a paymail resolution endpoint that exercises the remote wallet (any request that previously touched `pkg/wallet`). Confirm no 500s.

## Rollback

If something breaks:

```bash
systemctl --user stop 1sat-wallet-server.service
# Revert stack config
sqlite3 ~/.1sat/config.db "DELETE FROM config WHERE key IN ('wallet.mode','wallet.remote_url');"
# Revert CLI remote
1sat config set activeRemote https://api.1sat.app/1sat/wallet
# Restore old stack binary (built from pre-cutover master)
cd ~/workspace/1sat/stack && git checkout master && go build -o server ./cmd/server
systemctl --user restart 1sat-stack.service
```

The SQLite wallet file is untouched during cutover — CLI commands still work against it directly as long as the wallet-server process isn't running.

## Things worth doing before prod

- **OPL-1905** — Secrets management. mss1 uses `ONESAT_PASSWORD` env via systemd unit file, which is acceptable for dev but not for prod.
- **Postgres provider path** — `server.storage.provider: knex-pg` errors out today ("not yet wired through the shared wallet factory"). Need a `createPgWallet` equivalent that applies `activeRemote`/`backups` the same way `createNodeWallet` does, so production deployments can use postgres without losing remote/active semantics.
- **Messagebox** — wallet-server branch paymail uses `MessageBoxClient` pointed at a remote messagebox URL. mss1 doesn't need one (dev). Production needs `go-messagebox-server` standing up separately; paymail config gets the URL.
- **Data migration on prod** — mss1 reuses the existing SQLite file because the server and CLI share one wallet there. Production servers will use postgres; migration is `WalletStorageManager.setActive(remoteIdentityKey)` from the CLI after adding the new server as a provider. Scripting this is a separate deliverable.

## References

- sdk commit `0dc0c6f`: `feat(wallet-server): TS wallet storage RPC server + CLI serve command`
- stack branch `wallet-server` (commit `7a98f67`)
- Plan reframe / decision log: `~/.claude/plans/it-was-but-i-calm-ripple.md`
- Original plan: [`2026-04-19-wallet-server.md`](./2026-04-19-wallet-server.md)
- Secrets ticket: [OPL-1905](https://linear.app/openprotocollabs/issue/OPL-1905/secrets-management-for-wallet-server-production-deployment)
