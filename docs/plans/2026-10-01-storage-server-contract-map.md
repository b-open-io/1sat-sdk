# Storage server contract map: upstream StorageServer 2.14.4 vs 1sat-sdk wallet-server

Date: 2026-10-01. Read-only research; no code changed.

## Scope and sources

Production runs `1sat serve` with no subcommand. `resolveMode` returns `'all'` (`packages/cli/src/commands/serve.ts:132-133`), and `startWalletServer` calls `createHostServer` (`serve.ts:429-455`). `createWalletServer` only runs for `1sat serve wallet` (`serve.ts:389-408`).

Reference abbreviations used in the tables:

| Tag | Path |
|-----|------|
| `SS` | `packages/wallet-server/node_modules/@bsv/wallet-toolbox/out/src/storage/remoting/StorageServer.js` (2.14.4) |
| `EP` | same dir, `edgePolicy.js` |
| `RL` | same dir, `RateLimitPolicy.js` |
| `BJ` | same dir, `BinaryJson.js` |
| `ST` / `KST` | same dir, `SyncTransfer.js` / `KnexSyncTransferStore.js` |
| `CB` / `SC` | same dir, `StorageClientBase.js` / `StorageClient.js` (client 2.14.4; the same code is bundled in `yours-wallet/node_modules/@bsv/wallet-toolbox-client/out/index.client.mjs`, checked at lines 22048-22058, 22300, 22400, 22826, 22851) |
| `AM` | `packages/wallet-server/node_modules/@bsv/auth-express-middleware/dist/src/index.mjs` (2.2.8) |
| `HS` | `packages/wallet-server/src/createHostServer.ts` (production path) |
| `WS` | `packages/wallet-server/src/createWalletServer.ts` |
| `RH` | `packages/wallet-server/src/createWalletRpcHandler.ts` |
| `D` | `packages/wallet-server/src/dispatch.ts` |
| `B` | `packages/wallet-server/src/rpcBudgets.ts` |
| `SM` | `packages/wallet-server/src/sessions/redisSessionManager.ts` |
| `EH` | `packages/wallet-server/src/errorHandler.ts` |
| `AG` | `packages/wallet-server/src/accounts/middleware.ts` |
| `PG` | `packages/wallet-node/src/storage-pg.ts` |

All `node_modules` paths resolve to one install: `node_modules/.bun/@bsv+wallet-toolbox@2.14.4+8b6459bf02b6411d` (wallet-server, wallet-node and cli all link to it; the package is CJS-only, single build).

Status values: **MATCH**, **DIFFERS**, **MISSING**, **N-A** (with reason).

## 1. HTTP layer

