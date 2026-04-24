# Handoff: Content-Script CWI Allowlist in yours-wallet

## Context

We need to close a security gap in the yours-wallet Chrome extension's content script. Today, `yours-wallet/src/content.ts` forwards any `type` value from a web page's `YoursRequest` CustomEvent to `chrome.runtime.sendMessage()` as the `action` field without validation. A malicious page can set `type` to any string — including internal wallet action names like `MASTER_BACKUP`, `SIGNED_OUT`, `STORAGE_ADD_REMOTE` — and the background's `noAuthRequired` block handles many of those without checking whether the message came from the extension popup or a web page.

The background has an `isFromExtension` guard as defense-in-depth. The content script is still an open proxy. The right place for the allowlist is the content script itself, and the allowlist source-of-truth should live in `@1sat/wallet` (which defines `CWIEventName`), not duplicated in yours-wallet.

## What's available in the SDK

`@1sat/wallet@0.0.63` (reachable via `@1sat/wallet-browser@0.0.52`) now exports two new symbols for exactly this purpose:

- **`CWI_EVENT_NAMES: ReadonlySet<string>`** — a frozen Set of every valid `CWIEventName` string value. Stays in sync with the enum automatically.
- **`isCWIEventName(s: unknown): s is CWIEventName`** — a type guard returning `true` iff `s` is a valid CWIEventName.

Both are re-exported from `@1sat/wallet-browser` via `export * from '@1sat/wallet'` in its `src/index.ts`. Import from either package; prefer `@1sat/wallet-browser` for consistency with other imports in yours-wallet.

## Scope of work

1. **Bump the yours-wallet dependency** on `@1sat/wallet-browser` from `0.0.49` to `0.0.52`.
2. **Edit `yours-wallet/src/content.ts`** — in the `CustomListenerName.YOURS_REQUEST` listener, drop any event whose `type` is not a valid `CWIEventName`. Silent drop (no error forwarded). Nothing else in the listener changes — the params-shape normalization, originator derivation, and forwarding call stay as-is.
3. **Do nothing in the background** — the existing background dispatch is correct and out of scope for this change.

## Implementation sketch

Current content.ts listener (from `yours-wallet/src/content.ts:13`):

```ts
self.addEventListener(CustomListenerName.YOURS_REQUEST, (e: Event) => {
  const { type, messageId, params: originalParams = {} } = (e as CustomEvent<RequestEventDetail>).detail;
  if (!type) return;

  let params: RequestParams = {};
  // ...params normalization...

  const originator = window.location.host;
  chrome.runtime.sendMessage({ action: type, params, originator }, buildResponseCallback(messageId));
});
```

After the change:

```ts
import { isCWIEventName } from '@1sat/wallet-browser';

self.addEventListener(CustomListenerName.YOURS_REQUEST, (e: Event) => {
  const { type, messageId, params: originalParams = {} } = (e as CustomEvent<RequestEventDetail>).detail;
  if (!type) return;
  if (!isCWIEventName(type)) return;

  let params: RequestParams = {};
  // ...params normalization unchanged...

  const originator = window.location.host;
  chrome.runtime.sendMessage({ action: type, params, originator }, buildResponseCallback(messageId));
});
```

This ensures web pages can only dispatch legitimate BRC-100 `WalletInterface` methods through the content script. Any new action added to `CWIEventName` in the SDK is automatically allowed on the next SDK bump; anything else is dropped silently.

## Verification

- Load the extension, visit a dApp, confirm BRC-100 methods still work end-to-end (e.g. `getPublicKey`, `createAction`).
- From a page console, dispatch a `YoursRequest` CustomEvent with `type: 'MASTER_BACKUP'` and verify the background does NOT receive it (no `chrome.runtime.sendMessage` call should fire from the content script).
- Extension-triggered flows (popup, sweep tab, options page) continue to work — they don't go through the content script, so this change doesn't affect them.

## Out of scope / not this change

- The background script's `authorizeRequest`/`noAuthRequired` logic.
- The `isFromExtension` guard (stays as defense-in-depth).
- Any CWI receiver abstraction in the SDK. An attempt at that receiver layer was rolled back; the current SDK surface is deliberately narrow: allowlist + shared envelope types only. Use only what this doc specifies.

## Background reference

This is the narrow scope that was asked for originally. A wider receiver-layer attempt (`handleCWIRequest`, `createChromeCWIReceiver`, etc.) was built, found not to match any real consumer topology, and rolled back in `@1sat/wallet@0.0.63`. See `1sat-sdk/packages/wallet/CHANGELOG.md` for the trimmed SDK surface.
