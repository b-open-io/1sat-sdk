# StorageKnex switch — state and remaining work (2026-10-01)

Single source of truth for wrapping up. Work through "Remaining" in order.

## Decisions made (do not revisit)

- Wallet storage moves from our StoragePg + hand-written RPC to upstream `StorageKnex` (Postgres) served by upstream `StorageServer`, run standalone via `start()`.
- New CLI mode `1sat serve storage`. Reads the existing CLI config: storage from `server.storage.provider` (SQLite default, Postgres only when configured); Redis sessions only when `server.sessionStore.redisUrl` is set (production: 4 instances). No billing gate, no dbtype shim, nothing of ours in the request path.
- `1sat serve wallet` (old hand-written RPC) is removed. The host (`1sat serve`) keeps accounts, paymail, messagebox; it no longer serves storage RPC. Account billing gate dropped for now (account system being reworked).
- Redis stays for sessions (upstream `KnexSessionManager` exists but not used).
- Clients on upstream toolbox 2.13.2–2.14.4 reject `dbtype: 'Postgres'`. Released yours-wallet 5.1.0 is NOT affected (client 2.12.0 / bopen 2.6.2 have no check — verified). Only consumers of the 2026-09-30 `@1sat/*` releases are. Plan: release `1sat-sdk` on the new client BEFORE the server deploy. No masking.
- Signing fix: `@bsv/sdk` 2.8.11 rejects `createSignature` with both `data` and `hashToDirectlySign`. All 8 call sites now pass only `hashToDirectlySign` (byte-identical signatures). Permission module needs no change (it signs `useModule` transactions on the base wallet in `finishCreateAction`); only a comment was corrected in `permission-module/src/handlers.ts`.

## Upstream (ts-stack, fork shruggr/ts-stack)

| PR | State |
|---|---|
| bsv-blockchain/ts-stack#719 Postgres StorageKnex | Draft, reduced to minimal dialect fixes + paging ORDER BY fix + Postgres tests/CI; `??` bindings commented. Goal: get merged upstream. Branch `feat/storageknex-postgres` (main `ts-stack` checkout). adminStats stays MySQL-only. |
| #722 mountable StorageServer | Closed (not needed: StorageServer runs standalone). |
| #723 sync_states unique index | Closed (duplicates came from our StoragePg, not upstream). |

## Interim npm build