| # | Behaviour | Upstream | Ours (production `HS`) | Status |
|---|-----------|----------|------------------------|--------|
| 1.1 | JSON body parser | `express.json`, limit 8 MiB (standard profile, env `WALLET_STORAGE_JSON_MAX_BODY_BYTES`) `SS:318-324`, `EP:395-401` | `express.json({limit: '30mb'})` `HS:94` (`WS:103` same) | DIFFERS (30 MiB vs 8 MiB) |
| 1.2 | Octet-stream body parser (needed before auth so binary bodies are signed) | `express.raw({type:'application/octet-stream'})`, 8 MiB `SS:327-330` | none | MISSING (only used by the action-batch PUT routes, see 1.10) |
| 1.3 | Body-parser error handler | `bodyParserErrorHandler`: 413 `ERR_BODY_TOO_LARGE`, 400 `ERR_INVALID_BODY`, fixed descriptions `SS:331`, `EP:498-521` | Falls through to terminal handler `HS:242/260` → `EH:33-41`: status from `err.status`, body `{code:'ERR_INTERNAL', description: err.message}` | DIFFERS (wrong code; echoes raw error message). The `@bsv/paymail` router mounted at root (`paymail/routes.ts:342`) has its own error handlers, but Express 4 does not route app-level errors into a mounted router (router handle has arity 3), so `EH` is what answers. |
| 1.4 | CORS | `corsPolicy` public mode: `ACAO: *`, explicit methods `GET, PUT, POST, OPTIONS`, default allowed-header list plus reflected requested headers, explicit expose list incl. `X-BSV-Binary-Encoding`, `Max-Age 600`, OPTIONS → 204 `SS:301-305`, `EP:19-60, 229-310` | `corsMiddleware`: `ACAO/ACAH/ACAM/ACEH: *`, OPTIONS → 200 `WS:483-497`, mounted `HS:95` | DIFFERS (functionally permissive for non-credentialed fetch; no allowlist/disabled modes, no Max-Age) |
| 1.5 | Security headers | `securityHeaders`: nosniff, `X-Frame-Options DENY`, `Referrer-Policy no-referrer`, Permissions-Policy, COOP, CORP, CSP `default-src 'none'…`, HSTS when `req.secure` `SS:297-300`, `EP:343-394`; `x-powered-by` disabled `SS:295`; `X-Content-Type-Options` on every RPC `SS:511` | none; `x-powered-by` left on | MISSING |
| 1.6 | `json escape` / `escapeRpcJson` | `SS:152-155, 317, 458` | none | N-A in effect: the auth middleware replaces `res.json` with its own wrapper (`AM:338-342`, `stringifyBRC100`), and upstream passes `JSON.parse(serialized)` to it (`SS:524`), so the escaping is undone before signing. |
| 1.7 | Leading `//` normalisation | `initialDoubleSlashCompatibility` `SS:296`, `EP:407-411` | none | MISSING (low) |
| 1.8 | HTTP server timeouts | `configureHttpServer`: requestTimeout 120 s, headersTimeout 15 s, keepAlive 5 s, socket timeout 120 s, maxRequestsPerSocket 1000, maxConnections 1000 `SS:206-213, 902`, `EP:555-569` | `http.createServer(app)` with runtime defaults `HS:243/261`, `listen` `HS:288` | MISSING (see "not verified": runtime) |
| 1.9 | Trust proxy | `configureTrustProxy` only when option set `SS:294`, `RL:29-36` | not set | MATCH (upstream default is also unset; only feeds rate-limit IP keys and HSTS) |
| 1.10 | Routes: PUT `/action-batch/:batchId/pack`, PUT `/action-batch/:batchId/blob/:digest` | `SS:364-413` (auth required + active storage, 200 `{uploaded:true}`, errors 400 with `publicWalletErrorJson`) | none | N-A today: client only uses them after `getCapabilities` advertises action batches (`CB:372-408`); `StoragePg` inherits `supportsActionBatchPersistence() → false`, so `getCapabilities()` returns `{}` (`StorageProvider.js:206-212, 280-288`). Becomes MISSING if `PG` ever enables action batches. |
| 1.11 | POST `/` JSON-RPC | `SS:415` | `HS:147` (`WS:232`) | MATCH |
| 1.12 | GET `/healthz`, `/robots.txt`, GET `/` banner | `SS:332-343` (unauthenticated) | GET `/` serves OpenAPI docs (`openapi/index.ts:115`); no `/healthz`, no `/robots.txt` | DIFFERS / MISSING (no client depends on them) |
| 1.13 | Resource profiles (`small` / `standard` / `high-throughput`, env `WALLET_STORAGE_*`) | `SS:202-237`, `EP:79-112` | fixed constants `B:16-22`, `SM:167-170` (standard values except list limit) | DIFFERS (not configurable) |
| 1.14 | Telemetry spans | `SS:311-313, 417-429, 477-509` | evlog wide events `HS:93` | N-A (observability only) |
| 1.15 | `logShortReqs` | `SS:263-292` | none | N-A (legacy, off by default) |

## 2. Auth

