import { useCallback, useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Bookmark {
  id: string
  url: string
  title: string
  category: 'onchain' | 'web'
  createdAt: number
}

export interface UseBookmarksReturn {
  bookmarks: Bookmark[]
  addBookmark: (url: string, title: string) => void
  removeBookmark: (id: string) => void
  isBookmarked: (url: string) => boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = '1sat-browser-bookmarks'

/**
 * Internal pages that are NOT considered on-chain content.
 * A 1sat:// URL is on-chain only if it does not match these prefixes.
 */
const INTERNAL_PREFIXES = [
  '1sat://browser/',
  '1sat://wallet/',
  '1sat://settings',
  '1sat://social/',
  '1sat://tokens/',
  '1sat://ordinals/',
  '1sat://collections/',
  '1sat://locks/',
  '1sat://opns/',
  '1sat://chat',
  '1sat://identity/',
  '1sat://publish/',
  '1sat://apps',
  '1sat://onboarding/',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectCategory(url: string): 'onchain' | 'web' {
  if (!url.startsWith('1sat://')) return 'web'
  for (const prefix of INTERNAL_PREFIXES) {
    if (url.startsWith(prefix)) return 'web'
  }
  return 'onchain'
}

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as Bookmark[]
  } catch {
    return []
  }
}

function saveBookmarks(bookmarks: Bookmark[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks))
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBookmarks(): UseBookmarksReturn {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks)

  // Sync to localStorage whenever bookmarks change
  useEffect(() => {
    saveBookmarks(bookmarks)
  }, [bookmarks])

  const addBookmark = useCallback((url: string, title: string) => {
    setBookmarks((prev) => {
      // Deduplicate by URL
      if (prev.some((b) => b.url === url)) return prev
      const bookmark: Bookmark = {
        id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url,
        title: title.trim() || url,
        category: detectCategory(url),
        createdAt: Date.now(),
      }
      return [...prev, bookmark]
    })
  }, [])

  const removeBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const isBookmarked = useCallback(
    (url: string) => bookmarks.some((b) => b.url === url),
    [bookmarks],
  )

  return { bookmarks, addBookmark, removeBookmark, isBookmarked }
}
