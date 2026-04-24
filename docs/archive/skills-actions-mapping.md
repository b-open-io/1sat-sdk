# Skills ↔ Actions Plan

Tracks the `@1sat/actions` ecosystem: what's done, what's next, and how skills/MCP/Sigma Identity fit together.

## Current Action Inventory (25 actions)

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
| `createSocialPost` | social | Fees only | No |
| `publishIdentity` | identity | Fees only | No |
| `attest` | identity | Fees only | No |
| `updateProfile` | identity | Fees only | No |
| `getProfile` | identity | Free | Yes |

**Known issue:** `signBsm` has a `CalculateRecoveryFactor` bug (DER → compact roundtrip). Skipped in unit tests.

## Completed Work

### P1: bsv-mcp wallet → BRC-100 — DONE

All bsv-mcp wallet tools migrated to `@1sat/actions@0.0.38` with BRC-100 remote wallet. Version 0.2.15 on master. Dead code deleted, addresses fixed, refresh rewritten.

**One remaining cleanup:** `gatherCollectionInfo.ts` L191 `getPrivateKey()` — old Wallet class, fixed when collection minting is migrated (P3).

### P1.5: Sigma signing — DONE

`applySigma()` helper in `@1sat/actions/signing/sigma.ts`. Uses `wallet.createSignature()` with `BAP_PROTOCOL_ID` / `BAP_KEY_ID` / `counterparty: 'self'`. Tested on-chain (txid `24a00cbc...`). Wired to `inscribe` action with optional `sigma: boolean`.

### P2: Test all 20 actions — DONE (2026-03-12)

All tested end-to-end via bsv-mcp MCP tools against live 1sat-stack. 429 MCP invocations across all action categories. Details in `skill-updates-from-p2-testing.md`.

### Skills aligned

All `1sat-skills` already use `createContext() → action.execute()`:

| Skill | Actions Used |
|-------|-------------|
| `1sat-skills:wallet-setup` | Wallet creation |
| `1sat-skills:wallet-create-ordinals` | `inscribe` |
| `1sat-skills:sweep-import` | `sweepBsv`, `sweepOrdinals`, `sweepBsv21` |
| `1sat-skills:transaction-building` | `sendBsv`, `sendAllBsv`, `signBsm` |
| `1sat-skills:token-operations` | `listTokens`, `getBsv21Balances`, `sendBsv21`, `purchaseBsv21` |
| `1sat-skills:ordinals-marketplace` | `getOrdinals`, `listOrdinal`, `purchaseOrdinal`, `cancelListing`, `deriveCancelAddress` |
| `1sat-skills:timelock` | `getLockData`, `lockBsv`, `unlockBsv` |
| `1sat-skills:opns-names` | `opnsRegister`, `opnsDeregister` |
| `1sat-skills:dapp-connect` | `@1sat/connect`, `@1sat/react` |
| `1sat-skills:1sat-stack` | Direct API calls to indexer |
| `1sat-skills:extract-blockchain-media` | ORDFS gateway / txex CLI |

## Architecture: Sigma Identity + BAP + BRC-100 Wallet

```
BAP Master Key (xprv) — lives in Sigma Identity
  └─ Member key (per identity)
      ├─ Root key — ID publication + key rotation ONLY (Sigma Identity)
      │   └─ BAP ID = base58(ripemd160(sha256(rootAddress))) — stable across rotations
      └─ Current identity key → BRC-100 wallet root key
          └─ All wallet derivations (deposit addresses, signing, identity pubkey)
          └─ BAP signing key (Type42: "1-bapid-identity") — used by applySigma, applyAip
```

**Shared wallet pattern:** All surfaces point at the same remote wallet. Same active key = same wallet state.

| Surface | How it gets the active key | Wallet usage |
|---------|---------------------------|-------------|
| Sigma Identity website | Derives from BAP master | `createRemoteWallet(activeKey)` |
| bsv-mcp | `PRIVATE_KEY_WIF` env var (future: OAuth) | `createRemoteWallet(activeKey)` |
| 1sat-website | OAuth flow → encrypted active key | `createRemoteWallet(activeKey)` |
| yours-wallet | Local key storage | `createRemoteWallet(activeKey)` |

**What lives where:**