| # | Behaviour | Upstream | Ours | Status |
|---|-----------|----------|------|--------|
| 2.1 | Middleware | `createAuthMiddleware({wallet, transportLimits:{maxResponseBytes}, sessionManager?})`, installed globally after the unauthenticated GETs `SS:344-351` | `buildAuthMiddleware` → `createAuthMiddleware({wallet, transportLimits, sessionManager?})` `SM:172-194`; mounted on POST `/`, `/.well-known/auth`, `/account`, messagebox router `HS:147, 153, 156, 234` | MATCH (one instance, shared session across surfaces) |
| 2.2 | `maxResponseBytes` | 8 MiB (= `maxRpcResponseBytes`) | 8 MiB `SM:168` | MATCH |
| 2.3 | `maxRequestBytes` | not passed → middleware default 8 MiB `AM:11, 437` | 16 MiB `SM:169` | DIFFERS |
| 2.4 | `requestTimeoutMs` / `maxPendingRequests` | not passed → 30 s / 1000 `AM:9-10` | not passed → same | MATCH |
| 2.5 | `allowUnauthenticated` | not set (false) → unsigned request gets 401 `UNAUTHORIZED` `AM:1119-1131` | not set | MATCH |
| 2.6 | Session manager | optional `KnexSessionManager` (DB-backed) via `options.sessionManager` | in-memory, or `RedisSessionManager` + hydration wrapper `SM:53-146` | DIFFERS (storage choice; same contract) |
| 2.7 | Identity binding | `requiredAuthenticatedIdentityKey(req)` rejects missing/empty/`'unknown'` with `WERR_UNAUTHORIZED` `SS:145-151` | `dispatchHandler` returns HTTP 401 `{code:-32000}` for missing/`'unknown'` `WS:264-277` | DIFFERS (unreachable in practice: the middleware already 401s unsigned requests) |
| 2.8 | Response must carry `x-bsv-auth-identity-key` | client rejects otherwise `CB:156-168` | set by the auth middleware | MATCH |
| 2.9 | Rate limiting | pre-auth 300/min/IP on non-GET `SS:307-310`; post-auth 1000/min per identity `SS:352-356`; 429 `ERR_RATE_LIMITED` with draft-8 headers `RL:7-28` | none | MISSING |
| 2.10 | Concurrency ceiling | 24 in-flight (standard), 503 `ERR_SERVER_BUSY` + `Retry-After: 1` `SS:306`, `EP:527-554` | none | MISSING |
| 2.11 | Payment middleware (`monetize`) | optional `createPaymentMiddleware` with `paymentReplayStore` `SS:357-363` | not used; `accountsCapacityGate` returns 507 for over-capacity billable calls `AG:363-511` (507 at `AG:465`) | N-A (different billing model; upstream default is off) |

## 3. Request decoding

| # | Behaviour | Upstream | Ours | Status |
|---|-----------|----------|------|--------|
| 3.1 | Binary request header | `X-BSV-Binary-Request-Encoding: base64` → `decodeBinaryJsonValue(req.body.params)` inside the handler, after auth `SS:432, 436` | `decodeBinaryRequest` after auth, before gate and dispatch, only when `params` is an array `HS:139-147`, `WS:240-252` (uncommitted change adds it to `HS`) | MATCH. Note: toolbox clients only send this header for `writeSyncTransferPart` or when constructed with `binaryRequests: true` (`CB:667-670`); `packages/wallet/src/factory.ts:180` does not set it. |
| 3.2 | JSON-RPC shape check | `jsonrpc==='2.0'`, non-empty string `method`, `params` array, else HTTP 400 `{error:{code:-32600}}` (no `jsonrpc`/`id`) `SS:437-439` | `isJsonRpcLike`: `jsonrpc` + string `method` only; non-array `params` silently becomes `[]` `WS:281-293, 310`, `WS:499-505` | DIFFERS |
| 3.3 | Request `id` | passed through unchanged | `normalizeJsonRpcId` (string/number else null) `WS:507-510` | MATCH for toolbox clients (numeric ids; client requires exact echo `BJ:269-288`) |
| 3.4 | Binary response opt-in | `X-BSV-Binary-Encoding: base64` → echo header, binary replacer `SS:431-434` | `WS:262, 344` | MATCH |

## 4. Method surface

