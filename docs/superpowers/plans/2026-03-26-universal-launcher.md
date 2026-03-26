# Universal Launcher Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the address bar into a Raycast-style universal launcher that shows bookmarked apps, filters by fuzzy search, and falls back to AI chat for natural language queries.

**Architecture:** A `LauncherOverlay` component renders as a portal at the `BrowserLayout` level, controlled by `isLauncherOpen` state. Focusing the address bar (click or Cmd+K/L) opens the overlay instead of entering edit mode. A pure `classifyInput()` function handles pattern matching. The overlay reads bookmarks from the existing `useBookmarks()` hook.

**Tech Stack:** React, Tailwind CSS (theme tokens), `@tanstack/react-hotkeys`, existing `useBookmarks()` hook, existing `parseUrl()` from `url-parser.ts`

**Spec:** `docs/superpowers/specs/2026-03-26-universal-launcher-overlay.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/mainview/lib/classify-input.ts` | Create | Pure function: text + bookmarks -> InputClassification |
| `src/mainview/lib/classify-input.test.ts` | Create | Tests for pattern matching priority |
| `src/mainview/hooks/use-bookmarks.ts` | Modify | Add optional `favicon` field to Bookmark interface |
| `src/mainview/components/launcher/launcher-overlay.tsx` | Create | Root overlay: backdrop, panel, manages focus |
| `src/mainview/components/launcher/launcher-input.tsx` | Create | Search input with auto-focus |
| `src/mainview/components/launcher/app-grid.tsx` | Create | Bookmarked app icon grid (6-col, filterable) |
| `src/mainview/components/launcher/suggestion-list.tsx` | Create | URL/outpoint/AI suggestion rows |
| `src/mainview/components/layout/browser-layout.tsx` | Modify | Add `isLauncherOpen` state, wire Cmd+K, intercept address bar focus |
| `src/mainview/views/home/index.tsx` | Modify | Apps tile opens launcher instead of navigating |

All paths relative to `packages/wallet-desktop/`.

---

## Wave 1: Foundation (parallelizable)

### Task 1: classifyInput() — Pattern Matching

**Files:**
- Create: `src/mainview/lib/classify-input.ts`
- Create: `src/mainview/lib/classify-input.test.ts`
- Read: `src/mainview/lib/url-parser.ts` (reference for parseUrl patterns)
- Read: `src/mainview/hooks/use-bookmarks.ts` (Bookmark interface)

This is a pure function with no UI dependencies — ideal for TDD.

- [ ] **Step 1: Write tests for all input patterns**

Create `src/mainview/lib/classify-input.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { classifyInput, type InputClassification } from './classify-input'
import type { Bookmark } from '../hooks/use-bookmarks'

const mockBookmarks: Bookmark[] = [
  { id: '1', url: 'https://bitchat.app', title: 'BitChat', category: 'web', createdAt: 1 },
  { id: '2', url: '1sat://abc123_0', title: 'ReactOnChain', category: 'onchain', createdAt: 2 },
  { id: '3', url: 'https://bitcoin.com', title: 'Bitcoin.com', category: 'web', createdAt: 3 },
]

describe('classifyInput', () => {
  it('returns app-match for fuzzy bookmark match', () => {
    const result = classifyInput('bitc', mockBookmarks)
    expect(result.type).toBe('app-match')
    if (result.type === 'app-match') {
      expect(result.apps.length).toBeGreaterThan(0)
      expect(result.apps[0].title).toBe('BitChat')
    }
  })

  it('returns url for scheme URLs', () => {
    const result = classifyInput('https://example.com', mockBookmarks)
    expect(result).toEqual({ type: 'url', url: 'https://example.com' })
  })

  it('returns url for 1sat:// internal pages', () => {
    const result = classifyInput('1sat://settings', mockBookmarks)
    expect(result).toEqual({ type: 'internal', page: 'settings' })
  })

  it('returns outpoint for 64-hex_N pattern', () => {
    const txid = 'a'.repeat(64)
    const result = classifyInput(`${txid}_0`, mockBookmarks)
    expect(result).toEqual({ type: 'outpoint', txid, vout: 0 })
  })

  it('returns url for hostname-like input', () => {
    const result = classifyInput('whatsonchain.com', mockBookmarks)
    expect(result).toEqual({ type: 'url', url: 'https://whatsonchain.com' })
  })

  it('returns ai-query for natural language', () => {
    const result = classifyInput('explain how ordinal locks work', mockBookmarks)
    expect(result).toEqual({ type: 'ai-query', text: 'explain how ordinal locks work' })
  })

  it('returns app-match over url when bookmark matches hostname input', () => {
    const result = classifyInput('bitcoin.com', mockBookmarks)
    // Bookmark match takes priority, but the input also looks like a URL
    expect(result.type).toBe('app-match')
  })

  it('returns ai-query for empty input', () => {
    const result = classifyInput('', mockBookmarks)
    expect(result).toEqual({ type: 'ai-query', text: '' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/wallet-desktop && bun test src/mainview/lib/classify-input.test.ts
```

