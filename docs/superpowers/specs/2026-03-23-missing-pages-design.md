# Missing Pages Design Spec — 7 New Views

**Date:** 2026-03-23
**Status:** Approved for implementation in browser.pen

## Context

14 of 15 wallet-desktop views are production-ready. The home page links to `1sat://market` and `1sat://apps` which go nowhere. Several views show data in flat lists with no drill-down. The APIs (1sat-stack, wallet RPC) support much richer interactions than what's surfaced in the UI. This spec covers 7 new page designs to close those gaps.

## Design System (existing)

- Dark theme, 1200x800 frames
- CSS vars: `$bg`, `$card`, `$card-elevated`, `$border`, `$primary` (blue), `$muted-fg`, `$input-bg`
- Font: Space Grotesk
- Icons: Lucide (stroke-width 1.5-2px)
- Chrome: tab bar (30px, `$card-elevated`) + toolbar (36px, address bar + nav)
- Cards: `$card` fill, `$border` 1px stroke, 8px radius
- Content: vertical scroll, 24px padding

---

## 1. Ordinal Detail (`1sat://ordinals/:outpoint`)

**Layout:** Split — 55% content left, 45% metadata right.

**Left column:**
- Content preview: full-width `$card` container, `$bg` inner for letterboxing, aspect-ratio preserved (max ~480px tall), 8px radius
- Image: `object-fit: contain`. HTML inscriptions: sandboxed iframe. Video: native player
- Below preview: metadata strip — MIME type pill (`$card-elevated`, 6px radius), file size, block height

**Right panel** (scrollable):
- Identity header: inscription number (`$muted-fg` 13px), name (20px weight 600), app attribution
- Status badge: listed → `$primary` tinted pill with price. Unlisted → `$border` pill
- Action buttons in `$card` panel:
  - Unlisted: [Transfer (outline)] [List for Sale (primary)] — half-width each
  - Listed: [Cancel Listing (destructive red)] — full width
  - Not owned: [Buy for X BSV (primary)] — full width
- Inline price input: expands under "List for Sale" when clicked (not modal)
- Attributes section (collapsible, open): 2-column grid of MAP key-values
- Inscription data (collapsible, closed): txid (monospace, copy), vout, block
- External links: "View on WhatsOnChain", "Copy outpoint"

---

## 2. Token Detail (`1sat://tokens/:tokenId`)

**Layout:** Single column, 1000px max-width centered, sticky hero header.

**Hero header** (120px, `$card-elevated`, full-width):
- Token icon (48px circle, ORDFS image, fallback: first letter on `$primary` bg)
- Symbol (28px weight 700) + full name (14px `$muted-fg`)
- Send button pushed right (primary, 36px height)

**Balance band** (72px, `$card`, `$border` top+bottom):
- "Your Balance" label (11px uppercase `$muted-fg`)
- Balance value (24px weight 700)
- Copy Token ID icon (right)

**Content tabs:** History | UTXOs | Info — active tab has `$primary` bottom border (2px)

**Transaction history** (default tab):
- Rows (48px): direction icon (↓ receive = `$primary`, ↑ send = `$muted-fg`), label + truncated address, amount (green for receive), block height
- `$border` divider between rows, hover → `$card-elevated`

**Token info** (tab):
- 3-column grid: Total Supply, Decimals, Deploy TX
- Labels 11px `$muted-fg` uppercase, values 13px `$fg`

**UTXOs** (tab, power-user):
- Outpoint (monospace truncated) + amount per row

---

## 3. Transaction Detail (`1sat://wallet/tx/:txid`)

**Layout:** Single column, 800px max-width centered.

**Summary card** (top):
- Status indicator: green pulsing dot (confirmed), yellow spinner (pending)
- Total amount (1.6rem weight 700, centered)
- Timestamp below (0.65rem `$muted-fg`)

**Inputs → Outputs** (split card):
- Single `$card`, split 50/50 with vertical divider
- Left: "Inputs" header + address rows with amounts
- Center: `→` arrow icon on the divider
- Right: "Outputs" header + address rows with amounts + spent indicator
- Hover highlighting: hovering an input highlights its matching output

**Proof section** (`$card`):
- Block height, confirmations, fee — 3-row key-value layout

**Raw data** (collapsible):
- Monospace hex block, "Copy Hex" sticky button

---

## 4. Sweep/Import Wizard (`1sat://wallet/sweep`)

**Layout:** 700px centered card, vertical stepper left (25%) + content right (75%).

