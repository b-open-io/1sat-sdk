# Cosigner-Validated Stablecoin POC

## Context

Build a token-management web app for stablecoin issuers, with an embedded cosigner service that mediates transfers of cosign-wrapped BSV21 tokens. Demonstrates a stablecoin pattern where a validator (the same operator running the BSV21 overlay topic) signs every transfer, enforcing per-issuer blacklist and freeze-list policies. Issuers retain custody of the auth UTXO in their personal wallet; only the cosigner key is service-owned.

Proof-of-concept scope: single sample token, simple persistence, no production hardening, SIGHASH_NONE on user-side token-input sigs (cosigner trusted to honor user-intended outputs for now).

## Architecture

**Cosign wrapping.** Mint and transfer outputs are cosign-wrapped: BSV21 inscription envelope + cosign-template suffix (`OP_DUP OP_HASH160 <pkhash> OP_EQUALVERIFY OP_CHECKSIGVERIFY <33-byte pubkey> OP_CHECKSIG`). Auth UTXOs stay plain P2PKH (issuer-only). Deploy outputs unchanged.

**Operations the cosigner mediates.** Spending cosign-wrapped UTXOs — i.e. transfer and burn. Mint and deploy don't go through the cosigner (they don't spend cosign-wrapped inputs).

**Cosigner pathway.** User's wallet builds a partial tx (token inputs + token outputs), signs token inputs SIGHASH_NONE | ANYONECANPAY (owner sig only). Ships partial atomic BEEF to backend `/sign`. Backend:
1. Validates token inputs are unspent in the BSV21 overlay (HTTP lookup).
2. Checks blacklist (any recipient address forbidden?) and freeze list (any input outpoint frozen?).
3. Calls `wallet.createAction` on its `@1sat/wallet-node` instance — user's pre-signed token inputs supplied as external inputs with full unlocks (cosigner sig + owner sig + owner pubkey) assembled by the backend; user's outputs as the `outputs` arg; wallet auto-funds and adds its own change. Wallet broadcasts via its arcade broadcaster.
4. After broadcast, backend POSTs the resulting BEEF to the overlay's `/submit` endpoint for topic admission.
5. Returns final BEEF + txid + admit status.

User's wallet calls `internalizeAction(BEEF, outputs)` to adopt the spend + any self-outputs. Recipients adopt via messagebox delivery (no paymail in this flow — direct messagebox push of the BEEF to the recipient's box).

**Authz.** Holding an auth UTXO for token X grants management endpoints (mint config, blacklist, freeze) for X. Holding any cosign-wrapped UTXO of X grants end-user transfers. Auth verification at the backend = signed challenge proving the caller controls the key that owns the current auth UTXO outpoint (queried from overlay).

## Critical files / packages

