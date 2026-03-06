# CWI Unification Plan

Status: **In Progress**

## Problem

CWI (BRC-100 WalletInterface) creation is fragmented across packages with duplicated implementations, incompatible naming conventions, and no single source of truth for dApp-side wallet instantiation.

## Goal

`@1sat/wallet/cwi` is the single place for all dApp-side WalletInterface creation. Every transport that produces a WalletInterface lives here. All consumers (admin UI, 1sat-website, any third-party dApp) import from this one place.

## System Overview

Every CWI connection has two sides:

**dApp side** — wants a `WalletInterface` to call methods on.
**Wallet host side** — receives method calls, executes them, returns results.

### Wire Protocol

Method names on the wire should match `WalletInterface` method names directly: `createAction`, `getPublicKey`, etc. This is what ts-sdk's `XDMSubstrate`, `WalletClient`, and the 1sat-website bridge/relay all use.

yours-wallet currently uses a `cwi_` prefix (`cwi_createAction`, `cwi_getPublicKey`) for its internal extension messaging. This was an independent invention that predates awareness of the XDM protocol in ts-sdk. As part of this unification, yours-wallet should drop the prefix so everything speaks the same language.

Message envelope (both protocols):
```
Request:  {type: "CWI", isInvocation: true,  id: string, call: string, args?: unknown}
Response: {type: "CWI", isInvocation: false, id: string, result?: unknown, status?: "error", description?: string}
```

### dApp Side — Current State

| Component | Package | Protocol | What it does |
|---|---|---|---|
| `WindowCWISubstrate` | ts-sdk | Extension | Reads `window.CWI` injected by extension |
| `XDMSubstrate` | ts-sdk | XDM | Runs inside an iframe, posts UP to parent |
| `WalletClient('auto')` | ts-sdk | All | Tries substrates in priority order |
| `createEventCWI()` | @1sat/wallet | Extension | CustomEvent on page, forwarded by content script |
| `createChromeCWI()` | @1sat/wallet | Extension | chrome.runtime.sendMessage to service worker |
| `createWebCWI()` | @1sat/wallet | **Broken** (sends cwi_ names) | Creates hidden iframe, postMessage |
| `EmbedTransport` | @1sat/connect | XDM | Creates hidden iframe, postMessage |
| `RedirectTransport` | @1sat/connect | Redirect/OAuth | Redirects to wallet host, returns with auth code |
| `AutoTransport` | @1sat/connect | Both | Tries embed, falls back to redirect |

### Wallet Host Side — Current State

| Component | Location | Receives from | Dispatches to |
|---|---|---|---|
| Service worker | yours-wallet | chrome.runtime (cwi_ names) | Internal wallet |
| `CWIBridge` | 1sat-website `/wallet/cwi` iframe | postMessage from dApp (plain names) | BroadcastChannel to wallet tab |
| `CWIRelay` | 1sat-website wallet tab | BroadcastChannel | `WalletPermissionsManager[method](args)` |

### Web Wallet Message Flow

```
dApp                          1sat.market
                              /wallet/cwi (iframe)          wallet tab
createWebCWI()                CWIBridge                     CWIRelay
     |                              |                            |
     |--postMessage({CWI})--------->|                            |
     |                              |--BroadcastChannel--------->|
     |                              |                            | dispatches to
     |                              |                            | WalletPermissionsManager
     |                              |<--BroadcastChannel---------|
     |<--postMessage({CWI})---------|                            |
```

## Target Architecture

### @1sat/wallet/cwi — All dApp-side WalletInterface creation

```
factory.ts      createCWI(transport)        Generic factory: transport fn -> WalletInterface
types.ts        CWIEventName                Plain method names (createAction, getPublicKey, etc.)
event.ts        createEventCWI()            Extension on page (CustomEvent)
chrome.ts       createChromeCWI()           Extension popup (chrome.runtime)
web.ts          createWebCWI(config)        iframe/postMessage to web wallet
```

All return `WalletInterface`. All use `createCWI(transport)` internally.

### @1sat/connect — OneSat-specific provider only

After migration, connect keeps:
- `OneSatProvider` interface (high-level 1Sat operations: inscribe, list, purchase)
- `OneSatBrowserProvider` (popup-based provider using `PopupManager`)
- Wallet-host-side popup utilities (`parsePopupParams`, `sendResponse`, `rejectRequest`, etc.)
- Error types

Connect removes:
- `EmbedTransport` — replaced by `createWebCWI()` from @1sat/wallet

Connect keeps for now (deferred):
- `RedirectTransport`, `AutoTransport` — stay as reference until mobile redirect flow is needed
- `CWITransport` interface and config types — used by the above

### 1sat-website/lib/cwi — Wallet host side (no changes)