*Sigma Identity (master key domain):*
- BAP master key generation/storage, identity creation/selection
- ID record publication (initial + rotation) — requires root key
- Key rotation, friend key derivation
- OAuth flow → return encrypted active key to clients

*@1sat/actions (BRC-100 wallet):*
- All 25 actions (see inventory above)
- `applySigma` (done), `applyAip` (done) — signing helpers
- `publishIdentity` (done) — takes pre-signed script, validates AIP signature + wallet address match
- `attest`, `updateProfile`, `getProfile` (done) — BAP identity management via wallet signing key
- `createSocialPost` (done) — BSocial posts with AIP signing
- Deferred: `sendMnee`, `mintCollection`

*bsv-mcp:*
- Wallet operations via actions (done)
- BAP tools (`bap_generate`, `bap_getId`, `bap_friend`) — migrate OUT eventually
- Read-only/utility tools stay as-is

## P3: New Actions — Execution Order

### Step 1: `applyAip` helper (KEYSTONE) — DONE (2026-03-12)

Analogous to `applySigma` but for AIP signing. Signs OP_RETURN data directly (no input hash, no anchor tx needed). Unlocks steps 2-4.

Location: `@1sat/actions/signing/aip.ts`

- [x] Create `applyAip()` — delegates to `AIP.sign()` from `@bopen-io/templates@1.2.3` via `WalletSigner`
  - Extracts AIP message buffer from OP_RETURN chunks
  - Creates `WalletSigner(wallet, BAP_PROTOCOL_ID, BAP_KEY_ID, 'self')`
  - Appends `[AIP_PREFIX, algorithm, address, compactSig]` using binary script building

**Architecture change:** Published `@bopen-io/templates@1.2.3` with `Signer` interface abstraction:
- `Signer` interface: `signHash(hash) → DER bytes`, `getPublicKey() → hex`
- `PrivateKeySigner` — wraps raw `PrivateKey` (BSM.sign)
- `WalletSigner` — wraps BRC-100 `WalletInterface` (createSignature/getPublicKey with protocolID/keyID)
- `AIP.sign()` and `BSocial` constructor/statics now accept `Signer` instead of `PrivateKey` (breaking change from 1.2.2)

### Step 2: `createSocialPost` action — DONE (2026-03-12)

On-chain social posts: B:// (content) + MAP (metadata) + AIP (signing via templates).

- [x] Create action in `@1sat/actions/social/`
  - Uses `BSocial.createPost()` from templates with `WalletSigner` for AIP signing
  - `app` field is caller-provided (MAP attribution, e.g. 'bsv-mcp', '1sat-website')
  - 0-sat OP_RETURN output in `bsocial` basket with MAP-derived tags
  - Tags: `app:{name}`, `type:{action}`, `context:{ctx}`, `contextValue:{val}`, `tag:{tag}`
  - `buildSocialTags()` helper ready for future social action types
  - New `BSOCIAL_BASKET` constant, new `'social'` ActionCategory
- [ ] Migrate bsv-mcp `bsocial_createPost` to use it
- [ ] Update `bsv-skills/bsocial` skill
- [ ] Additional BSocial actions (like, follow, message, video, reply) — backburnered pending holistic review

### Step 3: `attest` + `updateProfile` + `getProfile` actions — DONE (2026-03-12)

BAP operations using the BRC-100 wallet's signing key (NOT master key ops).

**BAP ID resolution:** The BAP ID (`base58(ripemd160(sha256(rootAddress)))`) is derived from the root/member key, which actions don't have. Sigma Identity must seed the wallet by internalizing the initial BAP ID transaction output into the `bap` basket with tag `type:id, bapId:<hash>`. Actions then resolve the BAP ID from wallet state via `resolveBapId()` → `listOutputs({ basket: 'bap', tags: ['type:id'] })`. This seeding is a **prerequisite for testing** (see Step 6).

**OP_RETURN formats** (all use `OP_FALSE OP_RETURN`):
- ATTEST: `BAP_PREFIX | "ATTEST" | attestation_hash | counter` + AIP suffix
- ALIAS: `BAP_PREFIX | "ALIAS" | bap_id | profile_json` + AIP suffix

Both signed with wallet's BAP key (`[1, "bapid"] / "identity"`) via `applyAip`.