### `ts-templates` — extend `Cosign` template (currently decode-only)
- [ts-templates/src/template/cosign/Cosign.ts](../../../ts-templates/src/template/cosign/Cosign.ts) — currently has `decode` and `isCosign` only. Add:
  - `static lock(address: string, cosignerPubKey: string): LockingScript`.
  - Owner-sig builder (works against a wallet's `createSignature` BRC-29 path, returns the 2-element `<owner-sig><owner-pubkey>` stack the cosigner can prepend its sig to).
  - Cosigner-sig builder (signs cosigner portion, prepends to assembled unlock).
- Reference Go counterpart at `go-templates/template/cosign/cosign.go` for parity (`Lock` / `OwnerUnlock` / `ApproverUnlock` already exist there).

### `@1sat/actions`
- No change needed. `mintBsv21` already accepts a `Destination` that supports `lockingScript`. Caller constructs the cosign locking script via `Cosign.lock(recipientAddress, cosignerPubKey)` and passes the hex as the destination's `lockingScript` field; `resolveDestination` flows it through to `BSV21.mint(...).lock(<cosign-script>)`. Auth destination stays plain `address`.

### `@1sat/wallet`
- [packages/wallet/src/indexers/CosignIndexer.ts](../../packages/wallet/src/indexers/CosignIndexer.ts) — already populates `{address, cosigner}` via `Cosign.decode`. Verify (and adjust if needed) that `cosigner` flows into `customInstructions` so it survives `listOutputs` and is available per-UTXO when a transfer-builder needs it.
- [packages/wallet/src/indexers/Bsv21Indexer.ts](../../packages/wallet/src/indexers/Bsv21Indexer.ts) — no change. Existing composition with `CosignIndexer` already handles cosign-wrapped BSV21 UTXOs (each indexer parses independently; both contribute data on the same `Txo`).

### New repo: `stablecoin-mgr` (top-level sibling of `1sat-website`)
- **Backend** (`packages/server/`):
  - Bun + lightweight HTTP framework. Bootstraps `@1sat/wallet-node` with WIF from env (`COSIGNER_WIF`), `OneSatServices` client pointed at the overlay.
  - `src/cosigner/sign.ts` — `POST /sign` handler. Decodes incoming partial atomic BEEF, runs overlay-lookup validation, blacklist + freeze checks, builds full unlocks (owner sig from request + cosigner sig from `wallet.createSignature`), `wallet.createAction` with user's pre-signed inputs as externals + user-supplied outputs, wallet auto-funds + broadcasts, then POSTs final BEEF to overlay `/submit` for admission. Returns `{ beef, txid, status }`.
  - `src/admin/auth.ts` — challenge-response auth based on auth-UTXO ownership: backend issues nonce, caller signs with the key tied to the current auth UTXO owner, backend verifies + cross-references overlay.
  - `src/admin/blacklist.ts`, `src/admin/freeze.ts` — CRUD endpoints, per-token state.
  - `src/admin/config.ts` — `GET /config` returns the cosigner pubkey + per-token policy (so the management UI can fetch what it needs to construct mint outputs).
  - `src/db.ts` — SQLite (Bun:sqlite) for blacklist, freeze list, mint history.
- **Frontend** (`packages/web/`):
  - Vite + React, uses `@1sat/connect` + `@1sat/react` for Yours Wallet authentication.
  - Page: tokens-I-manage (filtered by auth-UTXO ownership via overlay query against connected wallet's pubkey).
  - Page: per-token management — mint form, blacklist editor, freeze-list editor.
  - Page: end-user transfer (any holder) — selects cosign-wrapped UTXOs via wallet `listOutputs`, builds partial tx with SIGHASH_NONE|ANYONECANPAY token-input sigs via `wallet.createSignature`, POSTs to `/sign`, internalizes returned BEEF.

## Implementation order

1. `ts-templates` — `Cosign.lock` + owner/cosigner unlock helpers + tests.
2. `@1sat/wallet` — verify/extend `CosignIndexer` `customInstructions` plumbing.
3. New `stablecoin-mgr` repo skeleton (workspace, server bootstrap, web bootstrap).
4. Backend `/sign` endpoint (without blacklist/freeze).
5. Sample token deploy: fresh `deployBsv21Auth` from issuer wallet against the overlay, then `mintBsv21` passing a `Destination` whose `lockingScript` is built via `Cosign.lock(...)`.
6. End-to-end transfer test against the sample token (no UI yet — script-driven).
7. Recipient delivery via messagebox push of the final BEEF.
8. Admin endpoints (blacklist + freeze) with SQLite persistence + auth-UTXO challenge auth.
9. Frontend: connect, list-managed-tokens, per-token management, end-user transfer.
10. End-to-end blacklist + freeze enforcement tests through the UI.

## Verification

- `ts-templates` unit tests: cosign lock + unlock round-trip with synthetic owner + cosigner keys, verify resulting tx scripts against `@bsv/sdk` interpreter.
- `mintBsv21` called with a `Destination` whose `lockingScript` is `Cosign.lock(recipientAddress, cosignerPubKey)` produces a tx whose mint output decodes via both `BSV21.decode` (correct tokenId + amount) and `Cosign.decode` (correct address + cosigner pubkey); auth output decodes as plain P2PKH.
- Sample token deploy + mint admitted to the BSV21 overlay topic.
- End-to-end transfer (script-driven, then UI):
  - User wallet builds partial tx, ships to `/sign`.
  - Backend validates against overlay, calls `createAction`, broadcasts via wallet, submits BEEF to overlay.
  - Recipient's wallet calls `internalizeAction(BEEF)` and sees the cosign-wrapped UTXO in their basket with `cosigner` populated in `customInstructions`.
- Blacklist enforcement: add recipient address; transfer attempt to that address returns 4xx with reason from `/sign`.
- Freeze enforcement: add a specific outpoint; transfer attempt spending it returns 4xx with reason.
- Auth-UTXO transfer (issuer hands off the auth UTXO to a different wallet): management UI on first wallet stops listing the token; second wallet sees it; admin endpoints honor the change.

## Out of scope

- SDK-level cosigner-aware send action (frontend owns transfer wire format).
- Tightened sighash (SIGHASH_SINGLE/ALL) — POC accepts SIGHASH_NONE trust assumption.
- Generic `mintBsv21` cosign discovery via deploy metadata — manual config for POC.
- `Broadcaster` wired into `engine.Submit` — broadcast path is via cosigner's wallet, not the overlay engine, so this prerequisite is gone.
- Migration / cosign-wrapping of existing tokens (MINTOK).
- Production authn beyond auth-UTXO challenge (no rate limiting, replay window, etc.).
- Standalone-cosigner-as-a-product packaging — single-purpose POC service.
