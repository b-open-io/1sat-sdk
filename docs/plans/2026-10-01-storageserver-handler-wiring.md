# StorageServer handler-only wiring into the host Express app

Question: can `ts-stack/packages/wallet/wallet-toolbox` `StorageServer.handleRpcRequest` be mounted in
`1sat-sdk/packages/wallet-server` as `app.post('/', auth, capacityGate, storageServer.handleRpcRequest)`,
with the upstream change limited to "make the handler available"?

Sources (read-only):

- Upstream: `ts-stack` `origin/main` @ `20c761568`. `feat/storageknex-postgres` sits on top of it and does
  not touch `StorageServer.ts`, `KnexSyncTransferStore.ts`, `edgePolicy.ts`, `BinaryJson.ts`, or
  `RateLimitPolicy.ts`. It only changes `StorageKnex.ts`, `KnexSessionManager.ts`,
  `KnexPaymentReplayStore.ts`, and `StorageClientBase.ts` (dbtype list).
- Auth middleware: installed `@bsv/auth-express-middleware@2.2.8` corresponds to `ts-stack` commit
  `40dad06dd`. `git diff 40dad06dd origin/main -- packages/middleware/auth-express-middleware/src` is empty,
  so the toolbox's copy (2.2.9) and ours have identical source.
- Host: `1sat-sdk` `HEAD` @ `d419a147` (pre-switch design).

All `StorageServer.ts:N` refs below are to
`ts-stack/packages/wallet/wallet-toolbox/src/storage/remoting/StorageServer.ts` @ origin/main. All `auth:N` refs
are to `ts-stack/packages/middleware/auth-express-middleware/src/index.ts` @ 40dad06dd.

## Verdict

Mounting only the handler works. The upstream change it needs is small: expose bound handlers and,
optionally, make `port` optional. Two gaps need decisions on our side:

1. **Action-batch PUT routes.** `StorageKnex` advertises `actionBatch` through `getCapabilities`. 2.14+
   clients in the default `'auto'` mode use it for every noSend `createAction`. The batch upload goes
   through `PUT /action-batch/:id/pack|blob/:digest`, and that route is not part of `handleRpcRequest`.
2. **Capacity gate coverage.** Batched noSend actions never call the `createAction` RPC. Sync uploads
   above `inlineBytes` arrive as `commitSyncTransfer`, not `processSyncChunk`. Today's
   `BILLABLE_METHODS` misses both.

## 1. What the handler reads from `req`

| Read | Where |
|---|---|
| `req.header('X-BSV-Binary-Encoding')`, `req.header('X-BSV-Binary-Request-Encoding')` | `StorageServer.ts:630-632` |
| `req.body.{jsonrpc,method,id,params}` (params decoded from binary in place) | `StorageServer.ts:634-635` |
| `req.auth.identityKey` (must be a non-empty string and not `'unknown'`) | `requiredAuthenticatedIdentityKey` `StorageServer.ts:194-200`. Used by `createRpcLog` :877, `findOrInsertUser` :1047, `authorizeAdminStats` :1080, `authenticatedAuth` :1122, `bindAuthenticatedAuth` :1138, `validateParam0` :1155, `dispatchSyncTransfer` :950, `sendOversizedSyncResponse` :689 |
| `traceparent` / `X-Cloud-Trace-Context` headers, telemetry carrier `req` | log/telemetry only, `StorageServer.ts:614-626`, `:880-886` |

It does not read `req.ip`, `req.payment`, rate-limiter state, or concurrency state.
`dispatchRpcCall`, `dispatchSyncTransfer`, and `authorizeAdminStats` get only `(method, params, req)`, and
they use `req` only through `requiredAuthenticatedIdentityKey`.

Our auth middleware sets `req.auth = { identityKey: senderPublicKey }` (`auth:1411`). That is the same code
path as upstream's `createAuthMiddleware` at `StorageServer.ts:533-539`. With `allowUnauthenticated` unset,
unauthenticated requests get a 401 before they reach the handler (`auth:1778-1795`).

The handler has no dependency on upstream middleware order. Rate limiting, concurrency limiting, and payment
(`StorageServer.ts:475-558`) are separate `app.use` layers, and the handler does not consume their output.