- [ ] **Step 3: Implement classifyInput()**

Create `src/mainview/lib/classify-input.ts`:

```typescript
import type { Bookmark } from '../hooks/use-bookmarks'

export type InputClassification =
  | { type: 'app-match'; apps: Bookmark[] }
  | { type: 'url'; url: string }
  | { type: 'outpoint'; txid: string; vout: number }
  | { type: 'internal'; page: string }
  | { type: 'ai-query'; text: string }

const OUTPOINT_RE = /^([0-9a-f]{64})_(\d+)$/i
const SCHEME_RE = /^(https?|ordfs):\/\//
const INTERNAL_RE = /^1sat:\/\/(.+)$/
const AI_SCHEME_RE = /^ai:\/\//

function fuzzyMatch(query: string, bookmark: Bookmark): boolean {
  const q = query.toLowerCase()
  const title = bookmark.title.toLowerCase()
  const domain = bookmark.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
  return title.includes(q) || domain.includes(q)
}

function looksLikeHostname(text: string): boolean {
  return /^[^\s]+\.[a-z]{2,}$/i.test(text) && !text.includes(' ')
}

export function classifyInput(text: string, bookmarks: Bookmark[]): InputClassification {
  const trimmed = text.trim()

  if (!trimmed) return { type: 'ai-query', text: '' }

  // 1. Check bookmark fuzzy matches first
  const matches = bookmarks.filter((b) => fuzzyMatch(trimmed, b))
  if (matches.length > 0) return { type: 'app-match', apps: matches }

  // 2. Scheme URLs (https://, http://, ordfs://)
  if (SCHEME_RE.test(trimmed)) return { type: 'url', url: trimmed }

  // 3. AI scheme
  if (AI_SCHEME_RE.test(trimmed)) return { type: 'url', url: trimmed }

  // 4. Internal pages (1sat://)
  const internalMatch = trimmed.match(INTERNAL_RE)
  if (internalMatch) return { type: 'internal', page: internalMatch[1] }

  // 5. Outpoint (64 hex _ number)
  const outpointMatch = trimmed.match(OUTPOINT_RE)
  if (outpointMatch) return { type: 'outpoint', txid: outpointMatch[1], vout: Number(outpointMatch[2]) }

  // 6. Hostname-like (contains dot, no spaces)
  if (looksLikeHostname(trimmed)) return { type: 'url', url: `https://${trimmed}` }

  // 7. Natural language fallback
  return { type: 'ai-query', text: trimmed }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/wallet-desktop && bun test src/mainview/lib/classify-input.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-desktop/src/mainview/lib/classify-input.ts packages/wallet-desktop/src/mainview/lib/classify-input.test.ts
