---
name: "@1sat/connect SDK Development"
description: >-
  This skill should be used when the user asks to "add a feature to @1sat/connect",
  "update the connect SDK", "add a new RPC method", "fix popup handling",
  "update wallet types", "modify the popup protocol", "add error handling",
  or needs guidance on developing, testing, or publishing the @1sat/connect
  popup-based wallet SDK package.
---

# @1sat/connect SDK Development Guide

This skill provides guidance for developing the `@1sat/connect` package — a popup-based
wallet SDK that enables dApps to communicate with the 1Sat Wallet at www.1satwallet.com.

## Package Architecture

```
packages/connect/src/
  index.ts       — Public API: exports, createOneSat(), detection helpers
  provider.ts    — OneSatBrowserProvider: popup-based provider implementation
  popup.ts       — PopupManager: opens popups, tracks pending requests, handles timeouts
  messages.ts    — Protocol message format: request/response creation, validation
  types.ts       — All TypeScript interfaces and type exports
  errors.ts      — Typed error classes with numeric codes (4001-4014)
  storage.ts     — localStorage persistence for connection state
  wallet.ts      — Wallet-side utilities (sendResponse, rejectRequest, parsePopupParams)
  transport.ts   — CWI transport layer (embed/redirect for BRC-100 operations)
```

## Popup Communication Protocol

### Request Flow

1. dApp calls a provider method (e.g. `connect()`, `signMessage()`)
2. `OneSatBrowserProvider.sendRequest()` generates a `requestId` via `crypto.randomUUID()`
3. `PopupManager.openPopup()` builds a URL: `{popupUrl}/connect?method=X&requestId=Y&origin=Z&params={...}`
4. `window.open()` opens the popup; returns `null` if blocked → `PopupBlockedError`
5. A `PendingRequest` is stored with `resolve`/`reject` callbacks, timeout, and close-check interval
6. `OneSatBrowserProvider.handleMessage()` listens for `window.postMessage` from the popup origin
7. On match: resolves or rejects the pending request, cleans up timers

### Response Flow (Wallet Side)

1. Popup page calls `parsePopupParams(searchParams)` to extract `requestId`, `origin`, `appName`, `params`
2. User approves → `sendResponse(requestId, result, origin)` which calls `window.opener.postMessage()`
3. User rejects → `rejectRequest(requestId, origin)` sends error code 4001
4. Popup closes via `window.close()`

### Message Format

```typescript
interface ProtocolMessage {
  type: 'onesat'
  version: 1
  requestId: string
  method?: string        // Present in requests
  params?: unknown       // Present in requests with params
  result?: unknown       // Present in success responses
  error?: {              // Present in error responses
    code: number
    message: string
    data?: unknown
  }
}
```

## Adding New RPC Methods

To add a new wallet operation:

### 1. Define Types in `types.ts`

```typescript
// Add request/result interfaces
export interface NewMethodRequest {
  someParam: string
}

export interface NewMethodResult {
  txid: string
}

// Add to RpcMethods object
export const RpcMethods = {
  // ... existing methods
  NEW_METHOD: 'newMethod',
} as const
```

### 2. Add Provider Method in `provider.ts`

```typescript
async newMethod(request: NewMethodRequest): Promise<NewMethodResult> {
  this.requireConnection()  // Ensure connected first
  return this.sendRequest<NewMethodResult>(RpcMethods.NEW_METHOD, request)
}
```

### 3. Update Provider Interface in `types.ts`

```typescript
export interface OneSatProvider {
  // ... existing methods
  newMethod(request: NewMethodRequest): Promise<NewMethodResult>
}
```

### 4. Export from `index.ts`

Add the new types to the type exports block.

### 5. Handle in Wallet Popup

In the 1sat-web repo, handle the new method in the appropriate popup page.

## Error System

All errors extend `OneSatError` with a numeric `code`:

| Code | Class | When |
|---|---|---|
| 4001 | `UserRejectedError` | User rejected request |
| 4002 | `WalletLockedError` | Wallet is locked |
| 4003 | `WalletNotConnectedError` | Not connected |
| 4004 | `InsufficientFundsError` | Not enough BSV |
| 4006 | `PopupBlockedError` | Browser blocked popup |
| 4007 | `PopupClosedError` | Popup closed unexpectedly |
| 4008 | `TimeoutError` | Request timed out |

To add a new error:
1. Add code to `ErrorCodes` in `errors.ts`
2. Create error class extending `OneSatError`
3. Add case to `fromErrorResponse()` switch
4. Export from `index.ts`

## ConnectParams Challenge Pattern

The `connect()` method accepts optional `ConnectParams` with a `challenge` string.
When provided, the wallet popup signs the challenge with BSM during the same user
interaction, returning the signature in `ConnectResult.signedMessage`. This avoids
a second `window.open()` which browsers block.

**Critical**: This is the recommended pattern for any dApp that needs to verify wallet
ownership after connecting. Without it, `signMessage()` requires a second popup that
will be blocked in most browsers.

## Build & Publish

```bash
# Build
bun run build   # Bundles to dist/ + generates .d.ts

# Publish (use npm-publish skill)
# Current version: check package.json
# npm registry: npm view @1sat/connect version
```

The build uses `bun build` for the JS bundle and `tsc --emitDeclarationOnly` for type declarations.

## Key Design Decisions

- **DEFAULT_POPUP_URL**: `https://www.1satwallet.com` — must include `www` due to 307 redirect
- **Timeout**: 5 minutes (300,000ms) — wallet operations can take time
- **Popup check interval**: 500ms — checks if popup was closed
- **Storage**: localStorage for connection persistence across page loads
- **CWI Transport**: Separate from popup flow — used for BRC-100 operations via embed/redirect

## Additional Resources

### Reference Files

- **`references/protocol-spec.md`** — Detailed protocol message specification
- **Root README.md** — SDK overview and quick start
- **`packages/extension/README.md`** — Browser extension development guide

### Related Repos

- **1sat-web** (`~/code/1sat-web`) — Wallet popup pages that handle SDK requests
- **sigma-auth** (`~/code/sigma-auth`) — Reference consumer using challenge signing
