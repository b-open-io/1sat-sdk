---
name: mnee
description: "This skill should be used when working with MNEE — the USD-pegged stablecoin on BSV. Covers checking MNEE balance, listing MNEE UTXOs, reading MNEE service config (cosigner/fees), fetching parsed MNEE transaction history, checking a transfer's status by ticket, and sending MNEE to recipients. Triggers on 'MNEE', 'stablecoin', 'USD on BSV', 'MNEE balance', 'send MNEE', 'MNEE history', 'MNEE config', 'MNEE transfer status', or 'cosign token'. Uses @1sat/actions mnee module."
---

# MNEE

Query and transfer MNEE, the USD-pegged stablecoin on BSV, using `@1sat/actions`.

MNEE outputs are cosign-locked BSV-20 inscriptions: a user-owned P2PKH check plus an MNEE approver (cosigner) signature. Sends are built and signed locally with the caller-supplied BRC-42 self-key (`KeyDerivation`: `protocolID` + `keyID`, `counterparty` omitted → `'self'`), then submitted to the MNEE API which co-signs and broadcasts. Amounts in inputs/outputs are in **MNEE decimal** (e.g. `1.5` = $1.50); atomic units are `decimal * 100_000`.

Funds deposited before the protocol rename live under `LEGACY_ONESAT_PROTOCOL` (`[0, 'p 1sat']`); new deposits use `ONESAT_PROTOCOL` (`[0, 'onesat']`). The same `keyID` under two protocols is two addresses. Pass **both** protocol sets into `sendMnee` / `getMneeBalance({ derivations })` or old funds are invisible and unspendable.

All MNEE actions require `services` (they call `services.mnee`):

```typescript
const ctx = createContext(wallet, { services })
```

If `services.mnee` is missing, the action throws `MNEE client not available — services required`.

## getMneeConfig

Returns the MNEE service configuration: cosigner (`approver`) pubkey, fee/burn/mint addresses, fee tiers, decimals, and token id.

```typescript
import { createContext, getMneeConfig } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Input: GetMneeConfigInput = {}
const config = await getMneeConfig.execute(ctx, {})

// Result: MneeConfig
// {
//   approver: string       // cosigner compressed pubkey hex
//   feeAddress: string
//   burnAddress: string
//   mintAddress: string
//   fees: { min: number; max: number; fee: number }[]  // atomic-unit tiers
//   decimals: number
//   tokenId: string
// }
```

## getMneeBalance

Returns per-address balances plus totals. Pass **either** `addresses` **or** `derivations` (not both). `derivations` are resolved to addresses the same way `sendMnee` does, so balance and send read the same set.

```typescript
import { createContext, getMneeBalance, LEGACY_ONESAT_PROTOCOL, ONESAT_PROTOCOL } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Input: GetMneeBalanceInput = { addresses: string[] } | { derivations: KeyDerivation[] }
const res = await getMneeBalance.execute(ctx, {
  derivations: [
    { protocolID: ONESAT_PROTOCOL, keyID: '1sat 0' },
    { protocolID: LEGACY_ONESAT_PROTOCOL, keyID: '1sat 0' },
  ],
})
// or: getMneeBalance.execute(ctx, { addresses: ['1A1zP1...'] })

// Result: GetMneeBalanceResult
// {
//   balances: {
//     address: string
//     amount: number        // atomic units
//     decimalAmount: number // MNEE decimal
//   }[]
//   totalDecimal: number
//   totalAtomic: number
// }
```

## getMneeUtxos

Returns the raw MNEE UTXOs across the given addresses.

```typescript
import { createContext, getMneeUtxos } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Input: GetMneeUtxosInput
const res = await getMneeUtxos.execute(ctx, {
  addresses: ['1A1zP1...'],
})

// Result: GetMneeUtxosResult { utxos: MneeUtxo[] }
// MneeUtxo: {
//   txid: string; vout: number; outpoint: string; satoshis: number
//   script: string; owners: string[]; senders: string[]
//   height: number; idx: number; score: number
//   data: {
//     bsv21?: { id; op; amt; sym; icon; dec }   // amt is atomic units
//     cosign?: { address; cosigner }
//   }
// }
```