**OK.**

## 2. Constructor side effects when the app is never started

`new StorageServer(storage, opts)` runs `setupRoutes()` unconditionally (`StorageServer.ts:427`).

- `express()` app (Express 5, `StorageServer.ts:279`). Inert.
- `readResourceProfile` / `readResourceLimit` / `readBodyLimitBytes` read `WALLET_STORAGE_*` and
  `RESOURCE_PROFILE` env vars and **throw on malformed values** (`edgePolicy.ts:114-150`). `corsPolicy` and
  `securityHeaders` also read env vars. Otherwise inert.
- `createAuthMiddleware` (`StorageServer.ts:539`) creates an `ExpressTransport`, a `Peer`, and a default
  in-memory `SessionManager` (`auth:2036-2069`). All of them hold only Maps. Timers are created only per
  request (`auth:825,1229,1360,1431,1759`). The second Peer never receives traffic, so nothing conflicts.
  Do not pass our `RedisSessionManager` as `sessionManager`; there is no reason to.
- Two `express-rate-limit` v8 limiters (`StorageServer.ts:477-487`, `:540-549`). Each `rateLimit()` calls
  `MemoryStore.init`, which starts `setInterval(clearExpired, 60s)` with `.unref()`
  (`express-rate-limit@8.6.1 dist/index.cjs:86-94,885-890`). Two idle timers per process. They do not keep
  the process alive.
- `new Telemetry(undefined)` stores config only, and `enabled` is false without a sink
  (`sdk/src/telemetry/Telemetry.ts:601-615`).
- `KnexSyncTransferStore` (`StorageServer.ts:400-420`). The constructor stores `knex` and capabilities
  only (`KnexSyncTransferStore.ts:29-32`). It runs no DB I/O and no timers. It needs `SYNC_TRANSFER_MIGRATION`
  (tables `sync_transfers` with 9 slots and `sync_transfer_parts`, `KnexMigrations.ts:104-140` on the
  Postgres branch), which `storage.migrate()` applies. Without the migration, the first transfer fails with
  "Wallet sync transfer migration is required" (`KnexSyncTransferStore.ts:37-38`).
- `monetize: false` skips the payment middleware. `logShortReqs` is unset, so no short-request logging.
- `port` is required by type but used only in `start()` (`StorageServer.ts:1167-1174`). Passing `port: 0`
  works today.
- `wallet` is typed as the toolbox `Wallet`. The constructor uses it only for auth middleware construction
  and the unmounted `GET /`.

**OK as-is.** The leftover overhead is one unused express app, one idle Peer, and two unref'd 60 s timers.
Making `port` optional is cosmetic.

## 3. Limits

Upstream defaults with no env vars set (profile `standard`):

- `maxRpcResponseBytes` = 8 MiB (`StorageServer.ts:369-379`). `jsonBodyLimit` = 8 MiB
  (`StorageServer.ts:391-398`). This value only sizes sync transfers when the handler is mounted alone,
  because the toolbox app's own `express.json` never runs.
- SyncTransfer is enabled when `storage instanceof StorageKnex` (true for Postgres StorageKnex; the branch
  does not change this) and `jsonBodyLimit >= 4096` and `maxRpcResponseBytes >= 4096`
  (`StorageServer.ts:400-405`). The resulting settings:
  - `inlineBytes` = min(6 MiB, 4 MiB, 4 MiB) = **4 MiB**
  - `partBytes` = min(256 KiB, 2 MiB, 2 MiB) = **256 KiB**
  - `maxBytes` = 64 MiB (`SyncTransfer.ts:26-27`)
- The client sends `processSyncChunk` inline while `encodedBytes * (binaryRequests ? 1 : 4) <= inlineBytes`
  (`StorageClientBase.ts:826-832`). The largest inline request body is therefore about 4 MiB plus envelope.
  Parts are about 350 KB on the wire.