**Stepper** (left column):
- 5 numbered dots connected by vertical line
- Active: `$primary` fill. Completed: checkmark. Future: `$border` outline
- Labels: Input → Scanning → Select → Confirm → Complete

**Steps:**
1. **Input:** Large textarea for WIF, paste button, derived address preview below
2. **Scanning:** Centered pulse/radar animation
3. **Select:** Scrollable asset list — BSV amount, ordinal thumbnails, token balances — each with checkbox
4. **Confirm:** Summary of selected assets, estimated fee, "Sweep" primary button
5. **Success:** Checkmark icon, txid (copy), "View in History" link

**Transitions:** Content slides up + fades in (translateY 20px, opacity 0→1).

---

## 5. App Catalog (`1sat://apps`)

**Layout:** Full-width (1200px, 32px padding), scrollable.

**Search bar** (top center): `$card` with `$border`, Lucide `Search` icon, 400px wide

**Category tabs:** Horizontal pills below search — All (primary fill), On-Chain, Web, Popular, Trusted, Trending (outline). Active pill: `$primary` bg, dark text.

**Featured spotlight:** 2:1 hero card, gradient overlay on background image, app icon + title + description, "Launch" primary button. Margin-bottom 16px.

**App grid:** 4-column CSS grid, gap 10px.
- App card: `$card` bg, 8px radius, 12px padding, centered icon (36px rounded square) + name (0.7rem weight 600) + description (0.6rem `$muted-fg`)
- Trust badge: Lucide `ShieldCheck` green icon next to verified apps
- Hover: translateY(-4px), border → `$primary`

**Detail overlay** (when tapping an app):
- Slides in from right or expands as modal
- Banner image, screenshots carousel (horizontal scroll), full description, publisher chip, "Launch" button

---

## 6. Publish Wizard (`1sat://publish/new`)

**Layout:** 800px max-width, top-aligned (48px top padding), horizontal progress bar.

**Progress bar** (top): 6 segments. Completed = `$primary`, current = half-opacity `$primary`, future = `$border`.

**Steps:**
1. **Select type:** 2x2 grid of large cards — Image, Video, Document, HTML App. Each card: icon (Lucide), label, brief description. Selected: `$primary` border
2. **Upload:** Large dashed-border drop zone, Lucide `UploadCloud`, file preview after upload
3. **Metadata:** Dynamic form — MAP key/value rows, "Add field" button, collection selector dropdown, royalty configuration
4. **Review:** Split — content preview left, JSON payload right
5. **Broadcasting:** Centered spinner with "Broadcasting to network..." text
6. **Success:** Checkmark, txid, outpoint, "View Inscription" and "Publish Another" buttons

**Footer:** Fixed at bottom — [Back (outline)] [Next (primary)]

**Transitions:** Content slides left-to-right between steps.

---

## 7. Settings — Security & Network Tabs

Both tabs live within the existing Settings view (tabbed interface).

### Security Tab

**Vault status card** (`$card`, 8px radius):
- Lock icon (36px), "Vault Protected", "Touch ID (Secure Enclave)", status badge green "Active"

**Auto-lock timeout:** Dropdown selector — 5m, 15m, 30m, 1h, Never

**Connected apps** (section header + list):
- Each row: app icon (20px rounded), domain name, permission count badge, "Revoke" text button (destructive red)
- `$card` container, `$border` row dividers

**Backup section:**
- "Export Recovery Phrase" — warning-styled card with lock icon, button to reveal (requires Touch ID)

### Network Tab

**Stack health** (3-column grid of stat cards):
- Block Height (large number), Uptime (formatted), Status (green "Running" / red "Stopped")

**Sync progress:**
- Linear progress bar (`$border` track, `$primary` fill), percentage label, "Block X / Y" text

**Services** (`$card` list):
- BRC-100 HTTP :3321, BRC-100 HTTPS :2121, MCP Server :3322 — each row with green/red status dot

**Stack admin:** Button to open `/1sat/admin` in browser tab

---

## Implementation Notes

- All pages follow the existing browser chrome (tab bar + toolbar) pattern
- New pages need routes added to `url-types.ts` (`InternalPage` union) and `page-registry.tsx`
- Detail views need RPC handlers for data not currently exposed (e.g., `getInscriptionMetadata`, `getTokenInfo`)
- Wizard flows should use local component state, not new RPC methods until the final action
- App catalog needs `metanet-apps` package added as a dependency