`CWIBridge`, `CWIRelay`, and permission management stay in the website. These are wallet-host-specific: they receive CWI requests and dispatch them to `WalletPermissionsManager`. Any web wallet host would need its own version of this.

### yours-wallet — Extension (method name update)

- inject.ts uses `createEventCWI()` from @1sat/wallet
- popup uses `createChromeCWI()` from @1sat/wallet
- Service worker switch cases use the `CWIEventName` enum — updating the enum values in @1sat/wallet automatically updates yours-wallet with no code changes beyond a rebuild
- Drops the `cwi_` prefix to align with the standard XDM protocol

### ts-sdk WalletClient — Auto-detection (no changes needed now)

`WalletClient('auto')` already detects extensions (`WindowCWISubstrate`) and tries XDM. For explicit web wallet usage, dApps call `createWebCWI()` from @1sat/wallet directly. A ts-sdk substrate for the web wallet could be added later but is not a priority.

## Changes Required

### 1. Unify method names — drop the cwi_ prefix everywhere

**Problem**: `CWIEventName` enum uses prefixed values (`cwi_getPublicKey`). The `createCWI()` factory passes these to transport functions. This is incompatible with the XDM protocol that ts-sdk and 1sat-website use (plain `getPublicKey`).

**Fix**: Change `CWIEventName` values to plain method names. This aligns the factory, all transports, and yours-wallet onto the same protocol.

```typescript
// types.ts — plain WalletInterface method names
export enum CWIEventName {
  GET_PUBLIC_KEY = 'getPublicKey',
  CREATE_ACTION = 'createAction',
  // ...
}
```

Affected files:
- `@1sat/wallet/cwi/types.ts` — change enum values
- `yours-wallet/src/background.ts` — switch cases automatically match (they use the enum)
- `yours-wallet/src/inject.ts` — CustomEvent types match (uses the enum)
- `yours-wallet/src/content.ts` — forwards the action string as-is (no change needed)
- `createWebCWI()` — becomes compatible with 1sat-website bridge automatically

### 2. Fix createWebCWI

With step 1 done, `createWebCWI()` sends plain method names automatically. Verify it works against 1sat-website's `CWIBridge` which validates against the same plain method names.

### 3. Remove EmbedTransport from @1sat/connect

`EmbedTransport` is replaced by `createWebCWI()`. Remove it and related types from connect's exports. `RedirectTransport` and `AutoTransport` stay for now as reference until the redirect flow is needed (see Deferred Items).

## Consumers After Migration

| Consumer | Before | After |
|---|---|---|
| yours-wallet inject.ts | `createEventCWI()` from @1sat/wallet | No change |
| yours-wallet popup | `createChromeCWI()` from @1sat/wallet | No change |
| Admin UI | `WalletClient('auto')` from ts-sdk | No change (add `createWebCWI()` fallback later if needed) |
| 1sat-website dApp pages | `OneSatBrowserProvider` from @1sat/connect | No change for popup flow; use `createWebCWI()` for CWI |
| Any new dApp (desktop) | `WalletClient('auto')` or `createWebCWI()` | Standard pattern |
| Any new dApp (mobile) | Nothing | `createAutoCWI()` (iframe with redirect fallback) |

## Execution Order

1. Update `CWIEventName` values to plain method names (drop `cwi_` prefix)
2. Verify `createWebCWI()` works with 1sat-website bridge
3. Rebuild yours-wallet (enum change propagates automatically)
4. Remove `EmbedTransport` from @1sat/connect
5. Test end-to-end: admin UI → createWebCWI → 1sat-website bridge → wallet

## Deferred Items

### Redirect flow (createRedirectCWI)

The redirect transport is an OAuth 2.0 PKCE flow applied to individual CWI calls — for mobile browsers where third-party iframes are restricted. It redirects the entire browser to the wallet host for approval, then returns with an auth code.

The server-side endpoints it requires (`/api/cwi/authorize/init`, `/api/cwi/token`) don't exist on 1sat-website yet. Defer until mobile web wallet is actively being tested. The `RedirectTransport` code in connect can stay as reference until then.

### OneSatProvider

`OneSatProvider` (inscribe, list, purchase, etc.) stays in @1sat/connect as-is. 1sat-website uses it and we're not ready to break that. It's a higher-level abstraction on top of BRC-100 — separate concern from this unification.

### Events (account switch, sign-out)

BRC-100 is purely request-response — no event system exists in the spec. The `switchAccount` and `signedOut` events we added to yours-wallet's inject.ts are a custom extension. Nothing consumes them yet.

The use case: wallets can hold multiple key sets, users switch between them, and the dApp needs to know so it can re-authenticate. This would need to be proposed as an extension to BRC-100.

For now, events stay out of the `createCWI()` factory. They can be added later once:
1. The BRC-100 event extension is proposed/accepted
2. We know what the event protocol looks like across transports (extension events vs iframe events are mechanically different)
