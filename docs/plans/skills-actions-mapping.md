# Skills ↔ Actions Mapping

Tracks how installed agent skills map to `@1sat/actions`, what's aligned, what's duplicated, and what needs resolution.

## Action Inventory (20 actions)

| Action | Category | Cost | Read-only? |
|--------|----------|------|------------|
| `sendBsv` | payments | Variable | No |
| `sendAllBsv` | payments | All funds | No |
| `getOrdinals` | ordinals | Free | Yes |
| `deriveCancelAddress` | ordinals | Free | Yes |
| `transferOrdinals` | ordinals | 1 sat + fees | No |
| `listOrdinal` | ordinals | 1 sat + fees | No |
| `cancelListing` | ordinals | 1 sat + fees | No |
| `purchaseOrdinal` | ordinals | price + fees | No |
| `listTokens` | tokens | Free | Yes |
| `getBsv21Balances` | tokens | Free | Yes |
| `sendBsv21` | tokens | 1 + 1000 sat overlay fee | No |
| `purchaseBsv21` | tokens | price + 1000 sat overlay fee | No |
| `inscribe` | inscriptions | 1 sat + fees | No |
| `getLockData` | locks | Free | Yes |
| `lockBsv` | locks | Configurable (recoverable) | No |
| `unlockBsv` | locks | Min 1500 sat threshold | No |
| `signBsm` | signing | Free | Yes |
| `opnsRegister` | opns | 1 sat + fees | No |
| `opnsDeregister` | opns | 1 sat + fees | No |
| `sweepBsv` | sweep | Free (external WIF) | No |
| `sweepOrdinals` | sweep | Free (external WIF) | No |
| `sweepBsv21` | sweep | 1000 sat overlay fee | No |

## Fully Aligned Skills (use @1sat/actions)

These skills already use `createContext() → action.execute()`:

| Skill | Actions Used |
|-------|-------------|
| `1sat-skills:wallet-setup` | Wallet creation (prerequisite for all actions) |
| `1sat-skills:wallet-create-ordinals` | `inscribe` |
| `1sat-skills:sweep-import` | `sweepBsv`, `sweepOrdinals`, `sweepBsv21` |
| `1sat-skills:transaction-building` | `sendBsv`, `sendAllBsv`, `signBsm` |
| `1sat-skills:token-operations` | `listTokens`, `getBsv21Balances`, `sendBsv21`, `purchaseBsv21` |
| `1sat-skills:ordinals-marketplace` | `getOrdinals`, `listOrdinal`, `purchaseOrdinal`, `cancelListing`, `deriveCancelAddress` |
| `1sat-skills:timelock` | `getLockData`, `lockBsv`, `unlockBsv` |
| `1sat-skills:opns-names` | `opnsRegister`, `opnsDeregister` |
| `1sat-skills:dapp-connect` | `@1sat/connect`, `@1sat/react` (wallet connection, not actions directly) |
| `1sat-skills:1sat-stack` | Direct API calls to indexer (supports actions with data) |
| `1sat-skills:extract-blockchain-media` | ORDFS gateway / txex CLI (content access) |

## Duplicates (skill uses older pattern, action exists)

| Skill | What it does | Library used | Duplicates action |
|-------|-------------|-------------|-------------------|
| `bsv-skills:wallet-send-bsv` | P2PKH payments from WIF | `@bsv/sdk` direct tx building | `sendBsv` |
| `bsv-skills:broadcast-arc` | Broadcast raw tx via ARC | `@bsv/sdk` ARC | Implicit in all actions |

### Resolution needed

- [ ] **`wallet-send-bsv`** — Duplicates `sendBsv` but works from a raw WIF (server/CLI, no wallet context). Decision: keep as separate "non-wallet" tool, or deprecate?
- [ ] **`broadcast-arc`** — Every action broadcasts implicitly. Decision: keep as standalone utility for manual broadcast, or remove?

## Partial Overlap (skill covers more than the action)

| Skill | Overlap with action | Extra coverage |
|-------|--------------------|----------------|
| `bsv-skills:message-signing` | `signBsm` (BSM mode) | Also teaches Sigma and AIP (transaction-bound signatures) |

### Resolution needed

- [ ] **`message-signing`** — `signBsm` action only covers BSM. Sigma and AIP are transaction-bound signing patterns not in the action system. Decision: add Sigma/AIP as new actions, or keep as separate skill territory?

## Gaps (skill exists, no action equivalent)

