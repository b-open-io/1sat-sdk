"use client"

import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Loader2, UserMinus, UserPlus } from "lucide-react"

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

export const followButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-all",
  {
    variants: {
      variant: {
        default: "rounded-md px-4 py-2 text-sm shadow-sm",
        compact: "rounded-md px-3 py-1.5 text-xs shadow-sm",
        pill: "rounded-full px-5 py-2 text-sm shadow-sm",
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

export interface FollowButtonUIProps
  extends VariantProps<typeof followButtonVariants> {
  /** Additional CSS classes */
  className?: string
  /** BAP identity key of the user (for aria-label) */
  bapId: string
  /** Whether the current user is following the target */
  following: boolean
  /** Whether the unfollow UI should show (hover state) */
  showUnfollow: boolean
  /** Whether a follow/unfollow action is in progress */
  isLoading: boolean
  /** The current label to display */
  currentLabel: string
  /** Handle the follow/unfollow click */
  onClick: () => void
  /** Handle mouse enter */
  onMouseEnter: () => void
  /** Handle mouse leave */
  onMouseLeave: () => void
  /** Disable the button */
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FollowButtonUI({
  variant = "default",
  className,
  bapId,
  following,
  showUnfollow,
  isLoading,
  currentLabel,
  onClick,
  onMouseEnter,
  onMouseLeave,
  disabled = false,
}: FollowButtonUIProps) {
  return (
    <Button
      variant="ghost"
      size={variant === "compact" ? "sm" : "default"}
      className={cn(
        followButtonVariants({ variant }),
        // Follow state (not following)
        !following &&
          "bg-primary text-primary-foreground hover:bg-primary/90",
        // Following state (no hover)
        following &&
          !showUnfollow &&
          "border border-input bg-background text-foreground hover:bg-accent/50",
        // Unfollow state (hover while following)
        showUnfollow &&
          "border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10",
        className,
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      disabled={disabled || isLoading}
      aria-label={following ? `Unfollow ${bapId}` : `Follow ${bapId}`}
      aria-pressed={following}
    >
      {isLoading ? (
        <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" />
      ) : showUnfollow ? (
        <UserMinus data-icon="inline-start" aria-hidden="true" />
      ) : !following ? (
        <UserPlus data-icon="inline-start" aria-hidden="true" />
      ) : null}
      <span>{currentLabel}</span>
    </Button>
  )
}
