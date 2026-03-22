import { useCallback, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LikeResult {
  /** Transaction ID of the like/unlike action */
  txid?: string
  /** Raw transaction hex */
  rawtx?: string
  /** Error message if the action failed */
  error?: string
}

export interface UseLikeOptions {
  /** Transaction ID of the content to like */
  txid: string
  /** Current like count to display */
  count?: number
  /** Whether the current user has already liked this content */
  liked?: boolean
  /** Called to broadcast a like action */
  onLike: (txid: string) => Promise<LikeResult>
  /** Called to broadcast an unlike action */
  onUnlike?: (txid: string) => Promise<LikeResult>
  /** Called after a successful like/unlike */
  onToggled?: (liked: boolean, result: LikeResult) => void
  /** Called on error */
  onError?: (error: Error) => void
}

export interface UseLikeReturn {
  /** Whether the content is currently liked */
  isLiked: boolean
  /** Current display count */
  displayCount: number
  /** Whether a like/unlike action is in progress */
  isLoading: boolean
  /** Toggle the like state */
  handleToggle: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLike({
  txid,
  count = 0,
  liked = false,
  onLike,
  onUnlike,
  onToggled,
  onError,
}: UseLikeOptions): UseLikeReturn {
  const [isLiked, setIsLiked] = useState(liked)
  const [displayCount, setDisplayCount] = useState(count)
  const [isLoading, setIsLoading] = useState(false)

  const handleToggle = useCallback(async () => {
    if (isLoading) return

    const wasLiked = isLiked

    // Optimistic update
    setIsLiked(!wasLiked)
    setDisplayCount((prev) => (wasLiked ? Math.max(0, prev - 1) : prev + 1))
    setIsLoading(true)

    try {
      let result: LikeResult

      if (wasLiked && onUnlike) {
        result = await onUnlike(txid)
      } else if (wasLiked) {
        // No unlike handler, revert optimistic update
        setIsLiked(true)
        setDisplayCount((prev) => prev + 1)
        setIsLoading(false)
        return
      } else {
        result = await onLike(txid)
      }

      if (result.error) {
        // Revert optimistic update
        setIsLiked(wasLiked)
        setDisplayCount((prev) => (wasLiked ? prev + 1 : Math.max(0, prev - 1)))
        onError?.(new Error(result.error))
      } else {
        onToggled?.(!wasLiked, result)
      }
    } catch (err) {
      // Revert optimistic update
      setIsLiked(wasLiked)
      setDisplayCount((prev) => (wasLiked ? prev + 1 : Math.max(0, prev - 1)))
      const error = err instanceof Error ? err : new Error("Failed to toggle like")
      onError?.(error)
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, isLiked, txid, onLike, onUnlike, onToggled, onError])

  return {
    isLiked,
    displayCount,
    isLoading,
    handleToggle,
  }
}
