---
name: legacy-brc100-migrate
description: "This skill should be used when migrating a legacy BSV wallet (PAYPK/ORDPK P2PKH, js-1sat-ord, Redis UTXO cache, or similar) onto a BRC-100 1Sat wallet. Triggers on 'migrate to BRC-100', 'leave js-1sat-ord', 'PAYPK/ORDPK sweep', 'wallet.1sat.app cutover', '1sat 0 vs BRC-29', 'legacy treasury', 'WALLET_STORAGE_URL', or 'ephemeral sqlite'. End-to-end runbook across @1sat/wallet-node, @1sat/actions, stack, and overlay — not a replacement for the sweep, wallet-setup, sync, tokens, or stack-api skills."
---

# Legacy → BRC-100 migrate

Cut a PAYPK/ORDPK (js-1sat-ord / Redis cache) treasury over to a BRC-100 wallet (`@1sat/wallet-node` + `@1sat/actions` + `https://wallet.1sat.app`). Action signatures live in sibling skills; this file is ordering, addresses, and failure modes learned the expensive way.

## When to use this vs a sibling

| Job | Skill |
|-----|--------|
| Full cutover (sqlite → remote → env → spend, then sweep/sync) | **this skill** |
| Create / storage / `addRemote` / `setActiveStorage` | [../wallet-setup/SKILL.md](../wallet-setup/SKILL.md) |
| WIF `sweepBsv` / `sweepOrdinals` / `sweepBsv21` / `scanAddress` / `sweepDeposit` | [../sweep/SKILL.md](../sweep/SKILL.md) |
| `syncAddresses` after funds hit 1sat 0 | [../sync-cosign/SKILL.md](../sync-cosign/SKILL.md) |
| `deriveDepositAddresses` (the 1sat 0 receive string) | [../payments/SKILL.md](../payments/SKILL.md) |
| `sendBsv21` + `validateOverlay` | [../tokens/SKILL.md](../tokens/SKILL.md) |
| Owner TXOs, Arcade, BSV-21 token status | [../stack-api/SKILL.md](../stack-api/SKILL.md) |

Do not use this skill to invent a new BRC-100 wallet from scratch with no legacy source — that is wallet-setup. Do not use sweep alone when the host is ephemeral sqlite: a WIF import onto a disk that dies on reboot is not a cutover.

## Addresses — do not mix these up

| Role | Protocol | keyID | Who pays it |
|------|----------|-------|-------------|
| **1sat 0 receive** | Type-42 `ONESAT_PROTOCOL` `[0, 'onesat']` | `1sat 0` (`forSelf: true`) | **Humans.** Plain P2PKH. Owner sync watches `own:` this address. **Not BRC-29.** |
| **BRC-29 funding** | `[2, '3241645161d8']` | wallet-toolbox change | **Never a human.** Wallet change after `sweepDeposit`. |
| Legacy PAYPK / ORDPK | WIF P2PKH | n/a | **Sweep sources only.** Not the new treasury receive. |

`P1SAT_PROTOCOL` is a deprecated alias of `ONESAT_PROTOCOL` (`[0, 'onesat']`). `deriveDepositAddresses` / `syncAddresses` derive under that protocol with prefix `"1sat"` → keyID `"1sat 0"`. Meta text that says "BRC-29 deposit addresses" is wrong; the code uses `P1SAT_PROTOCOL`.

```typescript
import { createContext, deriveDepositAddresses } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const { derivations } = await deriveDepositAddresses.execute(ctx, {})
// derivations[0].address — the only string to show a human
```

QRs: **address string only**. Do not encode `bitcoin:?amount=` (wallets reject it). Relative image paths are not clickable; `open` a `file://` PNG if one is generated.

## Env

Never `trim()` env vars. If a var is wrong, fail. Do not invent names or silent fallbacks.

`WALLET_STORAGE_URL` is **opt-in application env**, not an SDK field. Map it to `createNodeWallet({ activeRemote })`. Unset ⇒ local sqlite is active and the storage server stays empty. There is no SDK default URL. Yours hosted remote is `https://wallet.1sat.app`.

