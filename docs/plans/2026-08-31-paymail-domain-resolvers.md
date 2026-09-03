# Plan: Host accounts + domain-based paymail resolvers (1sat.name + 1sat.app)

Status: **Code complete** (deploy + 1sat-name UI follow-ups remain)
Date: 2026-08-31, reworked 2026-09-02

## Goal

One unified host server serves paymail for two domains with different
resolution backends, both gated on the identity holding an **account** on
the host:

| Domain | Resolver | Source of name→identity |
|--------|----------|-------------------------|
| `1sat.name` | OpNS (existing) | On-chain PushDrop bind on the name's tip UTXO (`resolvePaymailBind`) |
| `1sat.app` | Host accounts (new) | `accounts` table (username → identity key) |

## Decisions (locked with operator, 2026-09-02)

- **One account per identity on the host.** The paymail username, its
  profile, storage metering, and messagebox entitlement are facets of the
  same account, not separate registrations. Storage capacity stays derived
  from payment labels on the host wallet; the `accounts` row is the only
  thing written down about the account itself.
- **Registration is free and permanent.** One username per identity, one
  identity per username, no renames. If a charge is ever wanted, it gets
  designed then; the old receipt/expiry subscription model was removed
  rather than left dormant.
- **Profile fields on the account.** `displayName` and `avatarOrigin`
  (`txid_vout` of an image ordinal, served through ORDFS), so 1sat.app
  handles get the same public-profile capability OpNS names get from
  PushDrop slots 1 and 2. Uploads in the UI inscribe the image first, then
  register the origin; the host stores no image bytes.
- **The account is the entitlement.** Paymail resolution on every domain and
  messagebox delivery require the resolved/recipient identity to hold an
  account. No receipts, no expiry.
- 1sat.name names remain entirely OpNS-driven; the DB never maps them.
- No migration: there were no real registrations under the interim
  `paymail_users` table, which is simply no longer created.

## Surface (`packages/wallet-server`)

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /account/status` | BRC-104 | Storage facet (unchanged) + `registrationEnabled` and `account` (username, displayName, avatarOrigin, createdAt; `null` when unregistered) |
| `POST /account/register` | BRC-104 | `{ username, displayName?, avatarOrigin? }` → account. 400 invalid, 409 taken / already registered. Idempotent for the same username. |
| `PUT /account/profile` | BRC-104 | `{ displayName?, avatarOrigin? }`; absent = unchanged, `null` = clear. 404 when unregistered. |
| `/.well-known/bsvalias` | public | Built per request Host so one process answers both apexes |
| `/bsvalias/*` | public | Dispatch by domain: `userDomain` → accounts, else OpNS; both gated on account |
| `POST /messagebox/sendMessage` | BRC-104 | 403 `ERR_ACCOUNT_REQUIRED` when a recipient has no account |

Code:

- `accounts/store.ts` — `AccountStore`, `KnexAccountStore` (`accounts`
  table, auto-created), username/profile normalizers, error classes.
- `accounts/registrationRoutes.ts` — register/profile routes,
  `registrationStatus` facet, `accountView` wire shape.
- `accounts/client.ts` — `AccountClient` (status/register/updateProfile).
- `paymail/resolvers.ts` — `createAccountResolver`.
- `paymail/routes.ts` — `resolveAndAuthorize` dispatch + account gate.
- `createHostServer` / `createWalletServer` — `accountStore` option; the
  CLI host always creates one on the messagebox knex.

Removed: `hosting/*`, `paymail/entitlement.ts`, `paymail/users.ts`,
`HOSTING_*` constants, `server.hosting.*` config, the hosting repricer
target, `PaymailDeps.hostWallet/requireEntitlement`.

## Config

```
server.paymail.userDomain   1sat.app     # aliases resolved from accounts
server.paymail.baseUrl      https://1sat.app
```

`server.hosting.*` is gone; delete it from existing config files.

## Deployment (out of repo)

- Publish `@1sat/types`, `@1sat/actions`, `@1sat/wallet-server`, `@1sat/cli`.
- `1sat.name` is served by Vercel (SPA catch-all), so its
  `/.well-known/bsvalias` and `/bsvalias/*` must be rewritten to the host
  (e.g. `https://1sat.app/...`). The domain rides in the path, so the host
  dispatches `alice@1sat.name` to OpNS regardless of which apex answered.
- Disable Go `pkg/paymail` on api.1sat.app once both apexes resolve through
  the host.

## Follow-ups (1sat-name)

- Account page: register username + profile via `/account/*`; drop the
  `/hosting/*` calls and price display; avatar picker (own ordinals) plus
  upload-as-inscription.
- My Names: show `name@1sat.name` and note that an account is required.

## Verification

- `bun test packages/wallet-server` (accounts store, routes, resolver,
  domain dispatch, capability doc, OpenAPI).
- `bun run lint`, per-package `tsc --noEmit` / builds for types, actions,
  wallet-server, cli.
