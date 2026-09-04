# Atomic settlement primitives

The settlement exports from `@1sat/actions` implement the transaction boundary
for draft BRC-178. They support ordinal-only, BSV21-only, and mixed two-party
swaps in one Bitcoin transaction.

## Flow

1. Canonicalize and validate the mutually locked offer with
   `lockedOfferDigest`.
2. Select active BSV21 transfer tips with `selectBsv21Tips`.
3. Supply both contributions, source AtomicBEEFs, receiver-controlled
   destinations, and fresh per-token overlay policies in a `SettlementPlanV1`.
4. The fixed builder calls `prepareSettlementAction`. Its wallet funds a
   `createAction({ signAndProcess: false, randomizeOutputs: false })`; the
   returned reference remains in `BuilderLocalSettlementActionV1` and must
   never be relayed or persisted by the coordinator.
5. Each owner reviews the reconstructed template and calls
   `authorizeSettlementInputs` in its own wallet process. The existing ordinal
   signing helper chooses P2PKH or PushDrop from the source script and uses only
   `SIGHASH_ALL | SIGHASH_FORKID`.
6. The builder combines both locally verified authorizations with
   `finalizeSettlementAction`, which calls `signAction` for the fixed action.

Every authorization rebuilds the manifest from the final funded AtomicBEEF.
Inputs are located by outpoint, outputs by exact script and satoshis, and every
ordinal's first satoshi is traced through the final input/output ordering.
Construction places ordinal inputs first and their matching receipt spans first;
the final funded transaction is still re-traced because a provider may reorder it.
BSV21 inputs must be fresh, active, unspent `transfer` tips; amounts conserve
per token ID, change is exact, and overlay fees are committed per token.

## Boundaries

- Inventory uses the ordinary `1sat` and `bsv21` baskets. Settlement does not
  depend on a permission-module dispatch basket.
- Presence, offer transport, signed coordinator envelopes, nonces, reservation
  policy, state transitions, recovery, and wallet internalization are application
  responsibilities rather than SDK wire primitives.
- Receiver-controlled destinations are committed by the final transaction
  signature. Applications still need to obtain those destinations from the
  intended wallet; the SDK does not accept a caller-supplied "verified" boolean.
- Any attempt rebuild requires a new attempt number, wallet action, final
  template review, and signatures. Do not patch a template in place.

The conformance vectors live in `packages/actions/test/settlement.test.ts`.