- Response path: the handler compares the serialized JSON to `maxRpcResponseBytes` (`:667`, `:737`).
  - When the request is `getSyncChunk` with `syncTransferVersion: 1`, an oversized result becomes a staged
    `{ syncTransfer: manifest }` (`:676-694`).
  - Otherwise the handler responds `413` with `-32005` (`:738-745`). The client halves `maxRoughSize` on 413
    (`StorageClientBase.ts:97-100,853-865`).
  - The handler also clamps `getSyncChunk.maxRoughSize` to `maxRpcResponseBytes` (`:784-793`).
- Auth wrapper: the response body is re-serialized by `stringifyBRC100` and capped by
  `transportLimits.maxResponseBytes` (`auth:567-650`). The handler body has already passed its own 8 MiB
  check, and `JSON.parse` + re-stringify only removes the `<` escapes (`:202-205`, `:749`). The wrapper
  body is therefore never larger, so the auth 413 cannot trigger first. Upstream couples the two limits the
  same way (`StorageServer.ts:535`).

Host at HEAD:

- `express.json({ limit: '30mb' })` (`createHostServer.ts:93`)
- auth `maxRequestBytes` 16 MiB, `maxResponseBytes` 8 MiB (`sessions/redisSessionManager.ts:167-170`)

Both are at or above the transfer sizing, so the values are consistent.

**What the host must configure:**

- Pass `maxRpcResponseBytes: 8 * 1024 * 1024` explicitly so it stays equal to `AUTH_TRANSPORT_LIMITS.maxResponseBytes`
  regardless of `RESOURCE_PROFILE`.
- Leave `WALLET_STORAGE_JSON_MAX_BODY_BYTES` unset, or at most the host body limit. The transfer sizing
  derives from it.
- Run the storage migration so `sync_transfers` exists.
- `maxRpcListLimit: 10_000` keeps HEAD's limit (`rpcBudgets.ts:18`). Upstream defaults to 1,000.
- `maxRpcArrayItems`: upstream counts numeric arrays (`StorageServer.ts:796-816`; only `Uint8Array` is skipped).
  HEAD skipped them (`rpcBudgets.ts:167`). A non-binary client sending a BEEF or rawTx over 1,000,000 bytes as
  `number[]` gets a RangeError under the upstream default. Set `-1`, or a value bounded by the 30 MB body,
  to keep HEAD behavior.
- PUT action-batch routes (if mounted): they need `express.raw({ type: 'application/octet-stream', limit: 8 MiB })`
  **before** auth. Auth signs the raw body bytes (`auth_helpers.ts:168-200`), and `ACTION_BATCH_MAX_PACK_BYTES`
  is 8 MiB (`actionBatchBlobs.ts:17-21`). HEAD has no raw parser.

## 4. Response signing

- `sendRpc` ends with `res.status(status).json(JSON.parse(serialized))` (`StorageServer.ts:729-750`). It
  calls `res.json`, not `res.send`. The binary header is set with `res.set(BINARY_ENCODING_HEADER, ...)`
  (`:632`).
- Our auth middleware hijacks `status`, `set`, `json`, `send`, `end`, and `write` (`auth:1495-1580`) before
  `next()` runs. Every one of those writes lands in `ResponseWriterWrapper` and is signed. `json` uses
  `stringifyBRC100` (`auth:597-603`).
- Signed headers are every `x-bsv-*` except `x-bsv-auth*`, plus `authorization` (`buildResponsePayload`,
  `auth:1938-1990`). `X-BSV-Binary-Encoding` is included.
- The client rebuilds response status and headers only from the signed payload
  (`sdk/src/auth/clients/AuthFetch.ts:451-493`). `StorageClient` then reads `X-BSV-Binary-Encoding` from
  that payload (`StorageClient.ts:158`).
- Large bodies are buffered in full and capped by `maxResponseBytes` (8 MiB). See point 3.
- Express 4 `json escape` does not matter: the hijacked `json` never calls Express's `res.json`.

**OK.**

## 5. What remains in `1sat-sdk/packages/wallet-server`

Unnecessary once the handler is mounted (the handler already does each one):

- `src/dispatch.ts`: method allowlist and auth binding (`StorageServer.ts:71-173`, `:891-945`, `:1033-1163`),
  error marshalling (`:122-127`, `:857-868`), `syncCheckpointVersion` advertisement (`:927-937`)
