---
name: action-patterns
description: "This skill should be used when understanding how @1sat/actions work — the action/context pattern, two-phase signing (createAction/signAction), BEEF resolution, the action registry, baskets and tags. Triggers on 'createContext', 'action.execute', 'createAction', 'signAction', 'sign transaction', 'inputBEEF', 'completeSignedAction', 'action registry', 'baskets', 'tags', or 'BRC-100'. Uses @1sat/actions."
---

# Action Patterns

The shared mechanics behind every `@1sat/actions` operation: the action/context pattern, two-phase signing, BEEF resolution, the registry, and baskets/tags. For a specific operation, jump to the domain skill (pointers below).

## The Action System

Every operation is an `Action` with `meta` (name, description, category, input schema) and an `execute(ctx, input)` method:

```
createContext(wallet, { services }) → action.execute(ctx, input) → { txid, tx, error }
```

Actions work with any BRC-100 compatible wallet (OneSatWallet, browser extension, wallet-remote, etc).

### Context Setup

`createContext` takes the **wallet positionally** and an options object second:

```typescript
import { createContext } from '@1sat/actions'

// Wallet only
const ctx = createContext(wallet)

// Wallet + services (for network operations) and other options
const ctx = createContext(wallet, {
  services,        // OneSatServices for network-dependent actions
  chain: 'main',   // 'main' | 'test' (default 'main')
  debug: true,     // emit derivation logs for fund recovery
})
```

Actions whose `meta.requiresServices` is true need `services` in the context.

### Running an Action

```typescript
import { createContext, sendBsv } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await sendBsv.execute(ctx, {
  requests: [{ address: '1Recipient...', satoshis: 50000 }],
})
```

All transaction-producing actions return `tx?: number[]` (AtomicBEEF), not hex strings.

## The Two-Phase Signing Pattern

Operations that spend custom scripts (ordinals, locks, tokens) build the transaction first, then sign it in a second phase. Single-phase plain sends (sendBsv/sendAllBsv) skip this entirely.

### Id-first P1SAT assets

Wallet-owned non-fungible assets (OpNS, ordinals, locks) use **`id:`** tags in their domain basket.

- **Spend (owned):** pass `{ id }` only. Action loads the row + BEEF via `loadBasketOutputBeef(basket, id)`. Do not pass a stale `WalletOutput` as the source of truth.
- **Self-move filing:** `ordinalSeedTags(output)` + fixed domain basket + action-specific tags. Do **not** use `resolveOrdinalTags` for owned assets.
- **List/read:** tags/CI on by default; BEEF off unless `include: 'entire transactions'`.
- **External spend (buy):** `{ outpoint, inputBEEF? }` — BEEF if provided, else services fetch, else error. Plus path-specific fields.
- **Fungible (BSV21):** value API (`tokenId`, amounts); internal UTXOs still have `id:`; self destinations must stay basketed.

Helpers: `loadBasketOutput` / `loadBasketOutputBeef`, `ordinalSeedTags`, `toIdTag`.

### inputBEEF: When Required vs Optional

`inputBEEF` provides the SPV proof chain for the inputs being spent:

- **Owned id-first paths:** caller usually omits BEEF — action loads it from the basket by `id`.
- **External inputs:** pass `inputBEEF` or rely on services fetch (buy paths). Wallet has no proof for foreign UTXOs.

### Phase 1: createAction (build the transaction)

```typescript
const createResult = await wallet.createAction({
  description: 'Transfer ordinal',
  inputBEEF: beefData,          // optional for wallet-owned inputs, required for external
  inputs: [{
    outpoint: 'txid.vout',
    inputDescription: 'Ordinal to transfer',
    unlockingScriptLength: 108, // expected script size
  }],
  outputs: [{
    lockingScript: '76a914...88ac',
    satoshis: 1,
    outputDescription: 'Transferred ordinal',
    basket: 'ordinals',
    tags: ['type:image/png', 'origin:abc...'],
    customInstructions: JSON.stringify({ protocolID, keyID }),
  }],
  options: {
    signAndProcess: false,      // don't auto-sign yet
    randomizeOutputs: false,    // preserve output order
  },
})
```

### Phase 2: completeSignedAction (sign and finalize)

Use the `completeSignedAction` helper for all two-phase actions. It handles BEEF merge (fixing stripped merkle proofs), script verification, `signAction`, and automatic `abortAction` on failure.

