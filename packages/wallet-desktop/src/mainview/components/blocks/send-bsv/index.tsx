"use client"

import { useCallback, useState } from "react"
import {
  SendBsvTrigger,
  type SendBsvTriggerProps,
  type SendBsvTriggerVariant,
} from "./send-bsv-trigger"
import {
  SendBsvDialog,
  type SendBsvDialogProps,
  type SendBsvParams,
  type SendBsvResult,
} from "./send-bsv-dialog"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  SendBsvTrigger,
  type SendBsvTriggerProps,
  type SendBsvTriggerVariant,
} from "./send-bsv-trigger"
export {
  SendBsvDialog,
  type SendBsvDialogProps,
  type SendBsvParams,
  type SendBsvResult,
} from "./send-bsv-dialog"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendBsvProps {
  /** Trigger variant */
  variant?: SendBsvTriggerVariant
  /** Dialog size variant */
  dialogSize?: "full" | "compact"
  /** Callback to execute the send action */
  onSend: (params: SendBsvParams) => Promise<SendBsvResult>
  /** Callback on successful send */
  onSuccess?: (result: SendBsvResult) => void
  /** Callback on error */
  onError?: (error: Error) => void
  /** Pre-filled destination address */
  defaultAddress?: string
  /** Pre-filled amount in satoshis */
  defaultSatoshis?: number
  /** Estimated fee in satoshis (default: 50) */
  estimatedFee?: number
  /** Label for the trigger button */
  triggerLabel?: string
  /** Whether the trigger is disabled */
  disabled?: boolean
  /** Optional CSS class for the trigger */
  className?: string
  /** Optional CSS class for the dialog content */
  dialogClassName?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Full Send BSV block: a trigger button that opens a send dialog.
 *
 * Wraps `SendBsvTrigger` and `SendBsvDialog` into one component.
 * The `onSend` callback receives `{ address, satoshis }` and should
 * call `@1sat/actions` `sendBsv.execute(ctx, { requests: [{ address, satoshis }] })`.
 *
 * @example
 * ```tsx
 * import { SendBsv } from "@/components/blocks/send-bsv"
 *
 * <SendBsv
 *   onSend={async ({ address, satoshis }) => {
 *     const result = await sendBsv.execute(ctx, {
 *       requests: [{ address, satoshis }],
 *     })
 *     return result
 *   }}
 * />
 * ```
 */
export function SendBsv({
  variant = "default",
  dialogSize = "full",
  onSend,
  onSuccess,
  onError,
  defaultAddress = "",
  defaultSatoshis,
  estimatedFee,
  triggerLabel,
  disabled = false,
  className,
  dialogClassName,
}: SendBsvProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)

  // Quick-send state for the "quick" variant
  const [quickAmount, setQuickAmount] = useState("")

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true)
  }, [])

  const wrappedOnSend = useCallback(
    async (params: SendBsvParams): Promise<SendBsvResult> => {
      setIsSending(true)
      try {
        const result = await onSend(params)
        return result
      } finally {
        setIsSending(false)
      }
    },
    [onSend],
  )

  const handleQuickSend = useCallback(() => {
    const sats = Number.parseInt(quickAmount, 10)
    if (Number.isNaN(sats) || sats <= 0) return
    // Open dialog with the quick amount pre-filled
    setDialogOpen(true)
  }, [quickAmount])

  const quickSatoshis =
    variant === "quick" && quickAmount
      ? Number.parseInt(quickAmount, 10) || undefined
      : defaultSatoshis

  return (
    <>
      <SendBsvTrigger
        variant={variant}
        className={className}
        label={triggerLabel}
        disabled={disabled}
        loading={isSending}
        onClick={handleOpenDialog}
        quickAmount={quickAmount}
        onQuickAmountChange={setQuickAmount}
        onQuickSend={handleQuickSend}
      />

      <SendBsvDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSend={wrappedOnSend}
        onSuccess={onSuccess}
        onError={onError}
        defaultAddress={defaultAddress}
        defaultSatoshis={quickSatoshis}
        estimatedFee={estimatedFee}
        size={dialogSize}
        className={dialogClassName}
      />
    </>
  )
}