| # | Behaviour | Upstream | Ours | Status |
|---|-----------|----------|------|--------|
| 4.1 | Allowlist | `storageRpcMethods` `SS:33-73` | `STORAGE_RPC_METHODS` `D:57-97` | MATCH (identical set) |
| 4.2 | Handler must exist on storage | `SS:670-672` | `D:192-195` | MATCH |
| 4.3 | Unknown method response | HTTP 400 `{jsonrpc, error:{code:-32601}, id}` `SS:446-451` | HTTP 200, same body `D:415-424`, `WS:328` | DIFFERS: client turns 400 into `Error('…network error 400')`; ours becomes a `WalletError` via `WalletErrorFromJson` (`SC:122-124, 138`) |
| 4.4 | AuthId methods | `authIdRpcMethods` `SS:89-118` | `AUTH_ID_METHODS` `D:104-133` | MATCH |
| 4.5 | Active-storage methods | `activeStorageRpcMethods` `SS:119-132` | `ACTIVE_STORAGE_METHODS` `D:136-149` | MATCH |
| 4.6 | `*Auth` routing | `findOutputBaskets→findOutputBasketsAuth`, `findProvenTxReqs→findProvenTxReqsAuth`, `updateProvenTxReqWithNewProvenTx→…Auth` `SS:663-669` | `AUTH_SCOPED_TARGETS` `D:152-156` | MATCH |
| 4.7 | AuthId binding | reject mismatched `identityKey`; `findOrInsertUser`; `params[0] = {...claimed, identityKey, userId, isActive, reqAuthUserId}` `SS:864-878, 851-863` | `D:338-356, 321-336` | MATCH (ours also requires `user.activeStorage != null` for `isActive`; equivalent) |
| 4.8 | `findProvenTxReqs` / `updateProvenTxReqWithNewProvenTx` | `params = [auth, params[0]]` `SS:787-793` | `D:289-296` | MATCH |
| 4.9 | Param0 validation (all other methods incl. `makeAvailable`, `getCapabilities`, `getSyncChunk`, `processSyncChunk`, `updateProvenTxReq…` not covered above) | `validateParam0`: default `{}`, reject mismatched `identityKey`, `findOrInsertUser`, set `reqAuthUserId`, overwrite `userId` when `identityKey` or `userId` present `SS:879-894` | `applyParam0Auth` `D:358-381` | MATCH |
| 4.10 | `getSettings` | no auth lookup `SS:777-778` | `METHODS_NO_AUTH` `D:158, 261-263` | MATCH |
| 4.11 | `findOrInsertUser` | `params[0] === identityKey` `SS:779-783` | `D:265-272` | MATCH |
| 4.12 | `adminStats` | `params[0]` (string) must equal identity and be in `adminIdentityKeys` `SS:811-819` | requires `params[0].identityKey` (object) `D:274-287` | DIFFERS (ours rejects the upstream argument shape; `HS` never sets `adminIdentityKeys`, so always unauthorized either way) |
| 4.13 | `destroy` / `migrate` | ignored, `result: null`, logged `SS:773-776, 804-810` | `METHODS_IGNORED` → `result: null` `D:197-199` | MATCH |
| 4.14 | Settings shaping (`makeAvailable`, `getSettings`) | spread result + `syncCheckpointVersion: 1` when `storage.getSyncCheckpoint` exists, + `syncTransfer` capabilities when a transfer store exists (StorageKnex only) `SS:679-687`; `dbtype` passed through | `settingsForWire`: drops `dbtype` unless `SQLite`/`MySQL`/`IndexedDB`, adds `syncCheckpointVersion: 1` when `getSyncCheckpoint` exists `D:238-252` | DIFFERS, required: `PG` stores `dbtype 'Postgres'` (`PG:1525-1536`) and the client rejects any other value (`CB:102-105`). `syncTransfer` not advertised → see section 7. `PG` inherits `getSyncCheckpoint` (`StorageReaderWriter.js:265-269`), so `syncCheckpointVersion` is advertised as upstream does. |
| 4.15 | Per-method budgets (`enforceRpcRequestBudgets`) | list limit default 1000 / max 1000, max offset 1,000,000, array items 1,000,000, nesting 64; `paged` normalisation; `offsets[]` normalisation; `getSyncChunk` `maxItems` and `maxRoughSize ≤ maxRpcResponseBytes` `SS:526-628` | `enforceRpcBudgets` `B:42-98` | DIFFERS: max list limit 10,000 (`B:18`, deliberate for BRC-100); array budget skips any array whose first element is a number (`B:167`) where upstream counts them; violations raise `WERR_INVALID_PARAMETER` (public) where upstream raises `TypeError`/`RangeError` (collapsed to `WERR_INTERNAL` by `publicWalletErrorJson`). Ours skips budgets for unknown and ignored methods; upstream runs them first. |
| 4.16 | `processSyncChunk` validation | `validateParam0` → `validateSyncChunkEntities(params[1])` → `validateSyncProofs(storage, provenTxs)` `SS:794-798` | `D:308-316` using the toolbox's own helpers via `toolboxRemoting.ts:36-47` | MATCH |
| 4.17 | Remote logger | `makeLogger(params[1].logger)`, group, return `result.log` when not origin `SS:827-850` | `D:383-413` | MATCH (cosmetic: ours logs `identity.userId`, which `dispatchHandler` never sets) |
| 4.18 | Billing gate | none | `BILLABLE_METHODS` (`createAction`, `processAction`, `internalizeAction`, `insertCertificateAuth`, `processSyncChunk`) `D:167-173`, `AG:363-511` | N-A (ours only) |