| Skill | Operation | Why no action exists |
|-------|-----------|---------------------|
| `bsv-skills:create-bap-identity` | BAP identity creation (Type42 + BRC-43) | Identity protocol, not a wallet payment operation |
| `bsv-skills:bsocial` | On-chain social posts, likes, follows | Protocol-specific, not 1Sat-specific |

### Resolution needed

- [ ] **`create-bap-identity`** — Should BAP identity creation become an action? It's identity management, not payments/ordinals.
- [ ] **`bsocial`** — Should social protocol operations become actions? They're generic BSV protocol operations.

## bsv-mcp Migration (40+ tools → @1sat/actions)

The `bsv-mcp` MCP server at `/Users/davidcase/Source/1sat/bsv-mcp` predates the BRC-100 wallet and `@1sat/actions`. It uses `@bsv/sdk` direct transaction building, `js-1sat-ord@0.1.91`, and raw WIF key management. All overlapping tools need to be migrated to use `@1sat/actions`.

### Direct overlaps (bsv-mcp tool → action)

| bsv-mcp Tool | Current Library | Target Action |
|-------------|----------------|---------------|
| `wallet_sendToAddress` | `@bsv/sdk` P2PKH + V5Broadcaster | `sendBsv` |
| `wallet_createOrdinals` | `js-1sat-ord` | `inscribe` |
| `wallet_purchaseListing` | `js-1sat-ord` | `purchaseOrdinal` / `purchaseBsv21` |
| `wallet_transferOrdToken` | `js-1sat-ord` | `transferOrdinals` / `sendBsv21` |
| `wallet_getBalance` | V5 API direct fetch | `getOrdinals` / `listTokens` / `getBsv21Balances` |

### bsv-mcp tools with no action equivalent (new gaps)

| bsv-mcp Tool | Operation | Candidate for new action? |
|-------------|-----------|--------------------------|
| `wallet_encryption` | ECIES encrypt/decrypt | Maybe — utility, not transaction |
| `wallet_mintCollection` | Batch ordinal collection minting | Yes — extends `inscribe` |
| `bap_generate` | Create BAP identity | Yes — identity lifecycle |
| `bap_getId` | Lookup BAP identity | Read-only, could be service method |
| `bap_friend` | BAP friend connection | Yes — social/identity |
| `bsocial_createPost` | On-chain social post | Maybe — protocol-specific |
| `mnee_sendMnee` | Send MNEE tokens | Maybe — separate token protocol |
| `mnee_getBalance` | MNEE balance lookup | Read-only, service method |
| `ordinals_searchInscriptions` | Search/filter inscriptions | Read-only, service method |
| `ordinals_marketListings` | Marketplace listing queries | Read-only, service method |
| `ordinals_marketSales` | Past sales data | Read-only, service method |

### bsv-mcp read-only/utility tools (no migration needed)

These query external APIs or provide utilities — they don't build transactions:

| bsv-mcp Tool | Purpose |
|-------------|---------|
| `bsv_getPrice` | BSV/USD exchange rate |
| `bsv_decodeTransaction` | Parse raw tx hex |
| `bsv_explore` | Blockchain explorer queries |
| `wallet_getAddress` | Return current address |
| `wallet_getPublicKey` | Return public key |
| `wallet_refreshUtxos` | Force UTXO refresh |
| `ordinals_getInscription` | Lookup inscription by ID |
| `ordinals_getTokenByIdOrTicker` | Token lookup |
| `bmap_readPosts` / `bmap_readLikes` / `bmap_readFollows` | BMAP API queries |
| `bsocial_readPosts` | Read social posts |
| `utils_convertData` | Encoding conversion |

### Architecture changes needed

- [ ] **Replace wallet pattern** — bsv-mcp uses raw `PrivateKey` + manual UTXO management. Needs BRC-100 wallet via `@1sat/wallet-node` (for stdio mode) or `@1sat/wallet-remote` (for hosted mode).
- [ ] **Remove js-1sat-ord dependency** — All inscription/ordinal operations should use `@1sat/actions` instead of `js-1sat-ord@0.1.91`.
- [ ] **Remove V5Broadcaster** — Actions handle broadcasting through the wallet's `createAction()` flow.
- [ ] **Add overlay integration** — Token operations (`sendBsv21`, `purchaseBsv21`) need BSV21 overlay validation, currently missing.
- [ ] **Preserve Droplet API mode** — The subsidized wallet mode is useful for demos. May need adapter to work with BRC-100 wallet interface.
- [ ] **Preserve OAuth 2.1** — HTTP/SSE transport uses Sigma Identity OAuth. This is orthogonal to wallet migration.

### Resolution needed

