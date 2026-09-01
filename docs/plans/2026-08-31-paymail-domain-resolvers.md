# Plan: Domain-based paymail resolvers (1sat.name + 1sat.app)

Status: **Code complete** (deploy + 1sat-name UI follow-ups remain)
Date: 2026-08-31

## Goal

One unified host server serves paymail for two domains with different
resolution backends, both gated on the same (now free) user registration:

| Domain | Resolver | Source of name→identity |
|--------|----------|-------------------------|
| `1sat.name` | OpNS (existing) | On-chain PushDrop bind on the name's tip UTXO (`resolvePaymailBind`) |
| `1sat.app` | Registered users (new) | `paymail_users` table (username → identity key) |

Rules (locked with operator):

- Registration is **free**: hosting `priceSats` is configured to `0`. The
  existing subscribe flow (402 middleware passes through at 0) still mints a
  `HOSTING_BASKET` receipt, so `checkHostingEntitlement` — paymail gate and
  messagebox gate — keeps working unchanged for new and existing subscribers.
- A user registers a **global 1sat.app username** (one claim, one identity).
  That single registration entitles them to resolve **all OpNS names they own**
  at `1sat.name` for free (the gate is per identity, not per name).
- 1sat.name names remain entirely OpNS-driven; the DB never maps them.
- Messagebox needs no change: one box per host keyed by identity key,
  auto-created on first send.

## Changes (all in `packages/wallet-server` unless noted)

1. **Resolver seam** — `paymail/types.ts`
   - `PaymailResolver { resolve(alias, domain): Promise<ResolvedBind | null> }`.
   - `PaymailDeps.userDomain` + `PaymailDeps.userStore` (registry backend).
     Unset ⇒ today's behavior (OpNS for every domain).

2. **User store** — `paymail/users.ts` (new)
   - `UserStore` interface (`get`, `claim`), `KnexUserStore` creating
     `paymail_users(username PK, identity_key, created_at)` alongside
     `paymail_pending` on the host's knex.
   - `claim` is idempotent per identity; a username held by another identity
     is a conflict (409 at the route).

3. **Registry resolver** — `paymail/resolvers.ts` (new)
   - `createRegistryResolver(store)`: DB lookup → `ResolvedBind`
     (`outpoint: ''`, no profile slots for now); null ⇒ 404.

4. **Domain dispatch** — `paymail/routes.ts`
   - `resolveAndAuthorize(alias, domain)`: registry resolver when
     `domain === userDomain`, else existing OpNS path. Entitlement gate
     applies to both, unchanged.
   - Serve `/.well-known/bsvalias` **per request Host** (forwarded
     host/proto, fallback `baseUrl`) instead of the fixed-baseUrl document the
     `PaymailRouter` bakes in — required because one process answers two
     apex domains.

5. **Free registration** — `hosting/routes.ts`
   - `POST /hosting/subscribe` accepts optional `{ username }`: validated
     (`^[a-z0-9][a-z0-9-]{1,62}$`, lowercased), claimed via `UserStore`,
     returned in the response. `GET /hosting/status` reports the username.
   - `mountHostingRoutes` + `createHostServer` take an optional `userStore`.

6. **CLI wiring** — `packages/cli` (`serve.ts`, `config.ts`)
   - `server.paymail.userDomain` config; `KnexUserStore` init'd on the same
     knex as pending/messagebox; passed into `PaymailDeps` and hosting deps.

## Deployment (out of repo)

- nginx: add `1sat.name` apex → same `wallet_backend` upstream + TLS; both
  apexes serve `/.well-known/bsvalias` (no SRV).
- config: `server.hosting.priceSats 0`, `server.paymail.userDomain 1sat.app`.
- Follow-up: `1sat-name` frontend `VITE_PAYMAIL_DOMAIN` → `1sat.name`.

## Verification

- Unit: `KnexUserStore` claim/lookup/conflict (sqlite knex), registry
  resolver, username validation, per-Host capability doc.
- `bun run lint && bun run build && bun test`.
