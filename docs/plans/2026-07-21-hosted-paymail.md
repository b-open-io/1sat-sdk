# Host pack, Paymail & Messagebox

Status: **Superseded (2026-09-02)** — the paid host pack (receipts, expiry,
`/hosting/*`, entitlement gate) was removed. Registration is now a free,
permanent host account with username + profile under `/account/*`; see
`2026-08-31-paymail-domain-resolvers.md`. The PushDrop bind, unified host
server, and messagebox composition sections below still describe shipped
code.  
Last updated: 2026-07-22

## Goal

Hosted **paymail + messagebox** (“host pack”) for a wallet identity, billed on the host wallet, with OpNS name→identity bind on-chain via PushDrop. Storage metering stays separate. Prefer one host process long-term.

Mining stays on 1sat-name orchestrator (out of scope).

---

## Locked decisions

| Topic | Decision |
|-------|----------|
| Chain index | Go `api.1sat.app` — OpNS, beef, `/tx` |
| Name → identity | Signed **PushDrop** on name UTXO; field0 = identity key bytes |
| PushDrop derive | `[0,'p 1sat']`, counterparty `anyone`, keyID `opns:{txid}_{vout}` of **creation input**, forSelf lock + field-sig |
| Bind lifecycle | Register = PushDrop out; transfer/list/burn unlock PushDrop→normal scripts (bind does not carry) |
| Legacy address bind | Dropped from `opnsRegister` |
| Customer | **Identity key** (not per-name) |
| Product | **Host pack** = paymail **and** messagebox for a period |
| Period | **Calendar seconds** (not blocks) for host pack |
| Host pack ledger | **1-sat receipt** in host wallet `HOSTING_BASKET`; tags **wallet-local only** `payer:{id}`, `exp:{unix}` — **no identity on-chain** |
| Renew | **Spend all prior receipts + mint one new** (extend from max(now, prior exp)) |
| Payment sats | Spendable immediately (not locked until expiry) |
| Storage accounts | Separate; **labels on payment actions** (`wallet-storage-payment`, `payer:`, `bytes:`, `block:`); no receipt UTXO; no real payers yet |
| Coexistence | Storage labels + host-pack receipts both fine on same host wallet |
| Long-term deploy | **One process**: wallet storage + `/hosting/*` + paymail + messagebox; DNS splits hosts |
| Interim deploy | Multi-process OK until messagebox is composable |

Constants: `@1sat/types` (`OPNS_*`, `HOSTING_*`, helpers).  
Protocol note: `docs/protocols/opns-paymail-bind.md` (bind only).

---

## Repo status (working trees — may be uncommitted)

### `1sat-sdk` (primary)

| Area | Status |
|------|--------|
| PushDrop `opnsRegister` / dual unlock / deregister | Done |
| Unified `createHostServer` (storage + hosting + paymail + messagebox) | Done — `1sat serve` is unified; `serve paymail`/`serve messagebox` removed |
| Paymail in wallet-server `src/paymail/` (`@bsv/paymail` router, PushDrop resolve, knex pending, entitlement gate, inbox deliver) | Done |
| Wallet-server `/hosting/price\|status\|subscribe` | Done (402 + spend/replace receipt) |
| CLI `server.hosting.*`, `server.paymail.baseUrl`, `server.messagebox.enabled` | Done |
| Types + protocol doc | Done |
| Smoke test (well-known, price, 401s, monitor) | Done |
| Messagebox host-pack gate | **Done** — recipient-entitlement middleware in `createHostServer` before messagebox mount (verified 403 vs auth fallthrough) |
| ts-stack embed hardening | **Draft PR #299** (WS compile, logger cwd, module-load env throw) — awaiting review/merge |
| E2E subscribe via real funded wallet | Not tested (402 challenge verified structurally only) |

### `1sat-name`

| Area | Status |
|------|--------|
| Publish = identity PushDrop only (no address UI) | Done |
| `/hosting` page (price/status/subscribe) | Done (`VITE_HOSTING_URL`) |

### `message-box-server` (local / bopen)

| Area | Status |
|------|--------|
| `HOSTING_PACK_ENABLED` recipient check on sendMessage | Done locally (not necessarily published) |

### `ts-stack` (upstream)

| Area | Status |
|------|--------|
| Composable messagebox mount API | **MERGED** https://github.com/bsv-blockchain/ts-stack/pull/297 |
| Temp publish `@bopen-io/messagebox-server` | Published **1.2.5** (compose API + types + logger/SERVER_PRIVATE_KEY embed fixes). `npm` registry, built from ts-stack main |
| ts-stack publish-prep branch | `publish/bopen-messagebox-server` on `shruggr/ts-stack` (name/version/packaging only — not for upstream) |
| Note | bun publish drops gitignored `out/`; package ships empty `.npmignore` to include it. Do not use npm CLI (requires TOTP user lacks) |

