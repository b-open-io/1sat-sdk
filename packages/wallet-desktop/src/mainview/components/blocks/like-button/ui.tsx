"use client"

import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Heart, Loader2, ThumbsUp } from "lucide-react"

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

export const likeButtonVariants = cva(
  "inline-flex items-center gap-1.5 font-medium transition-all select-none",
  {
    variants: {
      variant: {
        default:
          "rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm hover:bg-accent hover:text-accent-foreground",
        compact:
          "rounded-full border border-input bg-background size-8 justify-center text-sm shadow-sm hover:bg-accent hover:text-accent-foreground p-0",
        text: "text-sm text-muted-foreground hover:text-foreground bg-transparent px-1 py-0.5",
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

export interface LikeButtonUIProps
  extends VariantProps<typeof likeButtonVariants> {
  /** Additional CSS classes */
  className?: string
  /** Whether the content is currently liked */
  isLiked: boolean
  /** Current display count */
  displayCount: number
  /** Whether a like/unlike action is in progress */
  isLoading: boolean
  /** Toggle the like state */
  onToggle: () => void
  /** Disable the button */
  disabled?: boolean
  /** Use thumbs-up icon instead of heart */
  useThumbsUp?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LikeButtonUI({
  variant = "default",
  className,
  isLiked,
  displayCount,
  isLoading,
  onToggle,
  disabled = false,
  useThumbsUp = false,
}: LikeButtonUIProps) {
  const isCompact = variant === "compact"
  const IconComponent = useThumbsUp ? ThumbsUp : Heart

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        likeButtonVariants({ variant }),
        isLiked && "text-primary border-primary/30 bg-primary/5",
        isLiked && variant === "text" && "bg-transparent text-primary",
        className,
      )}
      onClick={onToggle}
      disabled={disabled || isLoading}
      aria-label={isLiked ? "Unlike" : "Like"}
      aria-pressed={isLiked}
    >
      {isLoading ? (
        <Loader2
          className={cn("animate-spin", isLiked && "fill-current")}
          data-icon="inline-start"
          aria-hidden="true"
        />
      ) : (
        <IconComponent
          className={cn(
            "transition-transform",
            isLiked && "fill-current scale-110",
            !isLiked && "hover:scale-110",
          )}
          data-icon="inline-start"
          aria-hidden="true"
        />
      )}
      {!isCompact && displayCount > 0 && (
        <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-xs tabular-nums">
          {displayCount}
        </Badge>
      )}
    </Button>
  )
}
