# Universal Launcher Overlay — Address Bar as Raycast

**Date:** 2026-03-26
**Status:** Approved

## Summary

The address bar transforms into a Raycast-style universal launcher when focused. An overlay appears showing bookmarked apps as a grid of large icons, with a search input that filters apps, matches URLs/outpoints, and falls back to AI chat for natural language queries.

## Motivation

The current `1sat://apps` page is a flat catalog that requires full page navigation. Users should have instant access to their bookmarked apps from anywhere, and the address bar — already the primary input — should handle every type of query: app names, URLs, outpoints, and AI questions.

## Design

### Three States

**1. Idle** — Normal address bar showing current URL. No overlay.

**2. Focused** (Cmd+K, Cmd+L, or click) — Overlay appears centered in the viewport:
- Semi-transparent backdrop (`bg-background/70` with `backdrop-blur-sm`) dims the page content
- Centered panel (580px wide, `bg-card` background, `border-border` stroke, 12px radius, heavy shadow)
- Search input at top, auto-focused, placeholder: "Search apps, URLs, or ask AI..."
- Bookmarked apps grid below (6 columns, 48px icons with labels)
- "+" / Explore tile at the end of the grid -> navigates to `1sat://apps` full catalog
- Keyboard hints in footer: Tab to navigate, Enter to open, Esc to dismiss
- Empty state (no bookmarks): "Bookmark apps to see them here" with link to catalog

**3. Typing** — Real-time filtering as user types:
- App icons filter by fuzzy match on name/domain
- If input matches URL pattern -> shows "Navigate to..." suggestion
- If input matches outpoint pattern -> shows "Open on-chain content" suggestion
- If input is natural language (no matches) -> shows "Ask AI" suggestion with Enter to send to AI sidebar

### Input Pattern Matching (Priority Order)

`classifyInput()` evaluates in this order — first match wins:

1. **Bookmark match** — fuzzy `includes()` on bookmark `title` and URL domain. If any bookmarks match, return `{ type: 'app-match', apps }`. The grid filters live as the user types.
2. **Scheme URL** — input starts with `https://`, `http://`, `1sat://`, `ordfs://`, `ai://`. Return `{ type: 'url', url }`.
3. **Outpoint** — matches `^[0-9a-f]{64}_\d+$`. Return `{ type: 'outpoint', txid, vout }`.
4. **Hostname** — contains `.` and no spaces. Return `{ type: 'url', url: 'https://' + input }`.
5. **Natural language fallback** — everything else. Return `{ type: 'ai-query', text }`.

When bookmarks match AND the input also looks like a URL (e.g., `bitcoin.com` is both a bookmark and a hostname), the bookmark results show in the grid AND the URL suggestion shows below. Both are available — the grid is the primary, suggestion list is secondary.

```typescript
type InputClassification =
  | { type: 'app-match'; apps: Bookmark[] }
  | { type: 'url'; url: string }
  | { type: 'outpoint'; txid: string; vout: number }
  | { type: 'internal'; page: string }
  | { type: 'ai-query'; text: string }
```

### Data Sources

**Bookmarks** — existing `useBookmarks()` hook (localStorage). Each bookmark has `url`, `title`, `category` (`onchain` | `web`). On-chain apps show a subtle chain-link badge.

**Bookmark icons** — the `Bookmark` interface has no `icon` field today. Add an optional `favicon` field to `Bookmark`. When adding a bookmark, attempt to fetch `https://{domain}/favicon.ico`. For on-chain content, generate a color from the title hash and show initials. Fallback: initials on a gradient derived from the bookmark title.

**Catalog apps** — fetched from `metanet-apps` overlay via `AppCatalog.findApps()`. These appear in the Explore view (`1sat://apps`), not in the launcher grid unless bookmarked.

### Keyboard Shortcuts

- `Cmd+K` or `Cmd+L` — open/focus the launcher overlay
- `Esc` — dismiss overlay, return focus to page
- `Tab` / `Arrow keys` — navigate between app icons and suggestions
- `Enter` — open selected item (or send to AI if no match)
- `Cmd+D` — bookmark current page (existing)

### Component Structure

| Component | File | Responsibility |
|-----------|------|---------------|
| `LauncherOverlay` | `components/launcher/launcher-overlay.tsx` | Root overlay with backdrop, manages open/close state |
| `LauncherInput` | `components/launcher/launcher-input.tsx` | Search input with `classifyInput()` logic |
| `AppGrid` | `components/launcher/app-grid.tsx` | Renders bookmarked app icons in filterable grid |
| `SuggestionList` | `components/launcher/suggestion-list.tsx` | Shows URL/outpoint/AI suggestions when typing |
| `classifyInput()` | `lib/classify-input.ts` | Pure function: text -> InputClassification |

The overlay is rendered as a portal at the `BrowserLayout` level, controlled by `isLauncherOpen` state. It reads from `useBookmarks()` for the app grid.

### AddressBar Integration

The `AddressBar` component currently manages its own `editing` state via `handleFocus`/`handleBlur`. To intercept focus:

1. Add `onLauncherOpen` callback prop to `AddressBar` and `Toolbar`
2. In `AddressBar.handleFocus`, instead of entering edit mode, call `onLauncherOpen()`
3. The `BrowserLayout` sets `isLauncherOpen = true` and renders the overlay
4. When the overlay closes (Esc, backdrop click, or navigation), reset `isLauncherOpen` and the address bar returns to idle
5. The overlay's `LauncherInput` handles all text input — the address bar itself doesn't enter edit mode

### Home Page Apps Tile

The "Apps" shortcut on the home page currently navigates to `1sat://apps`. To open the launcher instead:

1. Add an `onOpenLauncher` callback to `HomeViewProps`
2. The Apps shortcut calls `onOpenLauncher()` instead of `onNavigate('1sat://apps')`
3. `BrowserLayout` passes the launcher open handler through to the home view

### AI Sidebar Integration

When the AI fallback triggers (user types natural language, hits Enter):

1. The launcher overlay dismisses
2. Navigate to `ai://{query}` using the existing `onNavigate` — the URL parser already handles `ai://` scheme and routes to the AI chat view
3. No new props needed on `AgentSidebar` — the `ai://` navigation path already works

### Visual Design

All colors use theme-aware tokens — no hard-coded hex values.

- App icons: 48px, 12px border-radius. Favicon if available, otherwise initials on a gradient generated from title hash
- Grid: 6 columns with 12px gap
- Overlay: `bg-card` background, `border border-border`, 12px radius, `shadow-2xl`
- Backdrop: `bg-background/70 backdrop-blur-sm`
- Animations: overlay fades in 150ms (`animate-in fade-in`), dismisses on Esc
- Scrolling: if bookmarks exceed 3 rows (18 items), the grid scrolls vertically with max-height

### Edge Cases

- **No bookmarks** — show empty state: centered icon + "Bookmark apps to see them here" + "Explore Apps" button linking to catalog
- **Many bookmarks** — grid scrolls vertically, max 3 rows visible (overflow-y-auto)
- **Ambiguous input** — bookmark matches AND URL-like input can coexist: grid filters to matching bookmarks, suggestion list shows "Navigate to..." below

## Out of Scope

- Full app detail pages with screenshots/banners (separate feature)
- Plugin/extension system for the launcher
- Raycast plugin
- App "installation" (caching on-chain content locally)
- Recent history section (add in v2 when we have persisted navigation history)