- [x] Add `BAP_BASKET` and `BAP_BITCOM_ADDRESS` constants to `@1sat/types`
- [x] Create `resolveBapId` helper — reads BAP ID from `bap` basket `type:id` tag
- [x] Create `attest` in `@1sat/actions/identity/` — ATTEST OP_RETURN + `applyAip`, output in `bap` basket with tags `type:attest, hash:<hash>`
- [x] Create `updateProfile` in `@1sat/actions/identity/` — ALIAS OP_RETURN + `applyAip`, output in `bap` basket with tags `type:alias, bapId:<hash>`. Relinquishes old alias outputs after new one is committed.
- [x] Create `getProfile` in `@1sat/actions/identity/` — reads current profile from `bap` basket, parses ALIAS locking script, deduplicates via relinquish
- [x] Update `bsv-skills/create-bap-identity` skill

### Step 4: Sigma Identity + Connect integration (PRIORITY)

Previously Step 6. Elevated because identity seeding is a prerequisite for testing Step 3 actions, and Connect needs to be revived as the unified wallet connection layer.

#### 4a: Sigma Identity → BRC-100 wallet seeding

Two paths to publish BAP ID and seed the wallet:

**Wallet-funded path:** Sigma Identity signs the ID OP_RETURN with root key via `PrivateKeySigner` + `AIP.sign()` from `@bopen-io/templates`, then calls `publishIdentity.execute()` which funds via BRC-100 wallet. Output auto-lands in `bap` basket.

**Droplit-funded path (onboarding):** Sigma Identity signs the ID OP_RETURN, Droplit funds and broadcasts, then `wallet.internalizeAction()` seeds the `bap` basket with `type:id, bapId:<hash>` tags. User doesn't need BSV yet.

