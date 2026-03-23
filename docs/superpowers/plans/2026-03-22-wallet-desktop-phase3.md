# wallet-desktop Phase 3: Web3 Super-App

## Context

The desktop wallet has a working foundation (wallet engine, vault, BRC-100 server, BigBlocks UI, permission dialogs). Phase 3 transforms it from a wallet into a Web3 everything-app: built-in browser with wallet injection, local indexer, and real-time messaging.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Electrobun Shell (Bun native process)                      │
│  ├─ Wallet engine (@1sat/wallet-node + vault + Touch ID)    │
│  ├─ BRC-100 HTTP/HTTPS server (3321/2121)                   │
│  ├─ Permission approval RPC                                 │
│  ├─ Sidecar process manager                                 │
│  ├─ 1sat:// protocol handler                                │
│  └─ System tray, menus, global shortcuts                    │
├─────────────────────────────────────────────────────────────┤
│  Main WebView (React + BigBlocks)                           │
│  ├─ Three-panel layout (sidebar, content, wallet panel)     │
│  ├─ Embedded browser tabs (electrobun-webview tags)         │
│  ├─ BitChat Nitro real-time messaging                       │
│  └─ Permission approval dialogs                             │
├─────────────────────────────────────────────────────────────┤
│  Sidecar: 1sat-stack (local indexer)                        │
│  ├─ Ordinals, tokens, BAP, social indexing                  │
│  └─ Replaces api.1sat.app for local/fast queries            │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature 1: Built-in Browser with Wallet Injection

### What
A tabbed browser inside the wallet that auto-injects `window.CWI` (BRC-100 wallet interface) into every page. Any dApp loaded in the browser automatically has wallet access — no extension needed.

### How
- Use Electrobun's `electrobun-webview` HTML tag for each browser tab
- Reference: `bunx electrobun init multitab-browser` template
- CWI preload script injected via `preload="views://cwi-preload/index.js"`
- Navigation controls: URL bar, back/forward/reload, tab strip
- `new-window-open` event intercepted to open links in new tabs
- Navigation rules: allow HTTPS + `1sat://`, block plain HTTP
- Session partitions per tab for isolation

### Files
- Create: `src/mainview/views/browser/index.tsx` — tab manager + URL bar
- Create: `src/preloads/cwi.ts` — CWI wallet injection preload
- Modify: `src/mainview/components/layout/sidebar-nav.tsx` — add Browser nav item
- Modify: `src/mainview/components/layout/desktop-layout.tsx` — add browser route
- Modify: `electrobun.config.ts` — add `urlSchemes: ["1sat"]`, `views.cwi-preload`

### CWI Preload Pattern
```typescript
// src/preloads/cwi.ts
// Injects window.CWI into every dApp page
const CWI_METHODS = [
  'createAction', 'signAction', 'listActions', 'listOutputs',
  'getPublicKey', 'createSignature', 'encrypt', 'decrypt', ...
]

window.CWI = Object.fromEntries(
  CWI_METHODS.map(method => [method, async (args) => {
    return window.__electrobunSendToHost(
      JSON.stringify({ type: 'CWI', method, args })
    )
  }])
)
```

---

## Feature 2: `1sat://` Deep Links

### What
Register the `1sat://` protocol so other apps/browsers can deep-link into the wallet.

### How
- Add `urlSchemes: ["1sat"]` to `electrobun.config.ts` app config
- Handle `Electrobun.events.on("open-url", ...)` in Bun process
- Route examples:
  - `1sat://send?to=<address>&amount=<sats>` → open send form
  - `1sat://inscribe?file=<url>` → open inscribe tool
  - `1sat://browse/<url>` → open URL in built-in browser
  - `1sat://ordinal/<outpoint>` → show ordinal detail

### Files
- Modify: `electrobun.config.ts` — add urlSchemes
- Modify: `src/bun/index.ts` — add open-url event handler + RPC push
- Modify: `src/shared/types.ts` — add deepLink message type
- Modify: `src/mainview/App.tsx` or layout — handle deep link navigation