## 5. Response encoding

| # | Behaviour | Upstream | Ours | Status |
|---|-----------|----------|------|--------|
| 5.1 | Serializer | `stringifyJsonRpc(payload, useBinary)` `SS:458, 510` | same function `WS:338-349`, imported via `toolboxRemoting.ts:13-27` | MATCH |
| 5.2 | `syncChunkBinary` scope | `getSyncChunk` only, when binary negotiated `SS:453` | `getSyncChunk` only `D:217-219` | MATCH |
| 5.3 | `result ?? null` | `SS:457` | `D:221` | MATCH |
| 5.4 | Exactly three keys (`jsonrpc`, `id`, `result`/`error`) | `SS:457, 635-639` | `D:221, 415-441` | MATCH (client enforces, `BJ:269-288`) |
| 5.5 | Oversized response | RPC-level check: >8 MiB → HTTP 413 `{code:-32005}` `SS:460-463, 512-521`; for `getSyncChunk` with `syncTransferVersion: 1` → `{syncTransfer: manifest}` instead `SS:469-476` | no RPC-level check; the auth middleware's response wrapper turns >8 MiB into a signed HTTP 413 `ERR_RESPONSE_TOO_LARGE` `AM:315-396` | MATCH in effect: the client only reads the status (`/network error 413/`, `CB:14-16`) and shrinks `getSyncChunk` (`CB:631-653, 681-689`). The transfer-manifest branch is N-A until section 7 exists. |
| 5.6 | Success / error HTTP status | 200 for results and `WalletError` errors `SS:463, 629-640` | 200 `WS:328` | MATCH |

## 6. Errors

| # | Behaviour | Upstream | Ours | Status |
|---|-----------|----------|------|--------|
| 6.1 | Redaction | `publicWalletErrorJson`: `WalletError` subclasses pass; `WERR_INTERNAL`, `WERR_UNKNOWN`, non-WalletError → `WERR_INTERNAL` default `SS:83-88` | `marshalError` same rule `D:426-441` | MATCH. Relies on `instanceof WalletError` across `wallet-node` and `wallet-server`; one shared install locally (see "Not verified"). |
| 6.2 | Server-side logging of the original error | `logWalletError` to the RPC logger, console line per RPC `SS:641-659, 691-694` | `onError` → evlog `rpcCause`, `rpcCauseStack` `WS:302-306` | MATCH (different sink) |
| 6.3 | Errors outside the RPC handler | fixed-text handlers (`bodyParserErrorHandler`, CORS 403, rate-limit 429, busy 503) | `EH:11-43`: `description: err.message`, `code: 'ERR_INTERNAL'` for every status | DIFFERS (leaks raw messages; codes not distinguishable) |
| 6.4 | `RH` unauthorized | n/a | 401 with `err.message` `RH:146-161` | DIFFERS (internal bearer path only) |
| 6.5 | Express async errors | Express 4 (`4.22.3` installed); `dispatch` catches everything after the allowlist `D:201-229`; gate catches `AG:504-508` | same structure | MATCH |

## 7. SyncTransfer

Upstream: methods ending in `SyncTransfer` / `SyncTransferPart` go to `dispatchSyncTransfer` (`SS:443-445, 697-760`): `beginReadSyncTransfer` (re-runs `getSyncChunk` budgets and auth, stages the encoded chunk), `readSyncTransferPart`, `beginWriteSyncTransfer`, `writeSyncTransferPart`, `commitSyncTransfer` (decodes, checks wallet/storage identities, sets `requireMatchingCheckpoint`, runs `processSyncChunk` through normal dispatch, stores result), `releaseSyncTransfer`. The store exists only when `storage instanceof StorageKnex` (`SS:252-262`). Capabilities: `version 1`, `maxBytes 64 MiB`, `inlineBytes = min(6 MiB, jsonLimit/2, maxResp/2)` = 4 MiB, `partBytes = min(256 KiB, …)` = 256 KiB (`ST:13-14`).