`createNodeWallet` takes `privateKey` + required `storageIdentityKey` — not `mnemonic`. Derive legacy PAYPK/ORDPK from a mnemonic via `getKeysFromMnemonicAndPaths` in wallet-setup; the BRC-100 identity is the `privateKey` passed in (typically the pay WIF).

## Storage cutover (fatal if reversed)

Hosted/ephemeral disk (Railway without a volume): bun-sqlite dies on reboot. Push the **live** local-active wallet to remote **before** setting `WALLET_STORAGE_URL`. Setting the env first lets an empty local-active `setActive` sync **emptiness onto the remote**.

1. **Copy the live tree** off the running process: sqlite db + `-wal` + `-shm` + `<db>.tasks.json` + `storage-identity-key.txt` + `sync-*.db`. `railway run` is a **new empty container** — do not copy from it. SSH the live replica.
2. **Checkpoint a working copy only** (`PRAGMA wal_checkpoint(TRUNCATE)`). Keep the original tree immutable.
3. **Push local-active → `https://wallet.1sat.app`.** No `syncAddresses`, no sweep. Open the working copy with `activeRemote` unset:

```typescript
import { createNodeWallet } from '@1sat/wallet-node'

const result = await createNodeWallet({
  privateKey: payWif,                 // same identity as the live process
  chain: 'main',
  storageIdentityKey: copiedKey,      // from the live tree
  storage: { provider: 'bun-sqlite', filename: './working-copy/wallet.db' },
  skipInitialMonitor: true,
  backupSyncIntervalMs: 0,
  // activeRemote unset — local is active
})

await result.addRemote('https://wallet.1sat.app')
await result.setActiveStorage('https://wallet.1sat.app')
```

`setActiveStorage` copies **from the current active to the target, then flips**. Confirm `wallet.balance()` and `listOutputs` baskets `default`, `1sat`, `bsv21` match the live process before continuing.

4. **Only then** set `WALLET_STORAGE_URL=https://wallet.1sat.app`.
5. **Redeploy.** Ephemeral disk is empty; a **new** `storageIdentityKey` is fine (identity is the pay WIF; remote is active). Confirm logs: remote URL + `wallet.balance()` same as the push.

## Spend gate

Do not `createAction` until remote is **active** and `wallet.balance()` matches the push. Local-only spends on an ephemeral host vanish on reboot.

Serialize `createAction` with `syncAddresses` (concurrency 1). `syncAddresses` watches the 1sat receive P2PKHs, `internalizeBeef`s into `1sat-deposit`, then `sweepDeposit` (no explicit outputs) lets the wallet create BRC-29 funding. Do not copy BRC-100 outputs into a parallel Redis / js-1sat-ord cache — wrong locking scripts, no keyID.

Sidecar the BRC-100 wallet. Do not mix `@bsv/sdk` v1 / `js-1sat-ord` constructors with `@bsv/sdk` v2 in one module graph. Across the process boundary: JSON-safe values only (`txid`, addresses, amounts as strings).

## Arcade EF ingest

Owner sync / JungleBus miss mempool. If WhatsOnChain sees a tx and stack `GET /1sat/owner/{addr}/txos?refresh=true` does not:

1. Fetch raw hex from WOC.
2. Rebuild **Extended Format**: parse the tx, attach each parent as `sourceTransaction`, serialize EF hex (`tx.toHexEF()` in `@bsv/sdk`). Raw hex is rejected **460**.
3. `POST https://arcade.1sat.app/tx` with `Content-Type: text/plain` and the EF hex.
4. Also `POST https://api.1sat.app/1sat/tx` (same EF) so **1sat-stack** captures BEEF and indexes with its Arcade callback token. Public Arcade alone can miss stack's owner index (stack SSE is its own broadcasts). SDK equivalent: `services.submitToStack` posts `/1sat/tx` as octet-stream.
5. `GET /1sat/owner/{addr}/txos?refresh=true` can ingest remaining owner UTXOs (SSE: fetch → ingest → done). `services.owner.getTxos(addr, { refresh: true })`.

