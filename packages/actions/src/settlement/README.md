# Collaborative settlement

SDK integration for [BRC-178](https://github.com/opldotdev/BRCs/blob/afab430a898859bd544ce5beb13baec136a1dc4c/tokens/0178.md):
two-party ordinal, BSV21, BSV-for-asset, and mixed swaps. The BRC defines the
protocol and conformance requirements; this guide explains the SDK entry points
and the application code needed to use them. Import these exports from `@1sat/actions`.

## Trade-window integration

Create a session with `createSettlementSession`: a unique ID, sorted participant
identity keys, chain, builder, and agreed mining/overlay fee limits. Offers start
empty. This SDK requires both offers to be nonempty before confirmation and the
BSV payer to be the builder. Changing chain, builder, or fee limits requires a
new session.

Pass authenticated operations to `updateSettlementSession(state, operation,
authenticatedActor)`. Use `edit` to replace the actor's item list and `ready`
with an explicit boolean to confirm or withdraw. Include the session ID, current
revision, and a monotonic per-actor sequence; retries reuse the same sequence and
boolean. Edits clear both ready flags. Repeated confirmation/withdrawal is allowed
until the reducer returns `attempt-started`.

Persist every accepted transition atomically using the input state's `version`
as a compare-and-swap guard. On conflict, reload and reapply. Only the winning
persisted `attempt-started` transition may schedule wallet work; use a durable
unique job/outbox or equivalent to recover crashes without duplicate allocation.
The reducer supplies no storage or transport. Do not run competing authoritative
copies, and render readiness from acknowledged state.

See [negotiation and readiness](https://github.com/opldotdev/BRCs/blob/afab430a898859bd544ce5beb13baec136a1dc4c/tokens/0178.md#negotiation-and-readiness)
for operation ordering and the boundary after which withdrawal cannot stop an attempt.

## Wallet workflow

1. Resolve frozen offers into a `SettlementPlanV1`, including receiver-approved
   scripts and remittance data. Supply the evidence adapter described below.
2. Call `prepareConfirmedSettlement` once for the persisted attempt. It checks
   the plan against the session, funds a tracked wallet action, and reviews the
   candidate against the agreed fee limits. Keep `prepared.localAction` on the
   builder; relay only `prepared.candidate` to the other wallet.
3. Persist `signing-started` through `advanceSettlementAttempt` **before any
   signer runs**, including a BSV-only builder's funding signer.
4. Each asset owner calls `authorizeConfirmedSettlement` with its local signing
   metadata. The builder passes the authorizations and retained local action to
   `finalizeConfirmedSettlement`.

The application must serialize each attempt and check its latest persisted state
before wallet work. These wrappers snapshot arguments; they do not reload storage
or acquire locks. Readiness does not replace wallet approval. Failed review after
allocation attempts to abort the retained wallet action.

### Evidence adapter

Provide `SettlementSessionReviewOptions.verifyEvidence(plan, candidate?)`, an
async wallet-local function that throws on failure. There is no default validator
or automatic network access. Implement the BRC's
[evidence and trust model](https://github.com/opldotdev/BRCs/blob/afab430a898859bd544ce5beb13baec136a1dc4c/tokens/0178.md#evidence-and-trust-model)
and preserve its required
[proof packaging](https://github.com/opldotdev/BRCs/blob/afab430a898859bd544ce5beb13baec136a1dc4c/tokens/0178.md#proof-packaging).
This includes asset lineage/provenance, current spent status, receiver destinations,
and fee policy; counterparty status assertions are not verification.

The callback runs before allocation without a candidate, after funding with the
candidate, and before authorization/finalization with the candidate. Include added
funding inputs in verification when a candidate is supplied. Keep complete asset
proofs in the adapter: `sourceBEEFs` provides transaction-signing data, not a
substitute for lineage proofs.

Arguments are copies. Resolve or refresh the plan before calling a wrapper; the
callback cannot update it in place. Set `maxEvidenceAgeMs` from local policy and
use local observation times. `now` is a deterministic testing clock; normally
omit it in production. A no-op verifier does not satisfy the adapter contract.

## Recovery

Feed `advanceSettlementAttempt` trusted local events bound to the session and
attempt, never unverified peer commands:

- `failed` before signing reopens negotiation. Abort any retained action first.
- `failed` after `signing-started` enters reconciliation. Only emit
  `candidate-invalidated` after independently establishing the old candidate
  cannot settle; a timeout or `abortAction` cannot revoke signatures.
- Record `bitcoin-accepted`, required `overlay-admitted`, and each party's
  `receipt-internalized` separately. Together they produce `settled`.

The application owns broadcast reconciliation and wallet internalization. Persist
candidate bytes and recovery information securely. Follow the BRC's
[broadcast and receipt handling](https://github.com/opldotdev/BRCs/blob/afab430a898859bd544ce5beb13baec136a1dc4c/tokens/0178.md#broadcast-and-receipt-handling)
for uncertain submission; do not rebuild solely because an RPC timed out.

## Lower-level use and limits

Applications with existing session/evidence orchestration can use
`selectBsv21Tips`, `validateSettlementPlan`, `prepareSettlementAction`,
`reconstructSettlementTemplate`, `authorizeSettlementInputs`, and
`finalizeSettlementAction` directly. These primitives do not enforce the session
protocol. The confirmed wrappers add that binding and mandatory evidence hooks.
The asset signer supports single-signature PushDrop and compressed-key P2PKH
unlocks with sighash `0x41` within the allocated input size.

Tests include the 12 portable readiness traces and synthetic transaction fixtures
from BRC PR #6 revision `fd55be4`. Live funded swaps, a shared transport binding,
and independent wallet interoperability remain unverified. This module is not a
complete trade application or a conformance certification.