Client side: `getSyncChunk` adds `syncTransferVersion: 1` and falls back to a staged download after shrinking fails (`CB:631-653`); `processSyncChunk` uploads through staging when the encoded chunk × expansion exceeds `inlineBytes` (`CB:608-620`, `754-787`). Without the capability the client sends `processSyncChunk` inline regardless of size.

| # | Behaviour | Upstream | Ours | Status |
|---|-----------|----------|------|--------|
| 7.1 | Transfer methods | `SS:697-760` | not in allowlist → -32601 | MISSING (consistent: not advertised, so clients never call them) |
| 7.2 | `syncTransfer` in settings | `SS:685` | not added `D:238-252` | MISSING |
| 7.3 | Large inbound `processSyncChunk` | staged above 4 MiB | inline only; bounded by auth `maxRequestBytes` 16 MiB and `express.json` 30 MiB. Client default sync page is `maxRoughSize: 10,000,000` (`WalletStorageManager.js:726-727`) and non-binary byte fields expand up to ~4×, so a full page can exceed both. The client has no shrink-and-retry for pushes. | MISSING — affects local→remote sync (local active, host as backup; `setActive` merges) |

What `KnexSyncTransferStore` needs (`KST:16-221`, migration `schema/KnexMigrations.js:66-103`): a knex instance; table `sync_transfers` with 9 pre-inserted slots (slot 0 is the cross-replica lock row, updated inside every transaction), columns `transferId, identityKey, context, direction, digest, totalBytes, receivedBytes, partBytes, expiresAt (bigint), state, result (text JSON)`; table `sync_transfer_parts (slot, offset, bytes)`; 15-minute TTL; max 2 pending per identity, 8 total.

Can `StoragePg` support it: yes with a separate store object, not through `StoragePg` itself. `StoragePg` uses a `pg` Pool, not knex (`PG:1215`), so the `instanceof StorageKnex` gate never passes. `KnexSyncTransferStore` itself only issues portable knex queries (`where/update/insert/delete/orderBy/first` inside `knex.transaction`); a `pg` knex works if the tables are created with Postgres types (the upstream migration uses `blob`, which Postgres does not have; it needs `bytea`). `bigint expiresAt` comes back as a string from `pg`; the store already wraps it in `Number()` everywhere it compares. The host already builds a `pg` knex for messagebox (`serve.ts:476-508`). Wiring it means adding the six methods to `dispatch.ts` and the capability to `settingsForWire`, running billing on `commitSyncTransfer` the same way it runs on `processSyncChunk` (the gate keys on the JSON-RPC method name, `AG:374-375`), and checking `jsonLimit`/`maxRequestBytes` so `inlineBytes`/`partBytes` fit.

## 8. Other policy

| # | Behaviour | Upstream | Ours | Status |
|---|-----------|----------|------|--------|
| 8.1 | `KnexPaymentReplayStore` | only with `monetize` | n/a | N-A |
| 8.2 | `KnexSessionManager` | optional | Redis or memory `SM` | N-A (equivalent role) |
| 8.3 | `responseSizeLimit` (EP) | exported but not used by StorageServer | n/a | N-A |
| 8.4 | `start()` log line, `close()` | `SS:896-910` | `HS:249-273, 276-307` | MATCH |
| 8.5 | `validateDate/validateEntity/validateEntities` helpers on the class | `SS:911-931` | not needed (no subclassing) | N-A |

## 9. Where `createWalletServer` and `createWalletRpcHandler` differ from `createHostServer`

| Aspect | `HS` (production) | `WS` (`1sat serve wallet`) | `RH` (internal bearer path, `createBearerServer`) |
|--------|-------------------|----------------------------|------------------------------------------------|
| Auth mount | POST `/`, `/.well-known/auth`, `/account`, messagebox `HS:147-156, 234` | `app.use(publicPath, authMiddleware)` covers every route under `/` `WS:219` | bearer token resolver, no BRC-104 `WS:452-477`, `RH:44-49` |
| Binary request decode | after auth `HS:139-140` | after auth `WS:226` | before identity resolution `RH:35-42` |
| Shape check | `params` non-array → `[]` `WS:310` | same | `params` non-array → 400 -32600 `RH:100-107` (matches upstream) |
| Missing identity | 401 -32000 `WS:264-277` | same | 401 -32000 with `err.message` `RH:146-161` |
| Capacity gate | yes when accounts on `HS:141-143` | yes `WS:227-229` | no (`preDispatch` undefined, `WS:457`) |
| Paymail / messagebox / exchange-rate / OpenAPI | yes `HS:105-124, 192-241` | no | no |
| Registration certs | yes `HS:175-189` | no certs `WS:137-139` | no |
| Server | `http.createServer` + optional WebSockets `HS:243-244` | `app.listen` `WS:154` | n/a |
| Dispatch | `D.dispatch` | same | same |

