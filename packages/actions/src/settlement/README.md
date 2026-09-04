# Atomic settlement primitives

The settlement exports from `@1sat/actions` implement the transaction-construction boundary for
wire version 1 of `1sat-p2p-settlement`. It supports ordinal-only, BSV21-only,
and mixed two-party swaps in one Bitcoin transaction.

## Flow

1. Canonicalize and validate the mutually locked offer with
   `lockedOfferDigest`.
2. Select active BSV21 transfer tips with `selectBsv21Tips`, then acquire a
   provider-bound lease through `reserveSettlementInputs`.
3. Supply both verified contributions, source AtomicBEEFs, receiver-controlled
   destinations, and fresh per-token overlay policies in a `SettlementPlanV1`.
4. The fixed builder calls `prepareSettlementAction`. Its wallet funds a
   `createAction({ signAndProcess: false, randomizeOutputs: false })`; the
   returned reference remains in `BuilderLocalSettlementActionV1` and must
   never be relayed or persisted by the coordinator.
5. Each owner calls `createSettlementSigningRequest` and
   `authorizeSettlementInputs` in its own wallet process. The request contains
   exact BIP-143 preimages and permits only `SIGHASH_ALL | SIGHASH_FORKID`.
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
- The SDK exposes a durable reservation adapter contract but does not pretend a
  local lease is a global UTXO lock.
- Signed coordinator envelopes, nonces, state transitions, broadcast leases,
  evidence recovery, and idempotent wallet internalization are separate layers.
- A destination is accepted only after the caller marks its ownership proof as
  verified. Provider integrations must verify the wallet signature or regenerate
  the destination before constructing the plan.
- Any attempt rebuild requires a new attempt number, destinations, reservations,
  wallet action, and signatures. Do not patch a template in place.

The conformance vectors live in `packages/actions/test/settlement.test.ts`.
