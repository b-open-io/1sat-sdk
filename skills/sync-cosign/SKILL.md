---
name: sync-cosign
description: "This skill should be used when coordinating wallet state across devices or running a cosigner backend — syncing external payments to deposit addresses, polling the message box for inbound payments, pulling cosign-wrapped token deliveries, publishing BAP attestations, or building/validating cosigner-signed BSV21 transfers. Triggers on 'sync addresses', 'sync messages', 'message box', 'cosign delivery', 'attest', 'attestation', 'cosigner', 'cosign transfer', 'multi-device sync', or 'BRC-29 deposit'. Uses @1sat/actions sync and cosign modules."
---

# Sync & Cosign

Coordinate wallet state across devices and run cosigner-validated token flows using `@1sat/actions`.

This skill covers two related areas:
- **Sync actions** pull external value into the wallet: payments to derived deposit addresses, message-box payments, and cosign-wrapped token deliveries.
- **Cosign** covers BAP attestation plus the cosigner-backend helpers that build and finalize cosigner-signed BSV21 transfers.

## Calling Pattern

```typescript
import { createContext, syncAddresses } from '@1sat/actions'

// wallet is positional; options (including services) second
const ctx = createContext(wallet, { services })
const result = await syncAddresses.execute(ctx, {})
```

Every sync action sets `requiresServices: true` — `services` must be present in the context.

## Sync Actions

| Action | Description |
|--------|-------------|
| `syncAddresses` | Internalize external payments to BRC-29 deposit addresses |
| `syncMessages` | Internalize inbound paymail payments from the message box |
| `syncCosignDeliveries` | Pull cosign-wrapped BSV21 deliveries from a MessageBox |

### syncAddresses

Derives BRC-29 deposit addresses (default prefix `"1sat"`), streams new outputs from the 1sat-stack indexer, classifies them, and internalizes them. Tracks a reorg-safe score in a per-identity store (IndexedDB in browsers, `bun:sqlite` in Node/Bun) so repeat calls only process new outputs. After internalizing, it rotates plain-BSV inbounds into a fresh BRC-29 funding output via `sweepDeposit`.

Use this on wallet mount or on a schedule to pick up payments sent to the wallet's deposit addresses from any device.

```typescript
import { createContext, syncAddresses } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await syncAddresses.execute(ctx, {
  prefix: '1sat',   // optional, defaults to '1sat'
  startIndex: 0,    // optional, default 0
  count: 1,         // optional, default 1
  onProgress: (p) => console.log(p),  // optional UI callback
})

console.log(`processed ${result.processed}, failed ${result.failed}`)
```

```typescript
// Input: SyncAddressesInput
interface SyncAddressesInput {
  prefix?: string       // keyID prefix, default 'DEFAULT_DEPOSIT_PREFIX' ("1sat")
  startIndex?: number   // first address index, default 0
  count?: number        // number of addresses, default 1
  onProgress?: (progress: SyncProgress) => void
}

// Result: SyncAddressesResult
interface SyncAddressesResult {
  processed: number     // txs internalized
  failed: number        // txs that failed to internalize
  lastScore: number     // reorg-safe score; pass as fromScore next call
  addresses: string[]   // addresses synced
}
```

### syncMessages

Polls a message box (default `"payment_inbox"`) at `${services.baseUrl}/1sat/messagebox` using `AuthFetch`, internalizes each BRC-29 paymail payment, and acknowledges only the messages that internalized successfully.

```typescript
import { createContext, syncMessages } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await syncMessages.execute(ctx, {
  messageBox: 'payment_inbox',  // optional, this is the default
})

console.log(`processed ${result.processed}, failed ${result.failed}`)
```

```typescript
// Input: SyncMessagesInput
interface SyncMessagesInput {
  messageBox?: string   // default 'payment_inbox'
}

// Result: SyncMessagesResult
interface SyncMessagesResult {
  processed: number
  failed: number
}
```

### syncCosignDeliveries