- [ ] **`wallet_mintCollection`** — Should batch collection minting become a new action? Currently only `inscribe` handles single inscriptions.
- [ ] **BAP tools** (`bap_generate`, `bap_getId`, `bap_friend`) — Should BAP identity operations become actions? Or stay as bsv-mcp-only tools backed by the `bsv-bap` library?
- [ ] **MNEE tools** — MNEE is a separate token protocol from BSV21. Should it get its own action category, or stay as bsv-mcp-only?
- [ ] **BSocial tools** — On-chain social posts use B/MAP/AIP protocols. Action candidate or keep as protocol-level tool?

## External Service Skills (no overlap, no conflict)

These skills call external APIs or provide reference info — they complement actions, not duplicate them:

| Skill | Purpose |
|-------|---------|
| `bsv-skills:junglebus` | Real-time tx subscription streaming (GorillaPool) |
| `bsv-skills:ordfs` | ORDFS gateway content access |
| `bsv-skills:check-bsv-price` | Price lookup |
| `bsv-skills:lookup-bsv-address` | Address balance/UTXO lookups |
| `bsv-skills:lookup-block-info` | Block header lookups |
| `bsv-skills:decode-bsv-transaction` | Parse tx hex (introspection utility) |
| `bsv-skills:key-derivation` | Type42/BRC-42/BIP32 key derivation (crypto utility) |
| `bsv-skills:estimate-transaction-fee` | Fee rate lookup |
| `bsv-skills:bsv-standards` | BRC specification reference |
| `bsv-skills:validate-bsv-script` | Script analysis (educational) |
| `bsv-skills:encrypt-decrypt-backup` | Backup encryption |
| `bsv-skills:manage-bap-backup` | BAP backup management |
| `bsv-skills:wallet-encrypt-decrypt` | ECDH encryption |
| `bsv-skills:wallet-brc100` | BRC-100 wallet implementation reference (TS) |
| `bsv-skills:wallet-brc100-go` | BRC-100 wallet implementation reference (Go) |

## Plan of Attack

### Repositories

| Repo | Path | Purpose |
|------|------|---------|
| `1sat-sdk` | `/Users/davidcase/Source/1sat/1sat-sdk` | `@1sat/actions` — the action definitions |
| `bsv-mcp` | `/Users/davidcase/Source/1sat/bsv-mcp` | MCP server — needs wallet migration |
| `1sat-skills` | `/Users/davidcase/Source/1sat/1sat-skills` | 1Sat skill definitions (already aligned) |
| `bsv-skills` | `/Users/davidcase/Source/1sat/bsv-skills` | BSV skill definitions (some duplicates/gaps) |
| `better-auth-plugin` | `/Users/davidcase/Source/1sat/better-auth-plugin` | Sigma Auth plugin |

### Priority 1: bsv-mcp wallet → BRC-100

Replace the raw PrivateKey + manual UTXO wallet in bsv-mcp with a BRC-100 wallet that can execute `@1sat/actions`.

- [x] **1a.** Understand current wallet interface in bsv-mcp — raw PrivateKey + manual UTXO fetch + js-1sat-ord + V5Broadcaster
- [x] **1b.** Wallet factory: `@1sat/wallet-remote` for both modes (same as yours-wallet and 1sat-website)
- [x] **1c.** Wire `createRemoteWallet()` + `createContext()` into bsv-mcp initialization. Deposit address derived with `BRC29_PROTOCOL_ID`, prefix `"mcp"`, index 0. `OneSatContext` passed to tools via `ToolsConfig`.
- [x] **1d.** `wallet_sendToAddress` → `sendBsv.execute(ctx, { requests })`
- [x] **1e.** `wallet_createOrdinals` → `inscribe.execute(ctx, { base64Content, contentType, map })`
- [x] **1f.** `wallet_purchaseListing` → `purchaseOrdinal.execute()` / `purchaseBsv21.execute()`
- [x] **1g.** `wallet_transferOrdToken` → `transferOrdinals.execute()` / `sendBsv21.execute()`
- [x] **1h.** `wallet_getBalance` → `ctx.wallet.listOutputs({ basket: 'default' })`
- [ ] ~~**1i.** Remove `js-1sat-ord` and `V5Broadcaster` dependencies~~ — Deferred to P3. Still used by: mintCollection, a2bPublish*, BAP tools, bsocial
- [ ] **1j.** Verify Droplet API mode still works (or design adapter) — Deferred
- [ ] **1k.** Verify OAuth 2.1 is unaffected — Orthogonal, no changes needed

### Version alignment (completed during P1)

