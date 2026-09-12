# Changelog

## Unreleased

### Changed
- `OrdLockV2` targets the canonical contract: the purchase unlock is `<preimage> OP_0` under `SINGLE|ANYONECANPAY|FORKID`, and listing input `i` requires its payout at output `i`. `purchaseListing` refuses to sign unless that holds and the listed satoshi routes (first-sat ordering) to a 1-sat receive output; pass `{ deliveries }` to pin the approved outputs.
- `estimatePurchaseUnlockLength(lockingScript)` is exact and no longer depends on the other outputs.
- `isPurchase` recognizes the two-chunk unlock.

### Added
- `OrdLockV2.planPurchase`, `ordinalOutput`, `assertDelivery`, `ORDLOCK_V2_PURCHASE_SIGHASH`, and the `OrdLockV2DeliveryTarget` / `OrdLockV2PurchaseOptions` / `OrdLockV2PurchasePlan` types.
- Interpreter vectors (`ORDLOCK_V2_VECTORS_OUT`) now cover single, batch, multi-front-funding, BSV-21 receive, MAP, and cancel cases and are replayed by the ordlock-v2 harness.

### Removed
- `tagScript` / `tagOutput` / `tagOutputBytes` / `outpointBytes` (draft tag output).

## 0.0.35

### Added
- OrdLock v2 template (`OrdLockV2.lock` / `cancelListing` / `purchaseListing`).

### Changed
- `@bsv/sdk` `^2.6.0`. v1 `OrdLock.lock` stays disabled.

## 0.0.1

Initial release. Migrated Bitcoin script templates from `@bopen-io/templates` into the 1sat-sdk monorepo.

### Added
- Inscription ScriptTemplate (create, decode, verify, fromText, fromFile)
- BSV-20 fungible token template (deploy, mint, transfer, burn)
- BSV-21 advanced token template (deploy+mint, transfer, burn)
- OrdLock marketplace listing template (lock, cancelListing, cancelWithWallet, purchaseListing, decode)
- Lock time-lock template (lock, unlock, unlockWithWallet, decode)
- AIP Author Identity Protocol (sign with Signer interface, decode, verify)
- BAP Bitcoin Attestation Protocol (createID, createAttest, createRevoke, createAlias, decode)
- MAP Magic Attribute Protocol (set, add, del, decode)
- Sigma signing (BSM + BRC-77, sign, verify, decode)
- B file embedding protocol (lock, decode, text, binary, base64, hex)
- BitCom multi-protocol builder/decoder
- BSocial on-chain social actions (createPost, createLike, createFollow, createReply, createMessage, createVideo)
- Signer abstraction (PrivateKeySigner for raw keys, WalletSigner for BRC-100 wallets)