One-shot pull from a MessageBox slot (default `"cosign_token_inbox"`, server default `https://messagebox.1sat.app`) used by cosign-wrapped BSV21 mints and transfers. Bodies are BRC-2 ECDH/AES-256-GCM ciphertext; this action unwraps and decrypts them with the wallet, then internalizes the owned output into the `bsv21` basket with the supplied `customInstructions` verbatim. When `services` is present it enriches tags with token symbol/icon/decimals from the BSV21 overlay.

```typescript
import { createContext, syncCosignDeliveries } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await syncCosignDeliveries.execute(ctx, {
  messageBox: 'cosign_token_inbox',         // optional default
  messageboxUrl: 'https://messagebox.1sat.app',  // optional default
})

console.log(`processed ${result.processed}, failed ${result.failed}`)
```

```typescript
// Input: SyncCosignDeliveriesInput
interface SyncCosignDeliveriesInput {
  messageBox?: string     // default 'cosign_token_inbox'
  messageboxUrl?: string  // default 'https://messagebox.1sat.app'
}

// Result: SyncCosignDeliveriesResult
interface SyncCosignDeliveriesResult {
  processed: number
  failed: number
}
```

## Attest

`attest` is an `Action` (publishes a transaction), so it uses the same `createContext` / `.execute` pattern. It publishes a BAP ATTEST OP_RETURN (`BAP_PREFIX | "ATTEST" | attestationHash | counter`) signed with AIP via the current signing key. The output lands in the `bap` basket. Requires that an identity has already been published (see `../identity/SKILL.md`).

```typescript
import { createContext, attest } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await attest.execute(ctx, {
  attestationHash: '<sha256 of urn:bap:id:attribute:value:nonce>',
  counter: '0',   // optional, default '0'
})

if (result.error) {
  // e.g. 'no-identity: publish identity first'
} else {
  console.log('Attested. txid:', result.txid)
}
```

```typescript
// Input: AttestRequest
interface AttestRequest extends ActionOptions {
  /** SHA-256 hash of the attestation URN */
  attestationHash: string
  /** Attestation sequence number, default '0' */
  counter?: string
}

// Response: IdentityResponse
interface IdentityResponse {
  txid?: string
  tx?: number[]
  bapId?: string
  error?: string
}
```

The output is tagged `type:attest`, `hash:<attestationHash>`.

## Cosigner Transfer Helpers

These are plain async functions, not `Action` objects — they do **not** take a context or use `.execute`. Each takes a single input object that carries its own `wallet` and `services`. They are intended for a cosigner backend that constructs, validates, and broadcasts cosigner-signed BSV21 transfers.

### buildCosignDestination

Derives a cosign-wrapped locking script for a recipient using BRC-42 derivation between the caller's wallet and the recipient, embedding the cosigner's identity key as second signer. This one takes a context (it derives via `ctx.wallet`).

```typescript
import { createContext, buildCosignDestination } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const { lockingScript, address } = await buildCosignDestination(ctx, {
  recipientIdentityKey: '<recipient identity pubkey hex>',
  cosignerIdentityKey: '<cosigner identity pubkey hex>',
  keyID: '<brc-42 derivation keyID>',
})
```

```typescript
// Input: BuildCosignDestinationInput
interface BuildCosignDestinationInput {
  recipientIdentityKey: string
  cosignerIdentityKey: string
  keyID: string
}

// Result: BuildCosignDestinationResult
interface BuildCosignDestinationResult {
  lockingScript: LockingScript
  address: string
}
```

### prepareCosignBsv21Transfer

Phase one of the two-request cosigner flow. The cosigner constructs the unsigned tx (cosign-wrapped transfer outputs, optional multisig holding outputs, optional burns), allocates funding via its own BRC-100 wallet (`createAction` with `signAndProcess: false`), persists the session via the supplied `CosignSessionStore`, and returns the signable BEEF plus per-input sighashes for the sender to sign.