git commit -m "feat(wallet-desktop): add classifyInput() for universal launcher pattern matching"
```

---

### Task 2: Add favicon field to Bookmark

**Files:**
- Modify: `src/mainview/hooks/use-bookmarks.ts`

Small schema change — add optional `favicon` to the Bookmark interface.

- [ ] **Step 1: Add favicon to Bookmark interface**

In `src/mainview/hooks/use-bookmarks.ts`, add to the `Bookmark` interface:

```typescript
export interface Bookmark {
  id: string
  url: string
  title: string
  category: 'onchain' | 'web'
  favicon?: string  // URL to favicon image
  createdAt: number
}
```

- [ ] **Step 2: Attempt favicon fetch when adding a bookmark**

Update `addBookmark` to try fetching a favicon:

```typescript
const addBookmark = useCallback((url: string, title: string) => {
  setBookmarks((prev) => {
    if (prev.some((b) => b.url === url)) return prev
    const domain = url.replace(/^https?:\/\//, '').split('/')[0]
    const bookmark: Bookmark = {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url,
      title: title.trim() || url,
      category: detectCategory(url),
      favicon: domain ? `https://${domain}/favicon.ico` : undefined,
      createdAt: Date.now(),
    }
    return [...prev, bookmark]
  })
}, [])
```

- [ ] **Step 3: Commit**

```bash
git add packages/wallet-desktop/src/mainview/hooks/use-bookmarks.ts
git commit -m "feat(wallet-desktop): add favicon field to Bookmark interface"
```

---

## Wave 2: Launcher UI Components (parallelizable)

These components can be built in parallel — they have no dependencies on each other.

### Task 3: AppGrid Component

**Files:**
- Create: `src/mainview/components/launcher/app-grid.tsx`
- Read: `src/mainview/hooks/use-bookmarks.ts` (Bookmark type)

Renders bookmarked apps as a 6-column grid of large icons. Accepts a filter string.

- [ ] **Step 1: Create app-grid.tsx**

```typescript
import { Globe, Link2, Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Bookmark } from '../../hooks/use-bookmarks'

interface AppGridProps {
  bookmarks: Bookmark[]
  filter: string
  onSelect: (bookmark: Bookmark) => void
  onExplore: () => void
  selectedIndex: number
}

function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 45%)`
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function AppGrid({ bookmarks, filter, onSelect, onExplore, selectedIndex }: AppGridProps) {
  const filtered = filter
    ? bookmarks.filter((b) => {
        const q = filter.toLowerCase()
        return b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
      })
    : bookmarks

  if (filtered.length === 0 && !filter) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Globe size={24} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Bookmark apps to see them here</p>
        <button
          type="button"
          onClick={onExplore}
          className="text-xs text-primary hover:underline"
        >
          Explore Apps
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-6 gap-3">
      {filtered.map((bookmark, idx) => (
        <AppIcon
          key={bookmark.id}
          bookmark={bookmark}
          selected={idx === selectedIndex}
          onSelect={() => onSelect(bookmark)}
        />
      ))}
      <button
        type="button"
        onClick={onExplore}
        className="flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-muted/50 transition-colors"
      >
        <div className="size-12 rounded-xl border-2 border-dashed border-border flex items-center justify-center">
          <Plus size={18} className="text-muted-foreground" />
        </div>
        <span className="text-[10px] text-muted-foreground">Explore</span>
      </button>
    </div>
  )
}

function AppIcon({
  bookmark,
  selected,
  onSelect,
}: {
  bookmark: Bookmark
  selected: boolean
  onSelect: () => void
}) {
  const [imgError, setImgError] = useState(false)
  const color = hashColor(bookmark.title)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'flex flex-col items-center gap-1.5 p-2 rounded-lg transition-colors',
        selected ? 'bg-muted' : 'hover:bg-muted/50',
      ].join(' ')}
    >
      <div
        className="size-12 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
        style={{ background: bookmark.favicon && !imgError ? undefined : color }}
      >
        {bookmark.favicon && !imgError ? (
          <img
            src={bookmark.favicon}
            alt=""
            className="size-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="text-sm font-bold text-white">{getInitials(bookmark.title)}</span>
        )}
      </div>
      <span className="text-[10px] text-foreground truncate w-full text-center leading-tight">
        {bookmark.title}
      </span>
      {bookmark.category === 'onchain' && (
        <Link2 size={8} className="text-primary" />
      )}
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/wallet-desktop/src/mainview/components/launcher/app-grid.tsx
git commit -m "feat(wallet-desktop): add AppGrid component for launcher overlay"
```