---

## Target architecture (end state)

```
createHostServer (one process, one key, one wallet storage)
  Express
  ├── public:  /.well-known/bsvalias, /bsvalias/*   (paymail, no auth)
  ├── public:  GET /hosting/price
  ├── auth:    GET/POST /hosting/status|subscribe
  ├── auth:    POST /  (wallet storage RPC) + account/*
  └── auth:    messagebox routes (+ optional WS on same http.Server)
```

DNS: `1sat.app` / `wallet.*` / (optional) `messagebox.*` → same app until clients drop separate mbox URL.

**Prerequisite:** ts-stack #297 (or equivalent) so messagebox is `mountMessageBoxRoutes(app, ctx)` not a self-listening binary.

---

## Interim architecture (what code does today)

```
1sat serve wallet     → storage + /hosting/*
1sat serve paymail    → bsvalias (gate via wallet storage URL)
1sat serve messagebox → mbox (gate if HOSTING_PACK_ENABLED)
```

Same host key; paymail/messagebox point at wallet storage URL.

---

## Remaining work (ordered for next sessions)

### A. Land composable messagebox (ts-stack)

1. Review/merge https://github.com/bsv-blockchain/ts-stack/pull/297  
2. If blocked on perms: mirror branch to **b-open-io** and publish temp npm  
3. Point 1sat-cli at new package version  

### B. Unify host process (1sat-sdk)

1. Port `@1sat/paymail` handlers to **Express router** (today Bun.serve)  
2. `createHostServer` / `1sat serve host` (or evolve `serve`):  
   - wallet-server mounts  
   - paymail router (no auth)  
   - `mountMessageBoxRoutes` + optional WS  
3. In-process inbox deliver (drop AuthFetch hop when co-mounted)  
4. Deprecate standalone `serve paymail` / `serve messagebox` once stable  

### C. Stabilize multi-process path (if shipping before B)

1. Commit/publish 1sat-sdk + 1sat-name changes  
2. Deploy messagebox with host-pack gate (npm or local)  
3. Config: `server.hosting.enabled`, prices, `server.paymail.baseUrl` + `messageboxUrl`  
4. E2E: subscribe → publish name → paymail pay → inbox sync  
5. Confirm AuthFetch 402 auto-pay from name UI wallets  

### D. Cutover

1. DNS / reverse proxy for paymail on apex  
2. Disable Go `pkg/paymail` for prod domains  
3. Optional: retire separate messagebox hostname when clients allow  

### E. Explicit non-goals (still)

- Per-name subscriptions  
- On-chain customer identity in receipt script  
- Merging storage metering into host pack (future optional)  
- Moving mining orchestrator into host  

---

## Config cheat sheet

```bash
# wallet serve
server.hosting.enabled true
server.hosting.priceSats 10000
server.hosting.periodSeconds 2592000   # ~30d

# paymail serve
server.paymail.baseUrl https://1sat.app
server.paymail.stackUrl https://api.1sat.app
server.paymail.messageboxUrl https://messagebox.1sat.app
# requireEntitlement defaults true when hosting.enabled

# messagebox
HOSTING_PACK_ENABLED=true   # or via CLI when hosting.enabled
```

1sat.name: `VITE_HOSTING_URL` → wallet host origin.

---

## Key paths

| What | Path |
|------|------|
| Plan (this file) | `1sat-sdk/docs/plans/2026-07-21-hosted-paymail.md` |
| Bind protocol | `1sat-sdk/docs/protocols/opns-paymail-bind.md` |
| Paymail pkg | `1sat-sdk/packages/paymail/` |
| Hosting routes | `1sat-sdk/packages/wallet-server/src/hosting/` |
| CLI paymail | `1sat-sdk/packages/cli/src/commands/serve-paymail.ts` |
| Name UI | `1sat-name/frontend/src/pages/HostingPage.tsx` |
| Mbox gate (local) | `message-box-server/src/routes/sendMessage.ts` |
| Composable mbox PR | https://github.com/bsv-blockchain/ts-stack/pull/297 |

---

## Resume prompt (new session)

> Continue host pack / paymail from `1sat-sdk/docs/plans/2026-07-21-hosted-paymail.md`.  
> Design is locked. Multi-process code is in working trees (1sat-sdk, 1sat-name, message-box-server).  
> ts-stack composable messagebox: PR #297.  
> Preferred next: merge/publish composable mbox, then `createHostServer` unify; or commit/stabilize multi-process and E2E if shipping sooner.  
> Do not force-push. Review major wiring with user before large refactors.  
> User wants short answers, one step at a time.