Bumped `@1sat/client` dep to `^0.0.8` and `@1sat/wallet` dep to `^0.0.19` across all monorepo packages. Published:
- `@1sat/types@0.0.10`, `@1sat/wallet@0.0.19`, `@1sat/wallet-browser@0.0.14`, `@1sat/wallet-node@0.0.8`, `@1sat/wallet-remote@0.0.6`
- `@1sat/actions@0.0.25` — `signWithBAP` on `inscribe`, `inputBEEF` passthrough for sigma flow, `sourceSatoshis` fix in `signP2PKH`, `randomizeOutputs: false` for ordinal actions

### Remaining old-pattern tools (not blocking P2)

These still use the old `Wallet` class, `js-1sat-ord`, and/or `V5Broadcaster`. They'll be migrated when we build new actions in P3:
- `wallet_getAddress`, `wallet_getPublicKey`, `wallet_refreshUtxos` — trivial, use old Wallet
- `wallet_mintCollection` — js-1sat-ord, needs new action
- `sendOrdinals.ts` — js-1sat-ord (not an MCP tool, helper only)
- `a2bPublishMcp.ts`, `a2bPublishAgent.ts` — js-1sat-ord
- `bap_generate`, `bap_friend` — fetchPaymentUtxos, V5/BsocialBroadcaster
- `bsocial_createPost` — old Wallet

### Priority 1.5: Sigma signing in actions (PREREQUISITE for P2)

Sigma signing proves authorship of inscriptions/transactions using the wallet's BAP identity.

**Approach:** Anchor transaction pattern. Create a 2-sat self-payment (`noSend: true`), use its known outpoint for Sigma hash computation, bake SIGMA data into the locking script, then create the inscription tx spending the anchor with `sendWith` to broadcast both together.

**Key decisions:**
- Protocol name `"bapid"` (5-char minimum required by wallet-toolbox KeyDeriver). Invoice number: `"1-bapid-identity"`. Updated in both `@1sat/types` and `bsv-bap` library.
- `counterparty: 'self'` for both `createSignature` and `getPublicKey` — prevents anyone from deriving the BAP signing address from the identity public key.
- Anchor outputs stored in `sigma` basket (dedicated, no tags needed).
- `applySigma` computes hashes natively (no dependency on `sigma-protocol` library at runtime), verified against `sigma-protocol` in unit tests.

**Completed:**
- [x] **1.5a.** `applySigma()` helper in `packages/actions/src/signing/sigma.ts` — computes Sigma hashes, signs via `wallet.createSignature({ hashToDirectlySign })`, appends SIGMA suffix to locking script
- [x] **1.5b.** 4 unit tests verifying against `sigma-protocol` library: P2PKH output, OP_RETURN pipe separator, equivalence with direct signing, refVin=-1 handling
- [x] **1.5c.** `inscribe` action updated with optional `sigma: boolean` — triggers anchor tx + Sigma flow via `inscribeWithSigma()`
- [x] **1.5d.** Fixed `counterparty` mismatch bug — `getPublicKey` defaults to `'self'`, `createSignature` defaults to `'anyone'`. Fixed in both `applySigma` and `signBsm`.
- [x] **1.5e.** Updated `bsv-bap` library: `BAP_PROTOCOL_ID` → `[1, "bapid"]`, `BAP_INVOICE_NUMBER` → `"1-bapid-identity"`, regenerated test vectors (74/74 pass)
- [x] **1.5f.** Added `SIGMA_BASKET = 'sigma'` to `@1sat/types` constants
- [x] **1.5g.** Live test of Sigma inscription — tested via MCP `createOrdinals` with `signWithBAP: true`. Two bugs fixed: (1) anchor BEEF must be passed as `inputBEEF` to inscription `createAction`, (2) `signP2PKH` had hardcoded `sourceSatoshis: 1` instead of reading actual value from source tx. Sigma signature verified on-chain with `sigma-protocol` library.
- [ ] **1.5h.** Apply Sigma to other actions (transfers, listings, token ops)

### Priority 2: Test existing actions

Build test suite in `1sat-sdk/packages/actions/` to validate all 20 actions end-to-end with real BSV.

**Status:** Test infrastructure complete. Three wallets funded on rack (PRIMARY ~200k, BUYER 100k, SELLER 100k). Wallet state cleaned — stale `nosend` transactions aborted. bsv-mcp installed as MCP server (`/Users/davidcase/Source/1sat/.mcp.json`) with PRIMARY wallet WIF. Testing should use MCP tools, not throwaway scripts. Each action tested one at a time: check state → run → verify on-chain → check state after.

