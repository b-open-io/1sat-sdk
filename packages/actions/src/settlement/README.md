# Collaborative settlement

These exports support the trade-window and transaction portions of
[BRC-178](https://github.com/opldotdev/BRCs/blob/fd55be4b3185443e425cb31194731eafb2f60d8e/tokens/0178.md).
They support ordinal-only, BSV21-only, BSV-for-asset, and mixed two-party swaps.
They are not a complete trade application or a certification of live wallet
interoperability.

## Trade-window state

Use `createSettlementSession` with a unique session ID, sorted participant
identity keys, chain, builder, and mutually approved mining/overlay fee limits.
The session starts with empty offers and both parties unready. Each participant
replaces its own item list with an `edit` operation to add/remove/change items.
An edit always increments the revision and clears both ready flags, even if the
items are unchanged. Both offers must be nonempty before confirming in this SDK.
The BSV payer must be the builder. Builder, chain, and fee limits are immutable
session configuration; changing them requires a new session and fresh readiness.

`updateSettlementSession(state, operation, authenticatedActor)` is a pure
reducer. The actor comes from your authenticated channel, not a message claim.
Operations include `sessionId`, `revision`, and a monotonic per-actor `sequence`.
Use `{ kind: 'ready', ready: true }` to confirm and `ready: false` to withdraw.
A retry repeats the same desired state and sequence; it never toggles state.

Results distinguish accepted, stale, duplicate, already-attempting, and
attempt-started. Both parties ready for the current revision freezes it once.
An edit or withdrawal ordered before that transition prevents it; an operation
ordered after it cannot mutate the attempt. There is no fixed number of allowed
confirm/withdraw cycles.

**Persistence is required.** Atomically compare-and-swap the returned state
against the input `version`. Only the winning persisted `attempt-started`
transition may schedule preparation. On a conflict, reload and reapply the
operation. Use a durable job/outbox or equivalent to avoid duplicate side effects
and recover a crash between state persistence and wallet allocation. The reducer
does not provide a database, distributed lock, network authentication, or a
browser UI. Do not run independent local copies as competing authorities.

```ts
// Illustrative application storage integration: store/outbox are your adapters.
const previous = await store.load(sessionId)
const transition = updateSettlementSession(previous, operation, authenticatedActor)
await store.transaction(async (transaction) => {
  await transaction.compareAndSwap(sessionId, previous.version, transition.state)
  if (transition.outcome === 'attempt-started') {
    await transaction.enqueueUniqueAttempt(sessionId, transition.state.attempt)
  }
})
```

Do not display an unacknowledged withdrawal as a completed cancellation. Render
readiness and the attempting phase from acknowledged state.

## Confirmed transaction flow

Prefer these wrappers for a trade window:

1. Resolve both frozen offers into a `SettlementPlanV1`. Receiver scripts and
   remittance data come from the intended receiving wallet. Keep complete asset
   evidence in a wallet-local validator, separate from transaction-signing BEEF.
2. After persisting the attempt, call `prepareConfirmedSettlement`. It binds the
   plan to the frozen offers, calls the required `verifyEvidence` adapter, and
   funds a tracked BRC-100 action. It reconstructs the candidate, enforces agreed
   mining/overlay fee ceilings, and re-verifies evidence with the funded candidate.
   Failed post-allocation review aborts the retained wallet action.
3. Keep `prepared.localAction` on the builder. Relay **only**
   `prepared.candidate`: session ID, attempt number, revision, and template.
   The local wallet action reference is never part of the candidate envelope.
4. Before invoking any signer, atomically persist the `signing-started` event via
   `advanceSettlementAttempt`, and serialize local rejection with that operation.
   Check the latest persisted session before starting wallet work. Never resume
   from a cached session snapshot after a failure or reconciliation transition.
5. Each asset owner calls `authorizeConfirmedSettlement` with its wallet-local
   signing metadata and evidence verifier. It checks the candidate's session and
   attempt, reconstructed review fields, frozen offers, fee limits, and evidence
   before requesting signatures. The returned scripts use only `0x41` and are
   locally verified. Freshness is checked around each signing call.
6. The builder calls `finalizeConfirmedSettlement` with the retained local action
   and all asset authorizations. It repeats review/evidence checks, verifies
   candidate binding and unlocking scripts, and calls BRC-100 `signAction`.
   A BSV-only builder has no separate asset authorization; it still records
   `signing-started` before the funding signer runs.

The wrappers snapshot their arguments across asynchronous work. They do not
reload your database or acquire a lease: your application must serialize each
attempt and prevent concurrent preparation/finalization. An accepted ready
state alone never bypasses wallet approval.

### Required evidence adapter

`SettlementSessionReviewOptions.verifyEvidence(plan, candidate?)` is a required
wallet-local function returning `Promise<void>`. It must throw if verification
fails. It is called before allocation (without a candidate), after funding, and
before authorization/finalization (with the funded candidate). It must check:

- Valid source proofs and complete ordinal provenance or BSV21 token lineage
  for exactly the offered outpoints, using locally selected trust anchors.
- Authenticated and current spent-status observations, including added funding
  inputs when a candidate is supplied, and the applicable overlay fee policy.
- Receiver approval/control of destinations, ownership of wallet change, and
  remittance sufficient for subsequent internalization and spending.

Keep BRC-176 token-parent bodies and BRC-150/159 tracing data intact in this
adapter. Do not strip asset evidence by round-tripping it through ordinary
SPV-minimal Atomic BEEF. `sourceBEEFs` supplies transaction-signing data; the
SDK does not turn that data into a lineage proof. Never populate trusted status
fields from a counterparty's `active`, `unspent`, or `verified` assertion.

The callback receives copies, so it cannot silently rewrite confirmed inputs or
outputs. Resolve/refresh evidence into the plan before invoking the wrapper; a
callback may reject a stale plan but cannot update its timestamp in place. Use
locally acquired observation times, not remote timestamps. `now` is an optional
deterministic testing clock; production should normally use the real clock.

There is no default validator and no automatic network access. Wiring a no-op
callback does not satisfy BRC-178. Synthetic test callbacks are fixtures only.

## Recovery and outcome handling

`advanceSettlementAttempt` accepts **trusted local lifecycle events**, never
unverified commands from the other party. Bind each event to session and attempt.

- Persist `signing-started` before any signing invocation, conservatively even
  if the call might fail before returning a signature.
- `failed` before signing reopens a new revision with both unready. Abort the
  retained wallet action first if one exists.
- `failed` after signing started enters `reconciling`. Timeout and `abortAction`
  cannot revoke signatures. The SDK has no timeout-based reset.
- Emit `candidate-invalidated` only after independently establishing that the
  old candidate cannot settle under your policy. It can then reopen with both
  unready. This event does not broadcast a cancellation or conflicting spend.
- Record `bitcoin-accepted`, `overlay-admitted`, and each party's
  `receipt-internalized` separately. `settled` requires Bitcoin acceptance,
  required token admission, and both receipts. BSV/ordinal-only exchanges do
  not wait for token overlay admission.

Persist candidate bytes and reconciliation information securely on the builder.
A `signAction` response is not a substitute for your acceptance policy or overlay
admission result. Retry the same completed bytes after uncertain submission;
do not generate a replacement solely because an RPC timed out.

## Lower-level primitives

`selectBsv21Tips`, `validateSettlementPlan`, `prepareSettlementAction`,
`reconstructSettlementTemplate`, `authorizeSettlementInputs`, and
`finalizeSettlementAction` remain available for applications with their own
session/evidence orchestration. They do not enforce the session protocol by
themselves. The confirmed wrappers compose those primitives with session binding
and mandatory evidence hooks.

Transaction review includes version, lock time, all input sequences, ordered
outpoints/outputs, exact receipt scripts and amounts, token conservation/change,
overlay fees, and ordinal satoshi tracing. The signer supports single-signature
PushDrop and compressed-key P2PKH unlocks within the allocated input size. It
rejects all asset sighash bytes except `0x41`; script execution is also verified.

## Coverage and remaining integration

| BRC concern | SDK coverage | Application requirement |
| --- | --- | --- |
| Repeated readiness, edits, stale operations | Pure reducer; all 12 portable traces | Authenticated actors and atomic persistence |
| One attempt per frozen revision | Attempt/version counters and candidate binding | Durable unique job and attempt serialization |
| Frozen offers and fees | Confirmed wrappers enforce both | Present/approve terms and fee ceilings |
| Transaction integrity and signatures | Reconstruction, `0x41` enforcement, script checks | Wallet connection and approval |
| Asset lineage/current availability | Required evidence adapter; consistency/freshness checks | Implement real trusted verification, preserve full proofs |
| Broadcast/recovery/internalization | Separate lifecycle states and conservative reset rules | Reconcile network outcomes and call wallet internalization |
| Independent interoperability | Portable BRC fixtures and synthetic workflow tests | Two real wallet implementations and a shared transport binding |

The copied fixture is pinned to BRC PR #6 revision `fd55be4`. It is synthetic,
not mined evidence. Live funded swaps and independent wallet interoperability
remain unverified. Passing this module's tests does not certify the complete
trade application.