All three share `dispatch.ts`, `rpcBudgets.ts`, the same JSON codec and the same 200-for-RPC-errors rule, so section 4-6 rows apply to each unless noted.

## Not verified

1. Production module identity: `marshalError` uses `instanceof WalletError` (`D:431`). Locally `wallet-node` and `wallet-server` resolve the same toolbox install. Not checked on the production install of `@1sat/cli`. If production runs the `build:bin` compiled binary (`packages/cli/package.json:16`), `createRequire(import.meta.url)` in `toolboxRemoting.ts:10` and the `wallet-node`/`wallet-server` toolbox copies were not checked; a split would collapse every storage error to `WERR_INTERNAL`.
2. Runtime (Node vs Bun) on production, which decides the default HTTP timeouts in 1.8.
3. How `AuthFetch` in `@bsv/sdk` reports an unsigned error response (body-parser 413/400 happen before auth in both servers).
4. Whether evlog emits request headers (`x-bsv-auth-*`) to its drain; `evlog/express` passes `req.headers` into its request context (`node_modules/evlog/dist/express/index.mjs:11`).
5. That `StoragePg.getServices()` is populated in the serve process; `validateSyncProofs` calls it (`methods/validateSyncProof.js:118`).
6. How often yours-wallet or the CLI pushes `processSyncChunk` to the host (local active, host backup); this sets the real impact of 7.3.
7. Messagebox router error middleware ordering (`@bopen-io/messagebox-server`) was not read.

## DIFFERS / MISSING items that affect correctness or security, ordered

1. **Large inbound sync pages have no path (7.1-7.3).** Pushes over ~16 MiB of encoded JSON fail with an auth-middleware 400 or a body-parser 413, and the client does not retry smaller. Files: `packages/wallet-server/src/dispatch.ts` (six transfer methods, `settingsForWire` capability), a Postgres-typed sync-transfer table set (`packages/wallet-node/src/storage-pg.ts` migrations, or a wallet-server-owned knex store), `packages/wallet-server/src/createHostServer.ts` / `createWalletServer.ts` (pass the store; align body limits), `packages/wallet-server/src/accounts/middleware.ts` (bill `commitSyncTransfer`).
2. **No rate limiting, no concurrency ceiling, no HTTP timeouts (2.9, 2.10, 1.8).** Files: `createHostServer.ts`, `createWalletServer.ts` (the toolbox's `edgePolicy.js` / `RateLimitPolicy.js` helpers can be required the same way `toolboxRemoting.ts` requires `BinaryJson`).
3. **Body limits and parser errors (1.1, 1.2, 1.3, 2.3, 6.3).** 30 MiB JSON vs 8 MiB, auth request limit 16 MiB vs 8 MiB, and the terminal handler returns raw `err.message` with `ERR_INTERNAL` for every status. Files: `createHostServer.ts`, `createWalletServer.ts`, `errorHandler.ts`, `sessions/redisSessionManager.ts`.
4. **Security headers and `x-powered-by` (1.5).** Files: `createHostServer.ts`, `createWalletServer.ts`.
5. **JSON-RPC envelope status codes (3.2, 4.3).** Non-array `params` is accepted as `[]`; unknown methods return 200 instead of 400, so the client raises a `WalletError` instead of a network error. Files: `createWalletServer.ts` (`dispatchHandler`, `isJsonRpcLike`), `dispatch.ts` (`methodNotFound`).
6. **Array budget skips numeric arrays (4.15).** A `number[]` param of any length bypasses the 1,000,000-item cap that upstream enforces. File: `rpcBudgets.ts:167`.
7. **`adminStats` argument shape (4.12).** File: `dispatch.ts:274-287`.
8. **Action-batch PUT routes and `express.raw` (1.2, 1.10).** Not needed while `StoragePg` reports no action-batch capability; required before enabling it. Files: `createHostServer.ts`, `createWalletServer.ts`.