- Use `@bopen-io/wallet-toolbox@2.14.5` and `@bopen-io/wallet-toolbox-client@2.14.5` = upstream 2.14.4 + #719 only (same build as `2.15.0-bopen.2`). A prerelease version does not satisfy the `^2.14.4` peer ranges, so npm installed a second upstream copy; `2.14.5` does. Source: worktree `/Users/davidcase/Source/1sat/ts-stack-bopen2`, pushed as `fork/publish/bopen-wallet-toolbox-2.15-pg`.
- NEVER use `2.15.0-bopen.1` (contains #723; its migration fails on the converted production DB). Not deprecated on npm by user choice; just don't reference it.
- Stale ts-stack worktrees that can be removed when done: `ts-stack-bopen` (bopen.1), `ts-stack-storageserver-mount` (#722, has 3 unpushed local reverts), `ts-stack-syncstate-unique` (#723).

## 1sat-sdk working tree (`/Users/davidcase/Source/1sat/1sat-sdk`, master, ALL UNCOMMITTED — awaiting user review in editor)

- wallet-node: `StorageKnexPg` (`src/storage-knex-pg.ts`) replaces deleted `storage-pg.ts`; action batches no longer declined.
- wallet-server: `src/createStorageServer.ts` (upstream StorageServer standalone); `sessions/redisSessionManager.ts` rewritten as SDK `AsyncSessionManager` (no hydration middleware); `createHostServer.ts` without storage RPC/capacity gate; accounts gate removed; dispatch.ts/rpcBudgets.ts/toolboxRemoting.ts/createWalletServer.ts/createWalletRpcHandler.ts/createBearerServer.ts/resolvers deleted; paymail default avatar route `/bsvalias/default-avatar.svg` (paymail lib requires https avatar); test fixes.
- cli: `serve storage` mode; `serve wallet` removed; `binaryRequests: true` in `remote.ts`.
- wallet: `factory.ts` `binaryRequests: true`.
- templates + actions: signing fix (hash-only) + interpreter-validated tests.
- permission-module: one comment fix.
- package.json: npm aliases to `2.14.5` (peers stay `^2.14.4`), root overrides, `bun.lock` regenerated (one toolbox copy).
- Migration: `scripts/migrations/2026-10-01-storagepg-to-storageknex.sql` (+ describe SQL + expected schema). Schema-only, one transaction, idempotent. Re-rehearsed on a fresh production dump with bopen.2 (same build as 2.14.5) on PG 16: counts identical, sync walks complete for 5 users, 35–53 s. First StorageKnex start also runs upstream migrations (7 new empty tables; raises `minimumDesiredUTXOValue` 32→5000 on 1,903 `default` baskets).
- Deploy: `docs/plans/2026-10-01-storageknex-deploy.sh` + `.md` (new PM2 app `wallet-storage` ×4 on port 8110; nginx `wallet.1sat.app`: `/account/` → `wallet_backend`, `/` → new `wallet_storage` upstream; backup, conversion SQL, rollback = restore dump). Runbook: `2026-10-01-storagepg-to-storageknex-migration.md` (two lines out of date: "not run on 16", timing table only PG17).
- Tests at last run: wallet-server 77 pass; cli 95 pass (incl. e2e storage server, binary processSyncChunk, Redis 2-instance session sharing); wallet-node pg 1 pass; wallet 20; templates 112; actions src 93; permission-module 48.

## yours-wallet (`/Users/davidcase/Source/1sat/yours-wallet`, branch `dave/storage-repair-basket-migration`, UNCOMMITTED)

Storage reconcile (Repair Sync), per-account `dataVersion` + IndexedDB legacy-basket refile, xdelta3 Vite stub, toolbox-client alias (currently bopen.1 — must move to `2.14.5` via new `@1sat/*` releases), reconcile push pages 100 items / 1 MB.

## Remaining, in order

1. User reviews 1sat-sdk uncommitted changes in the editor.
2. Commit; release `@1sat/*` per `.claude/skills/sdk-publish` + npm-publish skill (npm login as `dcasegr`; open auth URLs in Chrome via `open`, NOT Safari).
3. yours-wallet: MUST FIX before release — security: `ADMIN_ORIGINATOR = chrome.runtime.id` (bare id) + `background.ts` accepting `message.originator === new URL(sender.origin).host` lets a page on a dotless host equal to the extension id pass as admin. Fix: derive isAdmin only from `sender.origin === 'chrome-extension://' + chrome.runtime.id`; give the toolbox a non-host-shaped admin value. Also from the review: `~reconcile` pseudo-identity leaves sync_states rows server-side; `ReconcileRecord` stores full key arrays in chrome.storage (store counts); confirm `updateOutput({ spentBy: undefined })` actually clears spentBy.
4. yours-wallet: bump to new `@1sat/*`, build, user tests against a local `1sat serve storage`.
5. User runs the deploy script on ovh-n0001 (`ssh -t ovh-n0001 '~/pm2/deploy-storageknex.sh window'`); set VERSION first. Claude only watches logs — never deploys.
6. Affected wallets run Repair Sync once (StoragePg's unordered paging skipped rows: e.g. 42,359 of 237,526 tag maps for the largest wallet).
7. Get #719 merged upstream; then switch aliases from `@bopen-io` to the upstream release.

## Deferred / known issues (not blocking)

- `wallet.1sat.app/account/*` is not routed (nginx sends all of wallet.1sat.app to `wallet-storage`); `/account/status` answers 404 and yours-wallet shows the provider as offline on Storage Status and in the provider picker. Next yours-wallet release: read account status from accounts.1sat.app.
- Fable review index: `docs/plans/2026-10-01-fable-review.md` (items 3–6, 11 are now moot after closing #722 and dropping the mount design).
- `listOutputs` with entire transactions: cap at 100 and page callers (`actions/src/tokens/index.ts`, `locks/index.ts`, yours-wallet).
- `/manifest.json` references an unserved `icon.png`.
- `commissions.satoshis` bigint→integer narrowing: check max before the window (script aborts if out of range).
