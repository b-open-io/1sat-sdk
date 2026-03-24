# Changelog

## [0.1.0] - 2026-03-23

### Renamed
- "1Sat Wallet" → "1Sat" — app name, menus, manifests, Touch ID prompts
- `com.1satwallet` → `app.1sat` bundle identifier
- Domain: `1sat.app`

### Added

**MCP Server (port 3322)**
- 25 tools: browser windows, tab interaction, marketplace, 1sat-stack data, wallet ops
- BRC-31 authentication with in-memory sessions
- HTTP Streamable transport with session management
- Health check endpoint, DELETE session termination
- Smoke test script (`scripts/test-mcp-auth.ts`)

**Browser Views**
- Ordinal detail — split layout with ORDFS content preview + metadata panel
- Token detail — hero header, balance band, History/Info tabs from BSV21 API
- Transaction detail — inputs/outputs flow, merkle proof, collapsible raw hex
- Sweep wizard — 4-step import flow (paste WIF → scan → select → confirm)
- App catalog — real on-chain apps via `metanet-apps` package
- Publish wizard — 6-step inscription flow (type → upload → metadata → review → broadcast → success)
- DM view — 1-on-1 messaging UI (send placeholder, needs BRC-103)
- Send BSV — form → review → confirm → success
- Receive BSV — QR code + address copy
- Market — real OrdLock listings from 1sat-stack with search + sort
- Settings Security — vault status, auto-lock, connected apps
- Settings Network — stack health, sync progress, service status
- Settings AI — provider config, model selector

**Marketplace**
- `listOrdinal` — list ordinal for sale via OrdLock
- `cancelListing` — cancel an active listing
- `purchaseOrdinal` — buy ordinal from marketplace
- `purchaseBsv21` — buy BSV21 token from OrdLock listing

**bap:// Protocol**
- URL scheme registered with OS (`bap://bapId` → profile, `bap://bapId/message` → DM)
- BAP ID validated with base58 regex
- Protocol spec at `docs/protocols/bap-url-scheme.md`

**Navigation**
- Ordinals gallery → detail click
- Tokens list → detail click
- History → transaction detail click
- Dashboard cards → respective views
- Social author → identity profile
- OpNS names → 1sat:// content

**Hotkeys**
- Cmd+Shift+I — toggle dev tools
- Cmd+Shift+J — toggle sync log
- Link hover tooltip (Chrome-style, internal pages)

**Identity**
- External profile view via `bap://` deep links
- Follow button (BSocial on-chain post)
- Message button → DM navigation

**Design**
- 16 new page frames in browser.pen
- 5 design accuracy fixes from audit

### Fixed
- Silent launch crash in release builds (missing `sigma-protocol` transitive dependency)
- setTimeout memory leaks in 4 views (DM, Send, Receive, Sweep)
- Market view: removed hardcoded fallback data (fail informatively per project rules)
- DM view: replaced hardcoded oklch colors with theme tokens
- Tx detail: split shared copied state (txid vs hex)
- Publish wizard: unreachable broadcasting state, broken retry button, wrong back navigation
- Navigation: broken DM profile link (`identity/${bapId}` → `identity/profile?bapId=`)
- Accessibility: `div[role=button]` → `<button>` in 6 views
- MCP server: temporal dead zone in session creation, missing DELETE handler

## [0.0.1] - 2026-03-22

Initial release.