---

### Task 4: SuggestionList Component

**Files:**
- Create: `src/mainview/components/launcher/suggestion-list.tsx`
- Read: `src/mainview/lib/classify-input.ts` (InputClassification type)

Shows URL, outpoint, or AI suggestions below the app grid when typing.

- [ ] **Step 1: Create suggestion-list.tsx**

```typescript
import { ExternalLink, Link2, Sparkles } from 'lucide-react'
import type { InputClassification } from '../../lib/classify-input'

interface SuggestionListProps {
  classification: InputClassification
  input: string
  onSelect: () => void
  selected: boolean
}

export function SuggestionList({ classification, input, onSelect, selected }: SuggestionListProps) {
  if (classification.type === 'app-match' || !input.trim()) return null

  const config = {
    url: {
      icon: ExternalLink,
      label: `Navigate to ${classification.type === 'url' ? classification.url : input}`,
      hint: 'web',
    },
    outpoint: {
      icon: Link2,
      label: `Open on-chain content`,
      hint: 'on-chain',
    },
    internal: {
      icon: ExternalLink,
      label: `Go to ${classification.type === 'internal' ? classification.page : ''}`,
      hint: 'internal',
    },
    'ai-query': {
      icon: Sparkles,
      label: `Ask AI: "${input.length > 50 ? `${input.slice(0, 50)}...` : input}"`,
      hint: 'AI',
    },
  }[classification.type]

  if (!config) return null
  const Icon = config.icon

  return (
    <div className="border-t border-border px-3 py-2">
      <button
        type="button"
        onClick={onSelect}
        className={[
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left',
          selected ? 'bg-muted' : 'hover:bg-muted/50',
          classification.type === 'ai-query' ? 'border border-primary/30' : '',
        ].join(' ')}
      >
        <div className={[
          'size-8 rounded-lg flex items-center justify-center shrink-0',
          classification.type === 'ai-query'
            ? 'bg-gradient-to-br from-primary to-violet-500'
            : 'bg-muted',
        ].join(' ')}>
          <Icon size={14} className={classification.type === 'ai-query' ? 'text-white' : 'text-muted-foreground'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-foreground truncate">{config.label}</p>
        </div>
        <span className="text-[9px] text-muted-foreground shrink-0">{config.hint}</span>
        <kbd className="text-[8px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">Enter</kbd>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/wallet-desktop/src/mainview/components/launcher/suggestion-list.tsx
git commit -m "feat(wallet-desktop): add SuggestionList component for launcher overlay"
```

---

### Task 5: LauncherInput Component

**Files:**
- Create: `src/mainview/components/launcher/launcher-input.tsx`

Thin wrapper around an input element — auto-focuses, handles Escape key, forwards onChange.

- [ ] **Step 1: Create launcher-input.tsx**

```typescript
import { Search } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface LauncherInputProps {
  value: string
  onChange: (value: string) => void
  onEscape: () => void
  onSubmit: () => void
}

export function LauncherInput({ value, onChange, onEscape, onSubmit }: LauncherInputProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Auto-focus on mount with a small delay to ensure overlay has rendered
    const timer = setTimeout(() => ref.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
      <Search size={16} className="text-muted-foreground shrink-0" strokeWidth={1.75} />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onEscape()
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder="Search apps, URLs, or ask AI..."
        className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none border-none text-[14px]"
        autoComplete="off"
        spellCheck={false}
      />
      <kbd className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">esc</kbd>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/wallet-desktop/src/mainview/components/launcher/launcher-input.tsx
git commit -m "feat(wallet-desktop): add LauncherInput component for launcher overlay"
```