- [x] **2a.** Set up test infrastructure: wallet creation, funding, two-wallet pattern for marketplace tests
- [x] **2a.1** Owner sync + funding internalization working (fixed BEEF merkle path handling in 1sat-stack, fixed senderIdentityKey to use root identity key)
- [ ] **2b.** Test read-only actions: `getOrdinals`, `deriveCancelAddress`, `listTokens`, `getBsv21Balances`, `getLockData`, `signBsm`
- [x] **2c.** Test inscription: `inscribe` (with and without Sigma) — both paths working via MCP. Non-sigma: txid `e06b2f3b...`. Sigma: txid `24a00cbc...`, verified on-chain.
- [ ] **2d.** Test ordinal marketplace chain: `listOrdinal` → `cancelListing`, `listOrdinal` → `purchaseOrdinal`, `transferOrdinals`
- [ ] **2e.** Test token operations: `sendBsv21`, `purchaseBsv21`
- [ ] **2f.** Test locks: `lockBsv` → `unlockBsv`
- [ ] **2g.** Test OpNS: `opnsRegister` → `opnsDeregister`
- [ ] **2h.** Test payments: `sendBsv`, `sendAllBsv`
- [ ] **2i.** Test sweep: `sweepBsv`, `sweepOrdinals`, `sweepBsv21`
- [ ] **2j.** Verify bsv-mcp tools produce same results as direct action calls

### bsv-mcp merge status (2026-03-10, updated)

Branch `brc100-wallet` merged to master. All wallet tools use `@1sat/actions@0.0.25` with BRC-100 remote wallet. Sigma inscriptions tested and verified on-chain.
- `createOrdinals.ts` → `inscribe.execute(ctx, ...)`
- `getBalance.ts` → `ctx.wallet.listOutputs({ basket: 'default' })`
- `sendToAddress.ts` → `sendBsv.execute(ctx, ...)`
- `purchaseListing.ts` → `purchaseOrdinal.execute(ctx, ...)` / `purchaseBsv21.execute(ctx, ...)`
- `transferOrdToken.ts` → `transferOrdinals.execute(ctx, ...)` / `sendBsv21.execute(ctx, ...)`
- `utils/walletInit.ts` — BRC-100 remote wallet factory with BRC-29 deposit address

### Priority 3: New actions for gaps (deferred)

Only after P1.5 and P2 are solid. Decision items from the gap analysis above still need resolution before starting.

- BAP identity lifecycle (`bap_generate`, `bap_getId`, `bap_friend`)
- Collection minting (`wallet_mintCollection`)
- MNEE token protocol
- BSocial on-chain posts
- ECIES encrypt/decrypt

### Ongoing: Update skills

As we change actions or bsv-mcp tools, update the corresponding skills in `1sat-skills/` and `bsv-skills/` to reflect the new patterns. Skills must stay in sync with the implementation they teach.

## Test Suite Dependencies

For a full integration test of all 20 actions, the test wallet needs:

| Prerequisite | Required by |
|-------------|-------------|
| Funded wallet (~10,000 sats) | All state-changing actions |
| Second wallet (buyer/seller) | `purchaseOrdinal`, `purchaseBsv21` |
| Existing inscription in wallet | `listOrdinal`, `transferOrdinals` |
| Existing BSV21 token in wallet | `sendBsv21`, `purchaseBsv21` |
| Existing OpNS name in wallet | `opnsRegister`, `opnsDeregister` |
| External funded WIF | `sweepBsv`, `sweepOrdinals`, `sweepBsv21` |
| Near-future block height | `lockBsv` → `unlockBsv` chain |

### Execution order (dependency chains)

```
Phase 1 — Read-only (free):
  getOrdinals, deriveCancelAddress, listTokens, getBsv21Balances, getLockData, signBsm

Phase 2 — Create assets:
  inscribe → creates ordinal for later phases

Phase 3 — Ordinal marketplace:
  listOrdinal → cancelListing (recover)
  listOrdinal → purchaseOrdinal (from second wallet)
  transferOrdinals

Phase 4 — Token operations:
  sendBsv21
  purchaseBsv21 (requires listed token from second wallet)

Phase 5 — Locks:
  lockBsv → unlockBsv (requires block height to pass)

Phase 6 — OpNS:
  opnsRegister → opnsDeregister (requires OpNS name in wallet)

Phase 7 — Payments:
  sendBsv
  sendAllBsv (run last — sweeps entire balance)

Phase 8 — Sweep (external WIF):
  sweepBsv, sweepOrdinals, sweepBsv21
```