---

## Feature 3: 1sat-stack Local Indexer Sidecar

### What
Run 1sat-stack as a child process alongside the wallet. Provides local indexing so the wallet doesn't depend on the remote api.1sat.app for queries.

### How
- Spawn 1sat-stack as a child process from the Bun entry point
- Configure it to use a local database at `Utils.paths.userData/indexer/`
- Point the wallet's `@1sat/client` services to `http://localhost:<stack-port>` instead of `api.1sat.app`
- Manage lifecycle: start on wallet launch, stop on quit

### Files
- Create: `src/bun/sidecar-manager.ts` — spawn/manage child processes
- Modify: `src/bun/index.ts` — start sidecar on launch
- Modify: `src/bun/wallet-manager.ts` — configure services URL to local stack

### Open Questions
- What port does 1sat-stack listen on?
- What database does it use? (SQLite? PostgreSQL?)
- Can it run as a single Bun process or does it need Go/Docker?
- How much disk space does a full index need?
- Can we run a partial index (just the user's addresses)?

---

## Feature 4: BitChat Nitro Real-Time Messaging

### What
Discord-style chat with on-chain messages, encrypted DMs, and real-time updates via SSE.

### How

**Read (real-time feed):**
- Subscribe to BMAP API SSE: `GET /social/s/$all/{base64_query}`
- Parse B+MAP+AIP message format
- Display using BigBlocks `social-feed` block (already installed)

**Post messages:**
- Build OP_RETURN: B (content) + MAP (type:message, app:1sat-wallet, context:channel, channel:<name>) + AIP (BAP identity signature)
- Fund via Droplit API or wallet's own BSV
- Sign AIP natively using wallet's BAP identity key (no Sigma iframe needed — we hold the keys)

**Encrypted DMs:**
- ECIES encrypt with friend's public key (from BMAP API `/social/friend/{bapId}`)
- Add `MAP.encrypted = "true"` to the message
- Decrypt incoming DMs with wallet's identity key via `ECIES.electrumDecrypt`

**Friend system:**
- BAP-based on-chain friend requests (MAP type:friend)
- Mutual confirmation required before DMs enabled
- Type42 key derivation for DM encryption keys

### Files
- Create: `src/mainview/views/chat/index.tsx` — channel list + message feed + compose
- Create: `src/mainview/views/chat/dm.tsx` — encrypted DM view
- Create: `src/bun/chat-manager.ts` — SSE subscription + message posting
- Modify: `src/shared/types.ts` — chat RPC endpoints
- Modify: `src/bun/rpc-handlers.ts` — chat handlers
- Modify: sidebar-nav — add Chat nav item

### RPC Endpoints Needed
- `getChatChannels` → list available channels
- `getChatMessages(channel, limit, offset)` → fetch messages
- `sendChatMessage(channel, content)` → post on-chain message
- `getDmConversations` → list DM threads
- `getDmMessages(friendBapId, limit)` → fetch encrypted DMs
- `sendDm(friendBapId, content)` → encrypt + post DM
- `sendFriendRequest(bapId)` → on-chain friend request
- `acceptFriendRequest(bapId)` → confirm friend

---

## Implementation Order

1. **Browser** (highest impact, enables all dApps immediately)
2. **Deep links** (small, quick, high UX value)
3. **Chat** (needs BAP identity working + BMAP API access)
4. **1sat-stack sidecar** (needs more research on packaging)

---

## Verification

1. Open built-in browser, navigate to any dApp, confirm `window.CWI` is available
2. Click `1sat://send?to=<address>&amount=100` link from external browser, wallet opens send form
3. Open chat, see live messages in a channel, post a message, verify on-chain
4. Send encrypted DM to a friend, verify they can decrypt
5. With 1sat-stack running, ordinals/tokens load from local indexer
