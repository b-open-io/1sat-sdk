import { useCallback, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FollowState = "idle" | "following" | "unfollowing"

export interface FollowResult {
  /** Transaction ID of the follow/unfollow action */
  txid?: string
  /** Raw transaction hex */
  rawtx?: string
  /** Error message if the action failed */
  error?: string
}

export interface UseFollowOptions {
  /** BAP identity key of the user to follow */
  bapId: string
  /** Whether the current user is already following this user */
  isFollowing?: boolean
  /** Called to broadcast a follow action */
  onFollow: (bapId: string) => Promise<FollowResult>
  /** Called to broadcast an unfollow action */
  onUnfollow?: (bapId: string) => Promise<FollowResult>
  /** Called after a successful follow/unfollow */
  onToggled?: (following: boolean, result: FollowResult) => void
  /** Called on error */
  onError?: (error: Error) => void
}

export interface UseFollowReturn {
  /** Whether the current user is following the target */
  following: boolean
  /** Whether the user is hovering over the button */
  isHovering: boolean
  /** Set the hovering state */
  setIsHovering: (hovering: boolean) => void
  /** Current action state */
  actionState: FollowState
  /** Whether a follow/unfollow action is in progress */
  isLoading: boolean
  /** Whether the unfollow UI should show */
  showUnfollow: boolean
  /** The current label to display */
  currentLabel: string
  /** Handle the follow/unfollow click */
  handleClick: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFollow({
  bapId,
  isFollowing: initialFollowing = false,
  onFollow,
  onUnfollow,
  onToggled,
  onError,
  labels = {},
}: UseFollowOptions & {
  labels?: {
    follow?: string
    following?: string
    unfollow?: string
  }
}): UseFollowReturn {
  const [following, setFollowing] = useState(initialFollowing)
  const [isHovering, setIsHovering] = useState(false)
  const [actionState, setActionState] = useState<FollowState>("idle")

  const followLabel = labels.follow ?? "Follow"
  const followingLabel = labels.following ?? "Following"
  const unfollowLabel = labels.unfollow ?? "Unfollow"

  const isLoading = actionState === "following" || actionState === "unfollowing"

  const showUnfollow = following && isHovering && !!onUnfollow

  const currentLabel = isLoading
    ? following
      ? "Unfollowing..."
      : "Following..."
    : showUnfollow
      ? unfollowLabel
      : following
        ? followingLabel
        : followLabel

  const handleClick = useCallback(async () => {
    if (isLoading) return

    const wasFollowing = following

    if (wasFollowing) {
      if (!onUnfollow) return

      setActionState("unfollowing")

      try {
        const result = await onUnfollow(bapId)

        if (result.error) {
          onError?.(new Error(result.error))
        } else {
          setFollowing(false)
          onToggled?.(false, result)
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to unfollow")
        onError?.(error)
      } finally {
        setActionState("idle")
      }
    } else {
      setActionState("following")

      try {
        const result = await onFollow(bapId)

        if (result.error) {
          onError?.(new Error(result.error))
        } else {
          setFollowing(true)
          onToggled?.(true, result)
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to follow")
        onError?.(error)
      } finally {
        setActionState("idle")
      }
    }
  }, [isLoading, following, bapId, onFollow, onUnfollow, onToggled, onError])

  return {
    following,
    isHovering,
    setIsHovering,
    actionState,
    isLoading,
    showUnfollow,
    currentLabel,
    handleClick,
  }
}
