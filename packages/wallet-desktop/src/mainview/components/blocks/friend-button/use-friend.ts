import { useCallback, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The friendship state from the current user's perspective:
 * - `none` -- no relationship
 * - `pending-sent` -- current user sent a request (waiting for acceptance)
 * - `pending-received` -- another user sent a request (can accept or decline)
 * - `friends` -- mutual follow established
 */
export type FriendshipStatus =
  | "none"
  | "pending-sent"
  | "pending-received"
  | "friends"

export interface FriendResult {
  /** Transaction ID of the action */
  txid?: string
  /** Derived public key for encrypted messaging (returned on accept) */
  friendPublicKey?: string
  /** Raw transaction hex */
  rawtx?: string
  /** Error message if the action failed */
  error?: string
}

export interface UseFriendOptions {
  /** Identity key of the other user */
  identityKey: string
  /** Current friendship status */
  status: FriendshipStatus
  /** Called to send a friend request (creates a BSocial follow) */
  onAddFriend: (identityKey: string) => Promise<FriendResult>
  /** Called to accept an incoming request (creates a mutual follow + derives shared key) */
  onAccept?: (identityKey: string) => Promise<FriendResult>
  /** Called to decline an incoming request */
  onDecline?: (identityKey: string) => Promise<FriendResult>
  /** Called to remove an existing friend */
  onRemove?: (identityKey: string) => Promise<FriendResult>
  /** Called after any successful action with the new status */
  onStatusChange?: (newStatus: FriendshipStatus, result: FriendResult) => void
  /** Called on error */
  onError?: (error: Error) => void
}

export interface UseFriendReturn {
  /** Current friendship status */
  currentStatus: FriendshipStatus
  /** Whether an action is in progress */
  isLoading: boolean
  /** Which action is currently loading */
  loadingAction: string | null
  /** Whether the user is hovering (for friends state) */
  isHovering: boolean
  /** Set the hovering state */
  setIsHovering: (hovering: boolean) => void
  /** Execute an action (add, accept, decline, remove) */
  executeAction: (
    action: (id: string) => Promise<FriendResult>,
    actionName: string,
    newStatus: FriendshipStatus,
  ) => Promise<void>
  /** Whether onAccept is available */
  hasAccept: boolean
  /** Whether onDecline is available */
  hasDecline: boolean
  /** Whether onRemove is available */
  hasRemove: boolean
  /** Convenience handlers */
  handleAdd: () => void
  handleAccept: () => void
  handleDecline: () => void
  handleRemove: () => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFriend({
  identityKey,
  status,
  onAddFriend,
  onAccept,
  onDecline,
  onRemove,
  onStatusChange,
  onError,
}: UseFriendOptions): UseFriendReturn {
  const [currentStatus, setCurrentStatus] = useState<FriendshipStatus>(status)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [isHovering, setIsHovering] = useState(false)

  const executeAction = useCallback(
    async (
      action: (id: string) => Promise<FriendResult>,
      actionName: string,
      newStatus: FriendshipStatus,
    ) => {
      setIsLoading(true)
      setLoadingAction(actionName)

      try {
        const result = await action(identityKey)

        if (result.error) {
          onError?.(new Error(result.error))
        } else {
          setCurrentStatus(newStatus)
          onStatusChange?.(newStatus, result)
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(`Failed to ${actionName}`)
        onError?.(error)
      } finally {
        setIsLoading(false)
        setLoadingAction(null)
      }
    },
    [identityKey, onStatusChange, onError],
  )

  const handleAdd = useCallback(() => {
    void executeAction(onAddFriend, "add", "pending-sent")
  }, [executeAction, onAddFriend])

  const handleAccept = useCallback(() => {
    if (onAccept) {
      void executeAction(onAccept, "accept", "friends")
    }
  }, [executeAction, onAccept])

  const handleDecline = useCallback(() => {
    if (onDecline) {
      void executeAction(onDecline, "decline", "none")
    }
  }, [executeAction, onDecline])

  const handleRemove = useCallback(() => {
    if (onRemove) {
      void executeAction(onRemove, "remove", "none")
    }
  }, [executeAction, onRemove])

  return {
    currentStatus,
    isLoading,
    loadingAction,
    isHovering,
    setIsHovering,
    executeAction,
    hasAccept: !!onAccept,
    hasDecline: !!onDecline,
    hasRemove: !!onRemove,
    handleAdd,
    handleAccept,
    handleDecline,
    handleRemove,
  }
}