## Overlay fee-address credits

Overlay **credits** for BSV-21 topics are unspent sats at the token `fee_address` in the stack output store (`own:` + fee address), not overlay/submit of token txs. Funding the fee address on-chain is not enough until Arcade/stack ingest it.

`GET /1sat/bsv21/{tokenId}` `is_active` is `balance > 0` (credits − output_count × fee_per_output). Inactive-token refresher can lag ~15 minutes; owner refresh + Arcade ingest is the fast path. WhatsOnChain unspent lists can cap (e.g. 1000 UTXOs) so large fee-address balances look missing.

Do **not** poll overlay on every send; leave `sendBsv21` `validateOverlay: true` (SDK default). Only operate the new wallet on **active** BSV-21 tokens the operator cares about. Overlay inactivity is config, not architecture.

## Legacy sweep batching

Scan with `scanAddress` / `services.owner.getTxos({ refresh: true })`. Signatures and `prepareSweepInputs` are in the sweep skill. External-sweep requests take `keys: PrivateKey[]` parallel to `inputs` — not WIF strings.

1. Sweep **spendable BSV first** (need fees for 1-sat ordinals).
2. Batch ordinals at **25** per tx (Yours size). One giant ordinal tx fails on a large set.
3. Group BSV-21 by `tokenId`; one `sweepBsv21` per token. Skip inactive overlays unless the operator funded them.
4. Skip BSV-20 (neglected). Skip RUN outputs `scanAddress` already excludes.
5. Collection NFTs must land with `collection:<collectionId>` and `origin:` tags or later `listOrdinals` / `sendOrdinals` by collection tag find nothing. After sweep, `listOutputs({ basket: '1sat', includeTags: true })` and verify; stamp missing `collection:` before relying on collection filters. `sweepOrdinals` resolves origin/type via ORDFS; do not assume MAP `collectionId` was filed.
6. `sweepDeposit` is **not** the ingest path for **new** funds. New funds go to **1sat 0**, then `syncAddresses`.

## Failure table

| Symptom | Cause | Fix |
|---------|--------|-----|
| Empty wallet after reboot | Ephemeral sqlite; `WALLET_STORAGE_URL` unset or set **before** the push | Copy live tree, push local-active → remote, **then** set the env. Do not `railway run` to copy. |
| Arcade / stack **460** | Posted raw hex | Rebuild EF (`sourceTransaction` on every input), POST EF hex. |
| Overlay still inactive after paying fee address | Credits are stack `own:` UTXOs, not chain-visible balance; WOC unspent cap; ~15 min refresher | Arcade + `POST /1sat/tx` EF, then `GET /owner/{fee_address}/txos?refresh=true`. Check `GET /1sat/bsv21/{tokenId}` `is_active`. |
| QR rejected | `bitcoin:?amount=` or a relative image path | Address string only; `open` + `file://` for a PNG. |
| Asked a human to pay BRC-29 | Showed wallet change / `[2, '3241645161d8']` | Show **1sat 0** (`deriveDepositAddresses`). Never the funding change address. |
| `createAction` then funds gone | Spent while local-active on ephemeral disk | Spend gate: remote active + balance match first. |
| Owner index misses a WOC-visible tx | JungleBus/owner sync skip mempool | Arcade EF ingest (both hosts), then owner `refresh=true`. |
| Collection list empty after ordinal sweep | Missing `collection:` tags | Verify tags; stamp `collection:<id>` before collection-filtered send/list. |

## Related

- Wallet factory, `addRemote`, `setActiveStorage`, `backupSyncIntervalMs`: [../wallet-setup/SKILL.md](../wallet-setup/SKILL.md)
- Sweep / scan / `sweepDeposit`: [../sweep/SKILL.md](../sweep/SKILL.md)
- `syncAddresses`: [../sync-cosign/SKILL.md](../sync-cosign/SKILL.md)
- Baskets `default` / `1sat` / `bsv21` / `1sat-deposit`: [../action-patterns/SKILL.md](../action-patterns/SKILL.md)