---

## Wave 3: Compose the Overlay

### Task 6: LauncherOverlay — Compose All Parts

**Files:**
- Create: `src/mainview/components/launcher/launcher-overlay.tsx`
- Read: All Wave 2 components
- Read: `src/mainview/hooks/use-bookmarks.ts`
- Read: `src/mainview/lib/classify-input.ts`

This composes `LauncherInput`, `AppGrid`, and `SuggestionList` into the full overlay with backdrop and keyboard navigation.

- [ ] **Step 1: Create launcher-overlay.tsx**

```typescript
import { useCallback, useMemo, useState } from 'react'
import type { Bookmark } from '../../hooks/use-bookmarks'
import { classifyInput } from '../../lib/classify-input'
import { AppGrid } from './app-grid'
import { LauncherInput } from './launcher-input'
import { SuggestionList } from './suggestion-list'

interface LauncherOverlayProps {
  bookmarks: Bookmark[]
  onClose: () => void
  onNavigate: (url: string) => void
  onOpenAi: (query: string) => void
}

export function LauncherOverlay({ bookmarks, onClose, onNavigate, onOpenAi }: LauncherOverlayProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const classification = useMemo(
    () => classifyInput(query, bookmarks),
    [query, bookmarks],
  )

  const handleSelect = useCallback(
    (bookmark: Bookmark) => {
      onNavigate(bookmark.url)
      onClose()
    },
    [onNavigate, onClose],
  )

  const handleExplore = useCallback(() => {
    onNavigate('1sat://apps')
    onClose()
  }, [onNavigate, onClose])

  const handleSubmit = useCallback(() => {
    if (!query.trim()) return

    switch (classification.type) {
      case 'app-match':
        if (classification.apps.length > 0) {
          const target = classification.apps[Math.min(selectedIndex, classification.apps.length - 1)]
          onNavigate(target.url)
        }
        break
      case 'url':
        onNavigate(classification.url)
        break
      case 'outpoint':
        onNavigate(`1sat://${classification.txid}_${classification.vout}`)
        break
      case 'internal':
        onNavigate(`1sat://${classification.page}`)
        break
      case 'ai-query':
        onOpenAi(classification.text)
        break
    }
    onClose()
  }, [query, classification, selectedIndex, onNavigate, onOpenAi, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-[580px] max-h-[480px] bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <LauncherInput
          value={query}
          onChange={(v) => {
            setQuery(v)
            setSelectedIndex(0)
          }}
          onEscape={onClose}
          onSubmit={handleSubmit}
        />

        {/* App grid — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {classification.type === 'app-match' || !query.trim() ? (
            <>
              {!query.trim() && (
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                  Bookmarked Apps
                </p>
              )}
              <AppGrid
                bookmarks={classification.type === 'app-match' ? classification.apps : bookmarks}
                filter=""
                onSelect={handleSelect}
                onExplore={handleExplore}
                selectedIndex={selectedIndex}
              />
            </>
          ) : null}
        </div>

        {/* Suggestion for non-app inputs */}
        <SuggestionList
          classification={classification}
          input={query}
          onSelect={handleSubmit}
          selected={classification.type !== 'app-match'}
        />

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 flex justify-between items-center">
          <div className="flex gap-3">
            <span className="text-[9px] text-muted-foreground">
              <kbd className="bg-muted px-1 py-0.5 rounded text-[8px]">Tab</kbd> navigate
            </span>
            <span className="text-[9px] text-muted-foreground">
              <kbd className="bg-muted px-1 py-0.5 rounded text-[8px]">Enter</kbd> open
            </span>
          </div>
          <span className="text-[9px] text-muted-foreground/50">type anything</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/wallet-desktop/src/mainview/components/launcher/launcher-overlay.tsx
git commit -m "feat(wallet-desktop): add LauncherOverlay composing all launcher components"
```

---

## Wave 4: Wire Into BrowserLayout

### Task 7: Integrate Launcher Into BrowserLayout

**Files:**
- Modify: `src/mainview/components/layout/browser-layout.tsx`
- Modify: `src/mainview/views/home/index.tsx`

This is the final wiring — add state, intercept address bar focus, remap Cmd+K, and render the overlay.

- [ ] **Step 1: Add launcher state and import**

At the top of `BrowserLayout` (inside the component function), add:

```typescript
import { LauncherOverlay } from '../launcher/launcher-overlay'

// Inside BrowserLayout component:
const [isLauncherOpen, setIsLauncherOpen] = useState(false)

const openLauncher = useCallback(() => setIsLauncherOpen(true), [])
const closeLauncher = useCallback(() => setIsLauncherOpen(false), [])
```

- [ ] **Step 2: Change focusAddressBar to open the launcher**

Replace the existing `focusAddressBar` (line ~1393):

```typescript
const focusAddressBar = useCallback(() => {
  setIsLauncherOpen(true)
}, [])
```

This means Cmd+K and Cmd+L now open the launcher overlay instead of focusing the address bar input.

- [ ] **Step 3: Add AI navigation handler**

```typescript
const handleLauncherAi = useCallback((query: string) => {
  navigate(`ai://${encodeURIComponent(query)}`)
}, [navigate])
```

- [ ] **Step 4: Render the LauncherOverlay**

In the JSX return, add the overlay right before the closing wrapper div:

```tsx
{isLauncherOpen && (
  <LauncherOverlay
    bookmarks={bookmarksApi.bookmarks}
    onClose={closeLauncher}
    onNavigate={(url) => {
      closeLauncher()
      navigate(url)
    }}
    onOpenAi={handleLauncherAi}
  />
)}
```

- [ ] **Step 5: Pass openLauncher to HomeView**

Update the `HomeViewProps` interface in `src/mainview/views/home/index.tsx`:

```typescript
export interface HomeViewProps {
  onNavigate?: (url: string) => void
  onOpenLauncher?: () => void
  params?: Record<string, string>
}
```

Change the "Apps" shortcut to call the launcher:

```typescript
// In HomeView component:
const handleShortcut = useCallback(
  (shortcut: Shortcut) => {
    if (shortcut.url === '1sat://apps' && onOpenLauncher) {
      onOpenLauncher()
    } else {
      onNavigate?.(shortcut.url)
    }
  },
  [onNavigate, onOpenLauncher],
)
```

Then in `BrowserLayout`, where `HomeView` is rendered in the page registry, pass `onOpenLauncher={openLauncher}`.

- [ ] **Step 6: Verify the full flow**

```bash
bun run --filter '@1sat/wallet-desktop' dev
```

Test:
1. Press Cmd+K — launcher overlay appears
2. Click address bar — launcher overlay appears
3. Type "bit" — filters to matching bookmarks
4. Type "whatsonchain.com" — shows URL suggestion
5. Type "explain ordinal locks" — shows AI suggestion
6. Press Enter on AI suggestion — AI sidebar opens
7. Press Escape — overlay dismisses
8. Click "Apps" tile on home page — launcher overlay appears (not navigation)
9. Click "+" Explore tile — navigates to `1sat://apps` catalog

- [ ] **Step 7: Commit**

```bash
git add packages/wallet-desktop/src/mainview/components/layout/browser-layout.tsx packages/wallet-desktop/src/mainview/views/home/index.tsx
git commit -m "feat(wallet-desktop): wire universal launcher into BrowserLayout and home page"
```

---

## Validation Checklist

1. `bun test src/mainview/lib/classify-input.test.ts` — all tests pass
2. `bun run lint` — no new errors in changed files
3. `bun run --filter '@1sat/wallet-desktop' build` — builds clean
4. Manual: Cmd+K opens launcher, Escape dismisses
5. Manual: typing filters bookmarks, AI fallback works
6. Manual: Apps home tile opens launcher, Explore tile goes to catalog
