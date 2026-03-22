import { forwardRef } from "react"
import { ArrowUpRight, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendBsvTriggerVariant = "default" | "compact" | "quick"

export interface SendBsvTriggerProps {
  /** Trigger style variant */
  variant?: SendBsvTriggerVariant
  /** Additional CSS classes */
  className?: string
  /** Label for the default variant button (default: "Send BSV") */
  label?: string
  /** Whether the trigger is disabled */
  disabled?: boolean
  /** Whether a send operation is in progress */
  loading?: boolean
  /** Click handler to open the dialog */
  onClick?: () => void
  /** For the quick variant: current amount input value */
  quickAmount?: string
  /** For the quick variant: handler when amount changes */
  onQuickAmountChange?: (value: string) => void
  /** For the quick variant: handler when inline send is triggered */
  onQuickSend?: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Trigger button for the Send BSV dialog.
 *
 * Three variants:
 * - **default**: Button with send icon and label
 * - **compact**: Icon-only square button
 * - **quick**: Inline amount input with send button
 */
export const SendBsvTrigger = forwardRef<HTMLButtonElement, SendBsvTriggerProps>(
  function SendBsvTrigger(
    {
      variant = "default",
      className,
      label = "Send BSV",
      disabled = false,
      loading = false,
      onClick,
      quickAmount = "",
      onQuickAmountChange,
      onQuickSend,
    },
    ref,
  ) {
    if (variant === "compact") {
      return (
        <Button
          ref={ref}
          variant="outline"
          size="icon"
          className={cn("size-9", className)}
          disabled={disabled || loading}
          onClick={onClick}
          aria-label={label}
          aria-busy={loading}
        >
          {loading ? (
            <Loader2 className="animate-spin" aria-hidden="true" data-icon="inline-start" />
          ) : (
            <ArrowUpRight aria-hidden="true" data-icon="inline-start" />
          )}
        </Button>
      )
    }

    if (variant === "quick") {
      return (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border bg-background p-1",
            className,
          )}
        >
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="sats"
            value={quickAmount}
            onChange={(e) =>
              onQuickAmountChange?.(e.target.value.replace(/[^0-9]/g, ""))
            }
            disabled={disabled || loading}
            className="h-7 w-24 border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
            aria-label="Amount in satoshis"
          />
          <Button
            ref={ref}
            size="sm"
            className="h-7 gap-1.5 px-3 text-xs"
            disabled={disabled || loading || !quickAmount}
            onClick={onQuickSend ?? onClick}
            aria-busy={loading}
          >
            {loading ? (
              <Loader2
                className="animate-spin"
                aria-hidden="true"
                data-icon="inline-start"
              />
            ) : (
              <Send aria-hidden="true" data-icon="inline-start" />
            )}
            Send
          </Button>
        </div>
      )
    }

    // Default variant
    return (
      <Button
        ref={ref}
        className={cn("gap-2", className)}
        disabled={disabled || loading}
        onClick={onClick}
        aria-busy={loading}
      >
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden="true" data-icon="inline-start" />
        ) : (
          <Send aria-hidden="true" data-icon="inline-start" />
        )}
        {label}
      </Button>
    )
  },
)
