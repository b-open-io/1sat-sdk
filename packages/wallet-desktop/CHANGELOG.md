# Changelog

## [0.0.7] - 2026-03-25

### Added
- Light/Dark/System appearance toggle in Settings > General
- `useAppearance` hook with localStorage persistence and system preference detection
- `bootstrapTheme()` prevents flash of wrong theme before React renders
- Light theme CSS variables for all custom properties (tab bar, protocol badges, agent accents)
- ThemeToken re-applies automatically when appearance mode changes

### Fixed
- 10 view files: replaced hardcoded Tailwind colors with theme CSS variables
- AI elements: added dark: variants for status colors
- Chat: oklch inline styles replaced with bg-primary/text-primary
- Publish: 30+ hardcoded blue/purple classes replaced with primary/accent vars
- Dashboard: status colors now use chart-*/destructive variables
- About menu crashed on click — role was 'hide' instead of 'about'
- Join channel dialog positioned in 220px sidebar instead of viewport center
- MCP proxy hung on every tool call — was calling res.text() on SSE stream
- Dead transfer re-export in actions/sweep broke CI build
- ThemeToken loaded light mode only — CSS had no .dark class, no light/dark split

### Changed
- Theme settings redesigned: compact inline UI replaces heavy Card component
- CSS architecture: :root = light, .dark = dark, @media fallback for system pref

## [0.0.6] - 2026-03-24

### Fixed
- Secure Enclave binary missing from production builds — `scripts` was nested inside `build` in electrobun.config.ts but Electrobun reads it at the top level, so postBuild hook never executed
- postBuild script uses `__dirname` for absolute path resolution instead of relying on CWD
- postBuild exits fatally if enclave binary not found (was silently skipping)
- Setup wizard TDZ crash in production bundle — `advance` referenced before declaration

## [0.0.5] - 2026-03-24

### Added

**First-Time User Experience**
- Setup wizard after wallet creation — guides through stack, AI, and identity configuration
- Reusable `Empty` component (shadcn-style) — icon, title, description, optional action button
- All 13 data views migrated to Empty component with actionable descriptions
- AI chat shows "Set up AI to get started" with settings link when no provider configured
- ECONNREFUSED errors in AI chat replaced with actionable empty state
- `checkAiProvider` RPC handler — Bun-side Ollama detection for the wizard

**Observability**
- Proper evlog integration with `createFsDrain` — NDJSON logs to `~/.1sat-wallet/logs/`
- `createDrainPipeline` for batched file writes (25 events / 2s)
- MCP ring buffer drain — `wallet_logs` tool queries last 500 events
- All bun modules import from evlog directly, `log.ts` is side-effect init only
- `flushLogs()` on app quit

**MCP**
- `1sat mcp-proxy` CLI command with BRC-31 auth + evlog
- `wallet_logs` MCP tool for live log inspection
- `.mcp.json` in 1sat plugin — zero-config MCP for agents
- 1sat plugin bumped to 0.1.8
- MCP skill troubleshooting section

### Changed
- Stack onboarding banner — better copy, two-line layout with description
- AI chat model default removed — no more hardcoded `qwen3:14b`
- evlog drain replaces custom `appendFileSync` wrapper

### Fixed
- Setup wizard setTimeout cleanup bugs (3 locations) — prevented state updates after unmount
- AI settings shape mismatch between wizard and settings view (missing `apiKey`)
- Memoized wizard step callbacks to prevent unnecessary re-effects
- Removed `sigma-protocol` dependency (dead weight after templates parity)

## [0.0.4] - 2026-03-24

### Added

**MCP Server Auth Upgrade**
- BRC-103/104 mutual authentication — server signs responses with derived key
- `x-bsv-auth-request-id` tracking for per-request signature verification
- `x-bsv-auth-version` header on all auth responses
- CORS `Access-Control-Expose-Headers` for auth headers
- Backward compatible with existing BRC-31 (Authrite) clients

**Observability**
- evlog telemetry around window creation: `url_resolved`, `window_created`, `dom_ready`
- Crash diagnostics: if window fails to launch, evlog events pinpoint the failure stage

### Fixed
- `@1sat/wallet-node` missing from CI workspace build step (caused "Bundle failed")
- `@1sat/templates` published v0.0.4 — removed stale `sigma-protocol` import that crashed the bundled app on launch
- `@1sat/wallet-node` `validateDate` return type fixed (was `string`, should be `Date`)
- knex version aligned to `^3.2.5` across wallet-node and wallet-desktop

## [0.0.3] - 2026-03-24

### Added
- evlog structured logging integration
- Content type picker in publish wizard
- Confirm and success steps in send flow
- Identity chip wired to BAP data, external profile view
- Design frames for 12 internal browser pages
- Account switcher, downloads manager, settings security, chat join channel, identity not-published designs

### Fixed
- Consolidated hardcoded URLs
- History navigation
- Increased idle timeout
- Replaced hardcoded colors in settings

## [0.0.2] - 2026-03-23

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
