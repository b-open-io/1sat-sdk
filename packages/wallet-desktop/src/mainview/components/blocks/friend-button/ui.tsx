"use client"

import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Check, Loader2, UserCheck, UserPlus, UserX, X } from "lucide-react"
import type { FriendshipStatus } from "./use-friend"

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

export const friendButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-all",
  {
    variants: {
      variant: {
        default: "rounded-md px-4 py-2 text-sm shadow-sm",
        compact: "rounded-md px-3 py-1.5 text-xs shadow-sm",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FriendButtonUIProps
  extends VariantProps<typeof friendButtonVariants> {
  /** Additional CSS classes */
  className?: string
  /** Identity key of the other user (for aria-label) */
  identityKey: string
  /** Current friendship status */
  currentStatus: FriendshipStatus
  /** Whether an action is in progress */
  isLoading: boolean
  /** Which action is currently loading */
  loadingAction: string | null
  /** Whether the user is hovering (for friends state) */
  isHovering: boolean
  /** Handle mouse enter */
  onMouseEnter: () => void
  /** Handle mouse leave */
  onMouseLeave: () => void
  /** Handle add friend */
  onAdd: () => void
  /** Handle accept */
  onAccept: () => void
  /** Handle decline */
  onDecline: () => void
  /** Handle remove */
  onRemove: () => void
  /** Whether onAccept is available */
  hasAccept: boolean
  /** Whether onDecline is available */
  hasDecline: boolean
  /** Whether onRemove is available */
  hasRemove: boolean
  /** Disable the button */
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FriendButtonUI({
  variant = "default",
  className,
  identityKey,
  currentStatus,
  isLoading,
  loadingAction,
  isHovering,
  onMouseEnter,
  onMouseLeave,
  onAdd,
  onAccept,
  onDecline,
  onRemove,
  hasAccept,
  hasDecline,
  hasRemove,
  disabled = false,
}: FriendButtonUIProps) {
  const buttonSize = variant === "compact" ? "sm" : "default" as const

  // --- None: "Add Friend" ---
  if (currentStatus === "none") {
    return (
      <Button
        size={buttonSize}
        className={cn(
          friendButtonVariants({ variant }),
          "bg-primary text-primary-foreground hover:bg-primary/90",
          className,
        )}
        onClick={onAdd}
        disabled={disabled || isLoading}
        aria-label={`Send friend request to ${identityKey}`}
        aria-busy={isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" />
            <span>Sending...</span>
          </>
        ) : (
          <>
            <UserPlus data-icon="inline-start" aria-hidden="true" />
            <span>Add Friend</span>
          </>
        )}
      </Button>
    )
  }

  // --- Pending Sent: "Pending" ---
  if (currentStatus === "pending-sent") {
    return (
      <Button
        variant="outline"
        size={buttonSize}
        className={cn(
          friendButtonVariants({ variant }),
          "bg-muted text-muted-foreground cursor-default",
          className,
        )}
        disabled
        aria-label="Friend request pending"
      >
        <Loader2 className="animate-spin opacity-50" data-icon="inline-start" aria-hidden="true" />
        <span>Pending</span>
      </Button>
    )
  }

  // --- Pending Received: "Accept" + "Decline" ---
  if (currentStatus === "pending-received") {
    return (
      <div className="inline-flex items-center gap-2">
        {hasAccept && (
          <Button
            size={buttonSize}
            className={cn("gap-2", className)}
            onClick={onAccept}
            disabled={disabled || isLoading}
            aria-label={`Accept friend request from ${identityKey}`}
            aria-busy={loadingAction === "accept"}
          >
            {loadingAction === "accept" ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" />
                Accepting...
              </>
            ) : (
              <>
                <Check data-icon="inline-start" aria-hidden="true" />
                Accept
              </>
            )}
          </Button>
        )}

        {hasDecline && (
          <Button
            variant="outline"
            size={buttonSize}
            className="gap-2"
            onClick={onDecline}
            disabled={disabled || isLoading}
            aria-label={`Decline friend request from ${identityKey}`}
            aria-busy={loadingAction === "decline"}
          >
            {loadingAction === "decline" ? (
              <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" />
            ) : (
              <X data-icon="inline-start" aria-hidden="true" />
            )}
            Decline
          </Button>
        )}
      </div>
    )
  }

  // --- Friends: show "Friends" badge, with hover to "Remove" ---
  return (
    <Button
      variant="ghost"
      size={buttonSize}
      className={cn(
        friendButtonVariants({ variant }),
        !isHovering &&
          "border border-primary/20 bg-primary/5 text-primary",
        isHovering &&
          hasRemove &&
          "border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10",
        isHovering && !hasRemove && "border border-primary/20 bg-primary/5 text-primary",
        className,
      )}
      onClick={hasRemove ? onRemove : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      disabled={disabled || isLoading || !hasRemove}
      aria-label={
        isHovering && hasRemove
          ? `Remove friend ${identityKey}`
          : `Friends with ${identityKey}`
      }
    >
      {isLoading ? (
        <>
          <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" />
          <span>Removing...</span>
        </>
      ) : isHovering && hasRemove ? (
        <>
          <UserX data-icon="inline-start" aria-hidden="true" />
          <span>Remove</span>
        </>
      ) : (
        <>
          <UserCheck data-icon="inline-start" aria-hidden="true" />
          <span>Friends</span>
        </>
      )}
    </Button>
  )
}