```typescript
import {
  prepareCosignBsv21Transfer,
  InMemoryCosignSessionStore,
} from '@1sat/actions'

const sessionStore = new InMemoryCosignSessionStore()
const prepared = await prepareCosignBsv21Transfer({
  wallet: cosignerWallet,        // WalletInterface (cosigner's BRC-100 wallet)
  services,                      // OneSatServices
  tokenId,
  tokenInputs: [{ outpoint }],
  inputBEEF,                     // number[] atomic BEEF of inputs
  destinations: [{ recipientIdentityKey, amount }],
  senderIdentityKey,
  sessionStore,
})
// prepared: { sessionId, signableBeef, reference, sighashes }
```

```typescript
// Input: PrepareCosignBsv21TransferInput (selected fields)
interface PrepareCosignBsv21TransferInput {
  wallet: WalletInterface
  services: OneSatServices
  tokenId: string
  tokenInputs: CosignTokenInput[]          // { outpoint: 'txid.vout' }
  inputBEEF: number[]
  destinations: CosignTransferDestination[] // { recipientIdentityKey, amount }
  multisigDestinations?: CosignTransferMultisigDestination[]
  burns?: CosignTransferBurn[]              // { amount }
  senderIdentityKey: string
  sessionStore: CosignSessionStore
}

// Result: PrepareCosignBsv21TransferResult
interface PrepareCosignBsv21TransferResult {
  sessionId: string
  signableBeef: number[]
  reference: string
  sighashes: Array<{ inputIndex: number; sighashHex: string }>
}
```

Sighashes use `SIGHASH_ALL | SIGHASH_FORKID` (`0x41`). The sender's wallet signs the single-SHA256 of each sighash.

### finalizeCosignBsv21Transfer

Phase two. The sender returns owner-side signatures; the cosigner adds its own signature per cosign-wrapped input, calls `signAction` to broadcast, submits the resulting BEEF to the BSV21 overlay, and returns per-recipient delivery payloads for messagebox dispatch.

```typescript
import { finalizeCosignBsv21Transfer } from '@1sat/actions'

const finalized = await finalizeCosignBsv21Transfer({
  wallet: cosignerWallet,
  services,
  sessionId: prepared.sessionId,
  ownerSigs: [
    { inputIndex: 0, sigHex: '<der sig hex>', ownerPubkeyHex: '<pubkey hex>' },
  ],
  sessionStore,
})
// finalized: { txid, beef, overlayStatus, recipients }
```

```typescript
// Input: FinalizeCosignBsv21TransferInput
interface FinalizeCosignBsv21TransferInput {
  wallet: WalletInterface
  services: OneSatServices
  sessionId: string
  ownerSigs: CosignOwnerSig[]   // { inputIndex, sigHex, ownerPubkeyHex }
  sessionStore: CosignSessionStore
}

// Result: FinalizeCosignBsv21TransferResult
interface FinalizeCosignBsv21TransferResult {
  txid: string
  beef: number[]
  overlayStatus: string
  recipients: CosignRecipientPayload[]  // { identityKey, vout, amount, customInstructions }
}
```

Recipients consume their `customInstructions` via `syncCosignDeliveries` (above), which internalizes the delivered output into the `bsv21` basket.

### Session Store

`prepare`/`finalize` share state through a `CosignSessionStore`:

```typescript
interface CosignSessionStore {
  save(session: CosignTransferSession): Promise<void>
  load(sessionId: string): Promise<CosignTransferSession | null>
  delete(sessionId: string): Promise<void>
}
```

`InMemoryCosignSessionStore` is the default for tests and ephemeral demos. Supply a persistent implementation (e.g. Postgres-backed) for a real backend.

The two-phase signing mechanics (signable BEEF rebuild, script verification, `signAction`, abort on failure) are covered in `../action-patterns/SKILL.md`.

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @1sat/client @bsv/sdk
```

Sync actions require `services` in the context. `syncCosignDeliveries` and the cosign transfer helpers additionally use `@bsv/p2p` MessageBox and the BSV21 overlay via `services`.
