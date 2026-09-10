# Plan: Paymail `from` + host-issued handle certificates

Status: **Decisions locked** (not implemented)
Date: 2026-09-10

Aligns paymail send/receive with the BRC-169 handle-certificate shape without
implementing BRC-169 resolution or live 1sat.app revocation. Includes BRC-68
`metanet.trust` so the certifier key is published.
Supersedes the “any published OpNS name on an account is served” receive rule
in [2026-08-31-paymail-domain-resolvers.md](./2026-08-31-paymail-domain-resolvers.md).
Deploy of that host (n0001 Phase 5) stays in
[2026-09-02-n0001-cutover.md](./2026-09-02-n0001-cutover.md).

## Goal

The wallet must know which paymails it owns so `sendBsv` can set `from`.
Ownership is a **host-issued BRC-52 certificate** (BRC-169 handle type), stored
in the user’s wallet. The host keeps its own copy in a table (not the host
wallet — BRC-100 only stores certs where subject is this identity).

## Locked decisions

### Product / 1sat-name

- An **account** (`POST /account/register`) is required before any certify.
- The **account page** is the hub: register `alice@1sat.app`, then certify
  OpNS names from a search/filterable dropdown of wallet-held names.
- **My Names** keeps publish controls. Certify of an unpublished name prompts
  the **OpNS bind profile** (same as publish), then bind, then cert.
- Account profile (`displayName` / avatar) is **only** the public profile for
  `alice@1sat.app`. Each `name@1sat.name` profile lives on the bind.
- On-chain OpNS stays the scarce name. Certify is “this host will serve it as
  paymail,” not a replacement for publishing.
- One certifier per domain even if one process answers several Hosts.
  `1sat.name` is this product’s domain, not generic multi-host software.
- Publish on My Names does not auto-certify.

### Host surface

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /manifest.json` | public | BRC-68 `metanet.trust` only (certifier pubkey). Host-aware like `/.well-known/bsvalias`. **No** `metanet.handles`. |
| `POST /account/register` | BRC-104 | Unchanged body; **also issues** a handle cert for `{username}@{userDomain}` |
| `POST /account/certify` | BRC-104 | Prove an OpNS bind; issue the same cert shape for `{name}@{domain}` |

- Certify is **not** `/opns/register` and **not** stock `/signCertificate`.
  Wallet-toolbox issuance POSTs only `clientNonce`, `type`, encrypted
  `fields`, `masterKeyring` — no bind outpoint.
- Domain comes from the handle / Host this server certifies. Unknown domain →
  reject.
- Client stores the returned cert with `acquireCertificate({ protocol: 'direct' })`.

### Certificate

BRC-169 handle certificate (section 4.1 / 4.5):

- `type` = base64(SHA-256(`metanet-handles handle certificate v1`)) =
  `XgCFdUfxEcI+3xtDjsIuSAjMl5EwzCUjsQc45ds1lC8=`
- `subject` = authed identity key
- `certifier` = host identity (`loadKey()` / same key as messagebox AuthFetch
  and the storage handshake). `storageIdentityKey` is a replica label, not a
  key.
- `fields.handle` + `fields.domain` only. No profile in the cert.
- **OpNS** `revocationOutpoint` = the publish/bind outpoint. Spend/transfer of
  that UTXO revokes the cert.
- **1sat.app** `revocationOutpoint` = BRC-52 disabled sentinel
  `0000000000000000000000000000000000000000000000000000000000000000.0` until
  host-controlled revocation UTXOs exist.
- BRC-68 `GET /manifest.json`: `metanet.trust.publicKey` = host identity
  pubkey (`loadKey()`). `name` / `note` / `icon` per Host. Omit
  `metanet.handles` until resolve/search/reverse exist (trust without
  handles = valid anchor, handles unresolvable).

### Certify proof

- Host **does** ORDFS-check that the named outpoint is that name under this
  identity.
- Host **does not** check spent-at-issue. Receive enforces unspent + tip.

### Receive (paymail PKI / destination)

- Serve **certified names only**.
- Load the host-stored cert; current OpNS tip from ORDFS must still **be**
  that cert’s outpoint; outpoint must be unspent.
- Paymail P2P bodies do not carry the cert.
- `1sat.app` has no bind: serve from the account row (zero-sentinel).

### Send (`sendBsv`)

- `from?: string` optional. If set, `listCertificates` by handle-cert `type`
  (and this host’s certifier when known), then match `fields.handle` /
  `fields.domain` in memory. BRC-100 has no field search (only `certifiers` +
  `types`).
- If `from` is set, P2P receive body includes `metadata.sender`, `pubkey`, and
  a signature over the txid — so dests with sender-validation on accept us.
- No `from` → no metadata (today’s behavior).

### Config

```
server.paymail.verifySignature   false   # default
```

Drives both receive-beef / receive-tx `verifySignature` and the well-known
Request Sender Validation capability bit. Flip at deploy time.

## Out of scope

- Full BRC-169 (`metanet.handles`, resolve/search/reverse, subhandles, delegation)
- Live 1sat.app revocation UTXOs
- Ordinals / `1sat_inbox` / BSV21 via paymail (Sep 3 stash; separate thread)
- n0001 Phase 5 DNS / Vercel / `userDomain` cutover

## Implementation sketch (when we build)

1. Host table for issued certs (handle, domain, subject, outpoint, serial, raw cert).
2. Issue on register + certify; return cert for `acquireCertificate` direct.
3. Paymail resolve/destination: certified + ORDFS tip/unspent (OpNS) or account row (app).
4. `sendBsv`: optional `from`, cert check, signed P2P metadata.
5. `server.paymail.verifySignature` wired to routes + well-known.
6. `GET /manifest.json` with `metanet.trust` (Host-aware).
7. 1sat-name account page: register then certify dropdown (UI in that repo).