- `src/rpcBudgets.ts`: replaced by `enforceRpcRequestBudgets` (`:752-855`), configured via
  `maxRpcListLimit` / `maxRpcArrayItems` as described in point 3
- `src/toolboxRemoting.ts`: the deep `require` of BinaryJson / syncChunkBinary / validate helpers
- `decodeBinaryRequest` (`createWalletServer.ts:240-252`): the handler decodes (`:635`)
- `dispatchHandler` / `sendRpc` (`createWalletServer.ts:254-349`)
- `settingsForWire`'s `syncCheckpointVersion` part

Still ours:

- **Auth + Redis session hydration**: `buildAuthMiddleware` unchanged (`sessions/redisSessionManager.ts:172-194`).
- **Body parsers**: `express.json` (30mb) as today. Add `express.raw` for octet-stream if the PUT routes are mounted.
- **CORS**: `corsMiddleware` (`createWalletServer.ts:483-497`).
- **Capacity gate** (`accounts/middleware.ts:363-499`). `BILLABLE_METHODS` (`dispatch.ts:167-173`) moves into
  the gate module and must add:
  - `commitSyncTransfer`. It dispatches `processSyncChunk` internally (`StorageServer.ts:983-1002`), and
    clients use it whenever a chunk exceeds `inlineBytes`.
  - `commitActionBatch` and `commitActionBatchByDigest`. These persist batched noSend actions; noSend
    `createAction` never hits the `createAction` RPC when `actionBatch` is advertised
    (`ActionBatchWorkspace.ts:999-1017`, `:934-945`).
  - Optionally `beginWriteSyncTransfer`, to refuse before staging bytes.

  The gate reads `req.body.params` before the handler decodes binary params. That is harmless: it inspects
  only `labels`, `lockingScript` (hex string), `satoshis`, and `reference`, and binary encoding tags only
  `Uint8Array` values (`BinaryJson.ts:166-178`).

  The gate's 507 error code `-32005` collides with upstream's oversized-response code `-32005`
  (`StorageServer.ts:741`). The HTTP status differs (507 vs 413), and `StorageClient` only sees the status.
- **dbtype filter for pre-Postgres clients.** origin/main `StorageClientBase.ts:231` rejects any `dbtype`
  outside `SQLite|MySQL|IndexedDB`, so 2.14.x clients (yours-wallet) fail on `'Postgres'`. The handler
  passes settings through (`StorageServer.ts:927-937`). The clean spot is a middleware between the gate and
  the handler that wraps `res.json` for `getSettings`/`makeAvailable` and drops a non-legacy `dbtype`. It
  wraps the already-hijacked `json`, so the modified body is what gets signed (same technique as
  `omitDbtypeRejectedByOlderClients` in the abandoned working-tree `storageRpc.ts`).
- **Admin key path**: unaffected. `adminIdentityKeys` passes through to the constructor, and
  `authorizeAdminStats` requires `params[0] === identityKey` (`StorageServer.ts:1079-1087`). HEAD's dispatch
  checked `params[0].identityKey` (`dispatch.ts:274-286`). That is a contract change for any caller of ours.
  `StorageClientBase` has no `adminStats` call.
- **Rate limiting / concurrency cap**: upstream's pre-auth IP limiter, per-identity limiter, and per-process
  concurrency cap (`StorageServer.ts:475-487,540-549`) are **not** applied in handler-only mode. HEAD had
  none either.
- **Error forwarding**: see point 6.
- **Logging**: pass `logRpcRequests: false` (default true; logs `console.log` JSON per RPC, `:870-889`) and
  keep evlog. The handler collapses internal errors to `WERR_INTERNAL` (`:122-127`). To log causes, pass a
  `telemetry` sink, as the abandoned `storageRpc.ts` did.

Host wiring sketch:

