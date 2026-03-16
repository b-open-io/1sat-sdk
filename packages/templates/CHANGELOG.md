# Changelog

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