```typescript
import { completeSignedAction } from '@1sat/actions'

const result = await completeSignedAction(
  wallet,
  createResult,           // from createAction with signAndProcess: false
  inputBEEF as number[],  // BEEF from listOutputs (has full SPV proof chain)
  async (tx) => {
    // tx is a fully-wired Transaction ready for signing.
    // Return unlocking scripts keyed by input index.
    const spends: Record<number, { unlockingScript: string }> = {}
    spends[0] = { unlockingScript: myUnlockingScript.toHex() }
    return spends
  },
)

// result.txid is the broadcast transaction ID
```

**Why not raw `signAction`?** The signable transaction BEEF from `createAction` has merkle proofs stripped (wallet-toolbox uses `mergeRawTx` internally, raw txs only, no bumps). `completeSignedAction` merges the unsigned tx back into `inputBEEF` to reconstruct the full proof chain before signing. It also verifies unlocking scripts against locking scripts before submitting, and aborts the action automatically if signing fails.

## Action Registry

All actions are registered in a global registry:

```typescript
import { actionRegistry } from '@1sat/actions'

// List all registered actions
for (const action of actionRegistry.list()) {
  console.log(`${action.meta.name} (${action.meta.category})`)
}

// Get a specific action
const send = actionRegistry.get('sendBsv')

// Convert to MCP tool definitions
const tools = actionRegistry.toMcpTools()
```

The complete, generated list of all actions:

<!-- ACTION-INDEX -->
_54 actions, generated from the registry — do not edit by hand._

| Category | Action | Services | Purpose |
|----------|--------|:--------:|---------|
| `addresses` | `deriveDepositAddresses` |  | Derive P1SAT deposit addresses for receiving payments, ordinals, or tokens |
| `collections` | `mintCollection` |  | Create a new ordinals collection with traits, rarity labels, and royalty configuration |
| `collections` | `mintCollectionItem` |  | Create a collection item inscription linked to a parent collection via collectionId |
| `identity` | `attest` |  | Publish a BAP attestation signed with BAP identity |
| `identity` | `getProfile` |  | Read current BAP identity profile from wallet |
| `identity` | `publishIdentity` |  | Publish initial BAP identity record from wallet |
| `identity` | `rotateIdentity` |  | Rotate BAP signing key to the next derived key |
| `identity` | `updateProfile` |  | Update BAP identity profile signed with BAP identity |
| `inscriptions` | `inscribe` |  | Create a new inscription (single tx, or OrdFS multi-tx stream when stream/streamChunkSize is set) |
| `locks` | `getLockData` |  | Get summary of time-locked BSV (total, unlockable, next unlock height) |
| `locks` | `listLocks` |  | List time-locked BSV UTXOs (metadata by default) |
| `locks` | `lockBsv` |  | Lock BSV until a specific block height |
| `locks` | `unlockBsv` |  | Unlock matured time-locked BSV (all unlockable, or specific ids) |
| `opns` | `buyOpns` | ✓ | Purchase an OpNS name listing into the OPNS basket |
| `opns` | `cancelOpnsListing` |  | Cancel an OpNS name listing back into the OPNS basket |
| `opns` | `deregisterOpns` |  | Remove identity bind from an OpNS name (self-transfer to P2PKH) |
| `opns` | `internalizeOpns` |  | Internalize a foreign-created OpNS mint (AtomicBEEF) into the OPNS basket |
| `opns` | `listOpns` |  | List OpNS names from the wallet (metadata by default; optional BEEF) |
| `opns` | `registerOpns` |  | Bind BRC-100 identity key to an OpNS name via signed PushDrop |
| `opns` | `sellOpns` |  | List an OpNS name for sale |
| `opns` | `sendOpns` |  | Transfer an OpNS name to a new owner |
| `ordinals` | `burnOrdinals` |  | Burn one or more ordinals by sending to OP_RETURN |
| `ordinals` | `buyOrdinal` | ✓ | Purchase an ordinal from the global orderbook |
| `ordinals` | `cancelOrdinalListing` |  | Cancel an ordinal listing and return the ordinal to the wallet |
| `ordinals` | `listOrdinals` |  | List ordinals/inscriptions (metadata by default; optional BEEF) |
| `ordinals` | `sellOrdinal` |  | List an ordinal for sale on the global orderbook |
| `ordinals` | `sendOrdinals` |  | Transfer one or more ordinals to new owners |
| `payments` | `getMneeBalance` | ✓ | Get MNEE stablecoin balance across yours wallet addresses |
| `payments` | `getMneeConfig` | ✓ | Get MNEE service configuration including cosigner and fee structure |
| `payments` | `getMneeHistory` | ✓ | Get MNEE transaction history with parsed amounts and counterparties |
| `payments` | `getMneeTxStatus` | ✓ | Get the status of an MNEE transfer |
| `payments` | `getMneeUtxos` | ✓ | Get MNEE UTXOs across yours wallet addresses |
| `payments` | `sendAllBsv` |  | Send all BSV from wallet to a single destination address |
| `payments` | `sendBsv` |  | Send BSV to one or more destinations (addresses, scripts, or OP_RETURN) |
| `payments` | `sendMnee` | ✓ | Send MNEE stablecoin to one or more recipients |
| `signing` | `decryptFromCounterparty` |  | Decrypt data from a counterparty using Type-42 key derivation |
| `signing` | `encryptForCounterparty` |  | Encrypt data for a counterparty using Type-42 key derivation |
| `signing` | `getAuthToken` |  | Generate a BRC-77 auth token for HTTP request signing |
| `signing` | `getFriendPublicKey` |  | Derive a public key for a counterparty using Type-42 key derivation |
| `signing` | `signBsm` |  | Sign a message using BSM (Bitcoin Signed Message) format |
| `social` | `createSocialPost` |  | Create an on-chain social post signed with BAP identity |
| `sweep` | `sweepBsv` | ✓ | Sweep BSV from external wallet (via WIF) into the connected wallet |
| `sweep` | `sweepBsv21` | ✓ | Sweep BSV-21 tokens from external wallet (via WIF) into the connected wallet |
| `sweep` | `sweepOrdinals` | ✓ | Sweep ordinals from external wallet (via WIF) into the connected wallet |
| `sync` | `syncAddresses` | ✓ | Sync external payments to BRC-29 deposit addresses into the wallet |
| `sync` | `syncCosignDeliveries` | ✓ | Pull cosign-wrapped BSV21 deliveries from a MessageBox and internalize them into the wallet |
| `sync` | `syncMessages` |  | Sync incoming paymail payments from the message box into the wallet |
| `tokens` | `buyBsv21` | ✓ | Purchase BSV21 tokens from the marketplace |
| `tokens` | `deployBsv21Auth` |  | Deploy a new BSV21 token with mintable supply via auth UTXOs (deploy+auth) |
| `tokens` | `deployBsv21Mint` |  | Deploy a new BSV21 token with fixed supply (deploy+mint) |
| `tokens` | `getBsv21Balances` |  | Get aggregated BSV21 token balances grouped by token ID |
| `tokens` | `listBsv21` |  | List BSV21 token outputs from the wallet |
| `tokens` | `mintBsv21` | ✓ | Spend an auth UTXO to mint new supply and/or re-issue authority |
| `tokens` | `sendBsv21` |  | Send BSV21 tokens to one or more recipients |
<!-- /ACTION-INDEX -->

