# Atomic settlement primitives

The settlement exports from `@1sat/actions` implement the transaction boundary
for draft BRC-178. They support 1Sat Ordinal NFT-only, BSV21-only, and mixed
two-party swaps in one Bitcoin transaction.

## Flow

1. Select active BSV21 transfer tips with `selectBsv21Tips`.
2. Supply the agreed assets, both contributions, source AtomicBEEFs,
   receiver-controlled destinations, and fresh per-token overlay policies in a
   `SettlementPlanV1`.
3. The fixed builder calls `prepareSettlementAction`. Its wallet funds a
   `createAction({ signAndProcess: false, randomizeOutputs: false })`; the
   returned reference remains in `BuilderLocalSettlementActionV1` and must
   never be relayed or persisted by the coordinator.
4. Each asset owner reviews the reconstructed candidate and calls
   `authorizeSettlementInputs` in its own wallet process. The existing ordinal
   signing helper chooses P2PKH or PushDrop from the source script and uses only
   `SIGHASH_ALL | SIGHASH_FORKID`.
5. The builder combines both locally verified unlocking-script sets with
   `finalizeSettlementAction`, which calls `signAction` for the fixed action.

When the builder contributes only ordinary BSV, it has no custom asset input to
authorize separately. Its BRC-100 wallet authorizes and signs the funding inputs
when `signAction` completes the retained action.

Every authorization rebuilds the manifest from the final funded AtomicBEEF.
The manifest binds transaction version, lock time, and every input sequence as
well as ordered inputs and outputs. Finalization rejects signature flags other
than `0x41` and accepts only the single-signature PushDrop and compressed-key P2PKH unlocking
forms supported by the local signer. Script execution is verified separately.
Inputs are located by outpoint, outputs by exact script and satoshis, and every
ordinal's first satoshi is traced through the final input/output ordering.
Construction places ordinal inputs first and their matching receipt spans first;
the final funded transaction is still re-traced because a provider may reorder it.
BSV21 inputs must be fresh, active, unspent `transfer` tips; amounts conserve
per token ID, change is exact, and overlay fees are committed per token.

## Boundaries

- Each wallet must independently establish provenance, token lineage, and
  current unspent status before supplying a plan. The SDK checks script and
  amount consistency and the freshness of supplied status fields; it does not
  authenticate an overlay response or validate asset lineage. Never populate
  those fields directly from an untrusted counterparty message.
- Inventory uses the ordinary `1sat` and `bsv21` baskets. Settlement does not
  depend on a permission-module dispatch basket.
- Presence, offer transport, signed coordinator envelopes, nonces, reservation
  policy, state transitions, recovery, and wallet internalization are application
  responsibilities rather than SDK wire primitives.
- The SDK does not define or sign an offer JSON object. Bitcoin input signatures
  authorize the candidate transaction.
- Receiver-controlled destinations are committed by the final transaction
  signature. Applications still need to obtain those destinations from the
  intended wallet; the SDK does not accept a caller-supplied "verified" boolean.
- Any candidate rebuild requires a new wallet action, final transaction review,
  and signatures. Do not patch a signed candidate in place.

The conformance vectors live in `packages/actions/test/settlement.test.ts`.