## getMneeHistory

Returns parsed transaction history (send/receive direction, net amounts, fees, counterparties) for the given addresses. Supports cursor pagination via `fromScore` / `nextScore`.

```typescript
import { createContext, getMneeHistory } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Input: GetMneeHistoryInput
const res = await getMneeHistory.execute(ctx, {
  addresses: ['1A1zP1...'],
  fromScore: undefined, // optional pagination cursor
  limit: 50,            // optional, default 50
})

// Result: GetMneeHistoryResult
// {
//   history: {
//     txid: string
//     height: number
//     type: 'send' | 'receive'
//     status: 'confirmed' | 'unconfirmed'
//     amount: number    // atomic units, net of fees and self-change
//     fee: number       // atomic units (sends only)
//     score: number     // pagination cursor
//     counterparties: { address: string; amount: number }[]
//   }[]
//   nextScore?: number  // pass as fromScore in the next call
// }
```

Note: history is parsed relative to the first address in `addresses` (used as the "self" perspective for send/receive classification).

## getMneeTxStatus

Checks the status of a submitted transfer by its ticket id (returned from `sendMnee`).

```typescript
import { createContext, getMneeTxStatus } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Input: GetMneeTxStatusInput
const status = await getMneeTxStatus.execute(ctx, {
  ticketId: 'abc123...',
})

// Result: MneeTransferStatus
// {
//   id: string
//   tx_id: string
//   tx_hex: string
//   action_requested: string
//   status: 'BROADCASTING' | 'SUCCESS' | 'MINED' | 'FAILED'
//   createdAt: string
//   updatedAt: string
//   errors: string | null
// }
```

## sendMnee

Builds the transfer transaction, selects MNEE UTXOs, signs each cosign input with the matching self key, submits to the MNEE API for cosignature + broadcast, then polls until the txid is known.

You must supply `derivations: KeyDerivation[]` (`protocolID` + `keyID`; `counterparty` optional, defaults `'self'`). Addresses are derived from those triples — do not pass `AddressDerivation`. Amounts are in MNEE decimal.

```typescript
import { createContext, sendMnee, LEGACY_ONESAT_PROTOCOL, ONESAT_PROTOCOL } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Input: SendMneeInput
const result = await sendMnee.execute(ctx, {
  recipients: [
    { address: '1Recipient...', amount: 1.5 }, // $1.50 in MNEE decimal
  ],
  derivations: [
    { protocolID: ONESAT_PROTOCOL, keyID: '1sat 0' },
    { protocolID: LEGACY_ONESAT_PROTOCOL, keyID: '1sat 0' },
  ],
  changeAddress: '1Change...', // optional; defaults to first input's address
})

// Result: SendMneeResult
// {
//   txid?: string      // present once SUCCESS/MINED
//   ticketId?: string  // present even on timeout — use getMneeTxStatus later
//   error?: string
// }
```

`sendMnee` never throws; failures come back as `result.error`. Possible error strings include `no-recipients`, `no-derivations`, `failed-to-get-mnee-config`, `invalid-amount`, `fee-ranges-inadequate`, an `Insufficient MNEE. Have: … Need: …` message, `failed-to-fetch-source-tx: <txid>`, `no-ticket-id-returned`, and `timeout-waiting-for-txid` (in which case `ticketId` is returned so you can poll with `getMneeTxStatus`).

Unlike the two-phase custom-script actions, `sendMnee` signs inline (cosign inputs submitted to the MNEE cosigner) and does not use `completeSignedAction`. For the general two-phase signing pattern see [../action-patterns](../action-patterns).

## Requirements

```bash
bun add @1sat/actions @bsv/sdk
```

All MNEE actions require a context built with `services` (`createContext(wallet, { services })`).