- [x] Create `publishIdentity` action in `@1sat/actions` (takes pre-signed script, validates AIP sig + wallet address match, extracts bapId)
- [x] bsv-bap `MemberID` rewrite: counter-based two-level key derivation (member→current→signing), root key signing methods, `fromBackup()` with encrypted blob, `rotate()` (2026-03-13)
- [x] Published `bsv-bap@0.1.24` — BAP_PROTOCOL_ID = `[1, "sigma"]`, BAP_INVOICE_NUMBER = `"1-sigma-identity"` (2026-03-13)
- [x] Fixed sigma-auth encrypted blob: 4 places now use `exportMember()` instead of plain BAP ID string (uncommitted in sigma-auth)
- [x] Fixed sigma-auth signer iframe: SIGN_REQUEST derives signing key via `createMemberId()` + `getSigningKey()` (uncommitted in sigma-auth)
- [x] Aligned `@1sat/types` BAP_PROTOCOL_ID to `"sigma"`, committed and pushed 1sat-sdk (2026-03-13)
- [x] Replace `yours-wallet-provider` with `@1sat/wallet-remote` in Sigma Identity (commit 3b288e5, 8ed995b)
- [x] BAP API consolidation into 1sat-stack (OPL-1110 Done, OPL-1112 Done, OPL-1113 Done)
- [x] bsv-bap rewrite with MemberID counter-based derivation (commit 882ab50)
- [x] Signer iframe fixed for wallet key derivation (commit 8b7e150, 28c9c1d)
- [x] Profile fetch timeout fix for unpublished identities (OPL-1072, commit 809cc0f)
- [x] BapClient added to @1sat/client@0.0.14
- [ ] Wire root key signing via `PrivateKeySigner` + `AIP.sign()` (replaces broken `signTransaction()` stub)
- [ ] Wire Droplit path: broadcast → `internalizeAction()` to seed `bap` basket
- [ ] Wire wallet path: root key signs → `publishIdentity.execute()` funds and broadcasts
- [ ] Use `updateProfile.execute()` for ALIAS updates (replaces manual OP_RETURN construction)
- [ ] Keep Droplit as configurable option for social actions (don't remove existing code)

#### 4b: Rewrite @1sat/connect as fallthrough wallet detector

Single `connectWallet()` call that returns a `WalletInterface` or null. Replaces the admin UI's manual toggle with automatic detection.

**Detection fallthrough:**
1. `WalletClient("auto")` — catches yours-wallet (`window.CWI`), browser extensions, Cicada, XDM
2. `createWebCWI()` probe — iframe handshake to OneSat wallet tab with timeout (~1-2s)
3. `null` — no wallet connected

**API:**
```typescript
connectWallet(options?: {
  walletUrl?: string        // default: 'https://www.1satwallet.com'
  timeout?: number          // createWebCWI handshake timeout
  prefer?: 'auto' | 'onesat'
}): Promise<{ wallet: WalletInterface; provider: 'extension' | 'onesat'; disconnect: () => void } | null>
```

Extension wins when both available (faster). `prefer: 'onesat'` skips auto-detect. Sigma Identity is NOT a provider here — it's auth/signing, not wallet connection.

- [ ] Strip existing popup/embed/redirect transport code from Connect
- [ ] Implement `connectWallet()` with fallthrough detection
- [ ] Wire `createWebCWI` probe with configurable timeout
- [ ] Update 1sat-stack admin UI to use new Connect (remove toggle)
- [ ] Update 1sat-website to use new Connect

#### 4c: Remaining integration

- [ ] Migrate BAP tools out of bsv-mcp to Sigma Identity / BAP MCP
- [ ] Test identity actions end-to-end (attest, updateProfile, getProfile)

Pending: Discussion with Satchmo on BAP MCP scope and Connect provider design.

### Step 5: `sendMnee` action (deferred)

Independent of AIP. Wraps the `mnee` npm library.

- [ ] Create action in `@1sat/actions/mnee/`
- [ ] Migrate bsv-mcp `mnee_sendMnee` to use it
- [ ] Read-only tools (`mnee_getBalance`, `mnee_parseTx`) stay as-is

### Step 6: `mintCollection` action (deferred)

Batch ordinal minting. Extends `inscribe`.

- [ ] Create action in `@1sat/actions/ordinals/`
- [ ] Fix `gatherCollectionInfo.ts` L191, migrate to BRC-100 wallet context
- [ ] Migrate bsv-mcp `wallet_mintCollection` to use it
- [ ] Remove `js-1sat-ord` dependency from collection tools

### Step 7: Apply Sigma to more actions

Currently only `inscribe` supports `sigma: boolean`.

- [ ] Add Sigma option to `transferOrdinals`, `listOrdinal`, `createSocialPost`, token ops

## Deferred

- **A2B publish** — `wallet_a2bPublishMcp`, gated by `ENABLE_A2B_TOOLS`. Niche.
- **ECIES encrypt/decrypt** — already working via BRC-100 wallet tools.
- **Diagnostic tools** (P1.9) — BEEF/BUMP/tx parsing for debugging. Nice-to-have.
- **Droplet API mode** — subsidized wallet adapter. When needed.

## Duplicate/Stale Skills to Resolve

| Skill | Status | Resolution |
|-------|--------|-----------|
| `bsv-skills:wallet-send-bsv` | Duplicates `sendBsv` action | Deprecate or keep for raw-WIF-only use |
| `bsv-skills:broadcast-arc` | Implicit in all actions | Deprecate or keep as manual broadcast utility |
| `bsv-skills:message-signing` | Partially overlaps `signBsm` | Update to cover AIP via `applyAip` (now built) |

## Future: CLI Extraction

Actions live in `@1sat/actions` → CLI wraps them → skills call the CLI directly. MCP stays for interactive/conversational use. Functionality first, this is an optimization.

## Repositories

| Repo | Path | Purpose |
|------|------|---------|
| `1sat-sdk` | `/Users/davidcase/Source/1sat/1sat-sdk` | `@1sat/actions` |
| `bsv-mcp` | `/Users/davidcase/Source/1sat/bsv-mcp` | MCP server |
| `bap` | `/Users/davidcase/Source/1sat/bap` | bsv-bap library |
| `sigmaidentity` | `/Users/davidcase/Source/1sat/sigmaidentity` | Sigma Identity website |
| `better-auth-plugin` | `/Users/davidcase/Source/1sat/better-auth-plugin` | @sigma-auth/better-auth-plugin |
| `1sat-skills` | `/Users/davidcase/Source/1sat/1sat-skills` | 1Sat skill definitions |
| `bsv-skills` | `/Users/davidcase/Source/1sat/bsv-skills` | BSV skill definitions |
