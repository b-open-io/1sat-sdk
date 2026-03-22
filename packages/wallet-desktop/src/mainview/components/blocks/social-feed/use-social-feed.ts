import { useCallback, useEffect, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A signer entry attached to a post (AIP identity) */
export interface PostSigner {
  /** Algorithm identifier (e.g. "BITCOIN_ECDSA") */
  algorithm: string
  /** Bitcoin address of the signer */
  address: string
  /** BAP identity ID, if present */
  bapId?: string
}

/** Author profile resolved from the BAP API */
export interface AuthorProfile {
  /** BAP identity ID */
  bapId: string
  /** Display name */
  name?: string
  /** Profile image URL or on-chain reference */
  avatar?: string
  /** Bitcoin address */
  address?: string
}

/** A single BSocial post as returned by the 1sat-stack API */
export interface SocialPost {
  /** Transaction ID of the post */
  txid: string
  /** Post content text */
  content: string
  /** Timestamp in seconds since epoch */
  timestamp: number
  /** App name from MAP protocol */
  app: string
  /** Action type (post, reply, etc.) */
  type: string
  /** Channel the post belongs to, if any */
  channel?: string
  /** Signer/author information from AIP */
  signers?: PostSigner[]
  /** Resolved author profile (populated client-side) */
  author?: AuthorProfile
  /** Number of likes on this post */
  likes?: number
  /** Number of replies to this post */
  replies?: number
  /** Media outpoint if post has embedded media */
  mediaOutpoint?: string
}

/** Raw post shape from 1sat-stack search endpoint */
interface RawSearchPost {
  txid: string
  B?: { content?: string; "content-type"?: string; encoding?: string }
  MAP?: {
    app?: string
    type?: string
    context?: string
    contextValue?: string
    channel?: string
  }
  timestamp?: number
  blk?: { t?: number }
  likes?: number
  replies?: number
}

/** Raw post shape from 1sat-stack address endpoint (includes signers) */
interface RawAddressPost extends RawSearchPost {
  AIP?: Array<{
    algorithm?: string
    address?: string
    bapId?: string
  }>
}

export interface UseSocialFeedOptions {
  /** Channel to filter posts by */
  channel?: string
  /** Search query string */
  query?: string
  /** Number of posts per page (default: 20) */
  limit?: number
  /** Base URL for the 1sat-stack API (default: https://api.1sat.app) */
  apiUrl?: string
  /** Whether to auto-fetch on mount (default: true) */
  autoFetch?: boolean
}

export interface UseSocialFeedReturn {
  /** Array of fetched posts */
  posts: SocialPost[]
  /** Whether the initial fetch is in progress */
  isLoading: boolean
  /** Whether a "load more" request is in progress */
  isLoadingMore: boolean
  /** Error from the most recent fetch, if any */
  error: Error | null
  /** Whether more posts are available beyond the current page */
  hasMore: boolean
  /** Fetch the next page of posts */
  loadMore: () => Promise<void>
  /** Re-fetch from the beginning */
  refresh: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://api.1sat.app"
const DEFAULT_LIMIT = 20

function normalizePost(raw: RawSearchPost | RawAddressPost): SocialPost {
  const signers: PostSigner[] = []
  if ("AIP" in raw && Array.isArray(raw.AIP)) {
    for (const signer of raw.AIP) {
      signers.push({
        algorithm: signer.algorithm ?? "BITCOIN_ECDSA",
        address: signer.address ?? "",
        bapId: signer.bapId,
      })
    }
  }

  return {
    txid: raw.txid,
    content: raw.B?.content ?? "",
    timestamp: raw.blk?.t ?? raw.timestamp ?? 0,
    app: raw.MAP?.app ?? "bsocial",
    type: raw.MAP?.type ?? "post",
    channel: raw.MAP?.channel ?? raw.MAP?.contextValue,
    signers: signers.length > 0 ? signers : undefined,
    likes: raw.likes ?? 0,
    replies: raw.replies ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSocialFeed({
  channel,
  query,
  limit = DEFAULT_LIMIT,
  apiUrl = DEFAULT_API_URL,
  autoFetch = true,
}: UseSocialFeedOptions = {}): UseSocialFeedReturn {
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const offsetRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const fetchPosts = useCallback(
    async (offset: number, isRefresh: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      if (isRefresh) {
        setIsLoading(true)
      } else {
        setIsLoadingMore(true)
      }
      setError(null)

      try {
        const params = new URLSearchParams()
        if (query) params.set("q", query)
        if (channel) params.set("channel", channel)
        params.set("limit", String(limit))
        params.set("offset", String(offset))

        const url = `${apiUrl}/1sat/bsocial/post/search?${params.toString()}`
        const response = await fetch(url, { signal: controller.signal })

        if (!response.ok) {
          throw new Error(
            `Failed to fetch posts: ${response.status} ${response.statusText}`
          )
        }

        const data: RawSearchPost[] = await response.json()
        const normalized = data.map(normalizePost)

        if (isRefresh) {
          setPosts(normalized)
        } else {
          setPosts((prev) => [...prev, ...normalized])
        }

        offsetRef.current = offset + normalized.length
        setHasMore(normalized.length >= limit)
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        const fetchError =
          err instanceof Error ? err : new Error("Failed to fetch social feed")
        setError(fetchError)
      } finally {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    },
    [apiUrl, channel, limit, query]
  )

  const loadMore = useCallback(async () => {
    if (isLoadingMore || isLoading || !hasMore) return
    await fetchPosts(offsetRef.current, false)
  }, [fetchPosts, hasMore, isLoading, isLoadingMore])

  const refresh = useCallback(async () => {
    offsetRef.current = 0
    setHasMore(true)
    await fetchPosts(0, true)
  }, [fetchPosts])

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    if (!autoFetch) return
    offsetRef.current = 0
    setHasMore(true)
    fetchPosts(0, true)

    return () => {
      abortRef.current?.abort()
    }
  }, [autoFetch, fetchPosts])

  return {
    posts,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  }
}