```ts
const storageServer = new StorageServer(storage as StorageKnex, {
  wallet, port: 0, monetize: false, adminIdentityKeys,
  logRpcRequests: false, maxRpcResponseBytes: 8 * MiB,
  maxRpcListLimit: 10_000, maxRpcArrayItems: -1,
})
const rpc = storageServer.handlers.rpc               // bound, per upstream change below
const asyncRoute = (h) => (req, res, next) => h(req, res).catch(next)

app.use(evlog())
app.use(express.json({ limit: '30mb' }))
app.use(express.raw({ type: 'application/octet-stream', limit: '8mb' }))   // only if PUTs mounted
app.use(corsMiddleware)
const auth = buildAuthMiddleware(wallet, config.sessionStore)
app.post('/.well-known/auth', auth)
app.post('/', auth, capacityGate(deps), omitDbtypeForOlderClients, asyncRoute(rpc))
app.put('/action-batch/:batchId/pack', auth, asyncRoute(storageServer.handlers.actionBatchPack))
app.put('/action-batch/:batchId/blob/:digest', auth, asyncRoute(storageServer.handlers.actionBatchBlob))
// ...account, paymail, messagebox as today...
mountTerminalErrorHandler(app)
```

## 6. Other wiring concerns

- **Unhandled rejection on Express 4.** `handleRpcRequestCore` throws outside its `try` (`StorageServer.ts:634-641`).
  Examples: an invalid base64 binary-request value (`decodeBinaryJsonValue` `:635`), or `createRpcLog`'s
  `requiredAuthenticatedIdentityKey` (`:877`). Express 5 forwards rejected promises to `next`, but Express 4
  (ours, 4.22.3) does not. The result is an unhandled rejection and a request that hangs until socket
  timeout. The auth 408 timer is already cleared at that point (`auth:1350`). Fix: wrap with
  `.catch(next)`. The terminal error handler's `res.status().json()` then goes through the hijack and is
  signed.
- **`this` binding.** `handleRpcRequest` is a private prototype method. Upstream binds it inline
  (`:609`). The exposed handler must be pre-bound.
- **Express 4 vs 5.** The toolbox depends on `express ^5.2.1` and `@types/express ^5.0.6`
  (`wallet-toolbox/package.json` dependencies). We use 4.22.3 with `@types/express` 4.17.
  - Runtime: the handler uses only `req.header`, `req.body`, `req.headers`, `req.params`, `res.set`,
    `res.status`, and `res.json`. These are identical in 4 and 5.
  - Types: handler parameter types are Express 5's. Expect a cast at the mount site; HEAD already uses
    `as never` there.
  - Do not mount an Express 5 `Router` or `app` into the Express 4 app. Mount plain handlers only.
- **Telemetry.** Inert unless configured. If configured, the `wallet.storage.rpc` span uses `req` as its
  carrier. It links to the auth span only when both resolve the same `@bsv/sdk` module instance, because
  `carrierContexts` is module-level. Upstream's `traceHttpRequest` span (`:696-727`) is not present.
- **Trust proxy.** Irrelevant to the handler, which never reads `req.ip`. Auth signs only path and query
  (`auth_helpers.ts:98-114`) and requires `req.protocol` to be `http` or `https`. The nginx → 127.0.0.1
  setup is unchanged from HEAD.
- **Error handler order.** The handler always answers itself except for the rejection above. Keep
  `mountTerminalErrorHandler` last, as today.
- **`initialDoubleSlashCompatibility`** (`:461`) is not applied. That only matters for clients that send `//`.

## Minimal upstream change (ts-stack wallet-toolbox `StorageServer.ts`)

1. Extract the two inline PUT handlers (`:560-606`) into private methods. Expose bound handlers:
   ```ts
   /** Route handlers for hosts that provide their own body parsing and BRC-103/104 authentication (req.auth.identityKey). */
   readonly handlers = {
     rpc: (req: Request, res: Response) => this.handleRpcRequest(req, res),
     actionBatchPack: (req: Request, res: Response) => this.handleActionBatchPack(req, res),
     actionBatchBlob: (req: Request, res: Response) => this.handleActionBatchBlob(req, res)
   }
   ```
   `setupRoutes` then uses these handlers, so there is one code path.
2. Optional: `port?: number`, with `start()` throwing when it is absent. `port: 0` already works without this.

If only the RPC handler is exposed (step 1 without the PUTs), the host must remove `actionBatch` from
`getCapabilities` responses using the same `res.json` wrap as the dbtype filter. Clients then take the legacy
`createAction` path (`ActionBatchWorkspace.ts:934-945`), and the gate stays correct with `createAction`.