## Baskets and Tags

The wallet organizes outputs into baskets:

| Basket | Contents |
|--------|----------|
| `ordinals` | Ordinal inscriptions (NFTs) |
| `bsv21` | BSV-21 fungible tokens |
| `bsocial` | Social protocol outputs (posts, likes, follows) |
| `locks` | Time-locked BSV |
| `opns` | OpNS name ordinals |
| `bap` | BAP identity outputs |

Tags on outputs provide metadata for filtering and for the ID-tag BEEF resolution used by two-phase actions:

```typescript
const result = await wallet.listOutputs({
  basket: 'ordinals',
  includeTags: true,
  includeCustomInstructions: true,
  include: 'entire transactions', // include BEEF for spending
  limit: 100,
})
```

## Domain Skills

Per-operation detail lives in sibling skills, not here:

- Sending BSV, batch payments, OP_RETURN, deposit addresses: see ../payments
- Inscriptions: see ../inscriptions
- Ordinals (transfer, list, purchase): see ../ordinals
- Tokens (deploy, mint, send, burn): see ../tokens
- Locks: see ../locks
- Message signing (BSM): see ../signing
- BAP identity (publish, profile, attest): see ../identity
- Social posts: see ../social
- OpNS: see ../opns
- Sweep: see ../sweep

## Low-Level Custom Building

For truly low-level, custom transaction construction outside the action system, `@1sat/core` (TxBuilder, protocol helpers) and `@1sat/templates` (Inscription, OrdP2PKH, OrdLock, Lock, BSV20, BSV21 script templates) are available. Note: token deploy/mint/burn and ordinal operations now have first-class actions — use ../tokens and ../ordinals rather than dropping to `@1sat/core` for those.

## Requirements

```bash
bun add @1sat/actions @bsv/sdk
```
