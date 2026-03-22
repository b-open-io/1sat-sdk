"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ArrowDownUp,
  CheckCircle2,
  Loader2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendBsvParams {
  /** Destination BSV address */
  address: string
  /** Amount in satoshis */
  satoshis: number
}

export interface SendBsvResult {
  /** Transaction ID on success */
  txid?: string
  /** Raw transaction hex */
  rawtx?: string
  /** Error message on failure */
  error?: string
}

type AmountUnit = "sats" | "bsv"

export interface SendBsvDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when the open state changes */
  onOpenChange: (open: boolean) => void
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
  /** Dialog size variant */
  size?: "full" | "compact"
  /** Optional CSS class for the dialog content */
  className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SATS_PER_BSV = 100_000_000
const MIN_AMOUNT_SATS = 1
const MAX_AMOUNT_SATS = 2100000000000000
const DEFAULT_FEE_SATS = 50

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function satsToBsvString(sats: number): string {
  return (sats / SATS_PER_BSV).toFixed(8)
}

function bsvStringToSats(bsvStr: string): number {
  const parsed = Number.parseFloat(bsvStr)
  if (Number.isNaN(parsed) || parsed < 0) return 0
  return Math.round(parsed * SATS_PER_BSV)
}

/** Validates a BSV address using base58check character set and length */
const BSV_ADDRESS_RE = /^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/

function isValidBsvAddress(address: string): boolean {
  return BSV_ADDRESS_RE.test(address.trim())
}

function formatSatsDisplay(sats: number): string {
  if (sats >= SATS_PER_BSV) {
    return `${satsToBsvString(sats)} BSV`
  }
  return `${sats.toLocaleString()} sats`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SendBsvDialog({
  open,
  onOpenChange,
  onSend,
  onSuccess,
  onError,
  defaultAddress = "",
  defaultSatoshis,
  estimatedFee = DEFAULT_FEE_SATS,
  size = "full",
  className,
}: SendBsvDialogProps) {
  const [address, setAddress] = useState(defaultAddress)
  const [amountInput, setAmountInput] = useState(
    defaultSatoshis ? String(defaultSatoshis) : "",
  )
  const [unit, setUnit] = useState<AmountUnit>("sats")
  const [isSending, setIsSending] = useState(false)
  const [result, setResult] = useState<SendBsvResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setAddress(defaultAddress)
      setAmountInput(defaultSatoshis ? String(defaultSatoshis) : "")
      setUnit("sats")
      setResult(null)
      setError(null)
    }
  }, [open, defaultAddress, defaultSatoshis])

  // Parse amount to satoshis based on current unit
  const satoshis = useMemo(() => {
    if (!amountInput) return 0
    if (unit === "bsv") {
      return bsvStringToSats(amountInput)
    }
    const parsed = Number.parseInt(amountInput, 10)
    if (Number.isNaN(parsed) || parsed < 0) return 0
    return parsed
  }, [amountInput, unit])

  // Validation
  const validationError = useMemo(() => {
    if (!amountInput && !address) return null
    if (address && address.trim().length > 0 && !isValidBsvAddress(address)) {
      return "Invalid BSV address"
    }
    if (amountInput && satoshis < MIN_AMOUNT_SATS) {
      return "Amount must be at least 1 satoshi"
    }
    if (satoshis > MAX_AMOUNT_SATS) {
      return "Amount exceeds maximum"
    }
    return null
  }, [address, amountInput, satoshis])

  const canSend =
    isValidBsvAddress(address) &&
    satoshis >= MIN_AMOUNT_SATS &&
    satoshis <= MAX_AMOUNT_SATS &&
    !validationError

  const totalSats = satoshis + estimatedFee

  // Toggle between sats and BSV
  const handleToggleUnit = useCallback(() => {
    if (unit === "sats") {
      // Convert current sats input to BSV
      const currentSats = Number.parseInt(amountInput, 10)
      if (!Number.isNaN(currentSats) && currentSats > 0) {
        setAmountInput(satsToBsvString(currentSats))
      } else {
        setAmountInput("")
      }
      setUnit("bsv")
    } else {
      // Convert current BSV input to sats
      const currentSats = bsvStringToSats(amountInput)
      if (currentSats > 0) {
        setAmountInput(String(currentSats))
      } else {
        setAmountInput("")
      }
      setUnit("sats")
    }
  }, [unit, amountInput])

  const handleAmountChange = useCallback(
    (value: string) => {
      if (unit === "sats") {
        setAmountInput(value.replace(/[^0-9]/g, ""))
      } else {
        // Allow digits and a single decimal point for BSV input
        setAmountInput(value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))
      }
    },
    [unit],
  )

  const handleSend = useCallback(async () => {
    if (!canSend) return

    setIsSending(true)
    setError(null)
    setResult(null)

    try {
      const sendResult = await onSend({
        address: address.trim(),
        satoshis,
      })

      if (sendResult.error) {
        setError(sendResult.error)
        onError?.(new Error(sendResult.error))
      } else {
        setResult(sendResult)
        onSuccess?.(sendResult)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send BSV"
      setError(msg)
      onError?.(err instanceof Error ? err : new Error(msg))
    } finally {
      setIsSending(false)
    }
  }, [canSend, address, satoshis, onSend, onSuccess, onError])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isSending) {
        onOpenChange(nextOpen)
      }
    },
    [isSending, onOpenChange],
  )

  const isCompact = size === "compact"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          isCompact ? "sm:max-w-sm" : "sm:max-w-md",
          className,
        )}
      >
        <DialogHeader className={cn(isCompact && "pb-0")}>
          <DialogTitle className={cn(isCompact && "text-base")}>
            Send BSV
          </DialogTitle>
          {!isCompact && (
            <DialogDescription>
              Send Bitcoin SV to any address. Double-check the address and amount
              before confirming.
            </DialogDescription>
          )}
        </DialogHeader>

        <div
          className={cn(
            "flex flex-col gap-4",
            isCompact ? "py-2" : "py-4",
          )}
        >
          {/* Address input */}
          <div className={cn("flex flex-col gap-2", isCompact && "gap-1.5")}>
            <Label
              htmlFor="send-bsv-address"
              className={cn(isCompact && "text-xs")}
            >
              Destination Address
            </Label>
            <Input
              id="send-bsv-address"
              type="text"
              placeholder="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={isSending || !!result?.txid}
              className={cn(
                "font-mono text-sm",
                isCompact && "h-8 text-xs",
              )}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {/* Amount input with unit toggle */}
          <div className={cn("flex flex-col gap-2", isCompact && "gap-1.5")}>
            <Label
              htmlFor="send-bsv-amount"
              className={cn(isCompact && "text-xs")}
            >
              Amount
            </Label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  id="send-bsv-amount"
                  type="text"
                  inputMode={unit === "sats" ? "numeric" : "decimal"}
                  pattern={unit === "sats" ? "[0-9]*" : "[0-9.]*"}
                  placeholder={unit === "sats" ? "100000" : "0.00100000"}
                  value={amountInput}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  disabled={isSending || !!result?.txid}
                  className={cn(
                    "pr-14",
                    isCompact && "h-8 text-xs",
                  )}
                  aria-describedby="send-bsv-amount-display"
                />
                <span
                  className={cn(
                    "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground",
                  )}
                >
                  {unit === "sats" ? "sats" : "BSV"}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn("flex-shrink-0", isCompact && "size-8")}
                onClick={handleToggleUnit}
                disabled={isSending || !!result?.txid}
                aria-label={`Switch to ${unit === "sats" ? "BSV" : "satoshis"}`}
              >
                <ArrowDownUp
                  aria-hidden="true"
                  data-icon="inline-start"
                />
              </Button>
            </div>
            {satoshis > 0 && (
              <p
                id="send-bsv-amount-display"
                className="text-xs text-muted-foreground"
              >
                {unit === "sats"
                  ? `${satsToBsvString(satoshis)} BSV`
                  : `${satoshis.toLocaleString()} sats`}
              </p>
            )}
          </div>

          {/* Fee line */}
          {satoshis > 0 && !result?.txid && (
            <>
            <Separator />
            <div
              className={cn(
                "flex items-center justify-between rounded-md border bg-muted/50 px-4 py-3",
                isCompact && "px-3 py-2",
              )}
            >
              <div className="flex flex-col gap-0.5">
                <p
                  className={cn(
                    "text-sm text-muted-foreground",
                    isCompact && "text-xs",
                  )}
                >
                  Network fee
                </p>
                <p
                  className={cn(
                    "text-sm font-medium",
                    isCompact && "text-xs",
                  )}
                >
                  Total: {formatSatsDisplay(totalSats)}
                </p>
              </div>
              <span
                className={cn(
                  "text-sm text-muted-foreground",
                  isCompact && "text-xs",
                )}
              >
                ~{estimatedFee} sats
              </span>
            </div>
            </>
          )}

          {/* Validation error */}
          {validationError && (
            <p
              className={cn(
                "text-sm text-destructive",
                isCompact && "text-xs",
              )}
              role="alert"
            >
              {validationError}
            </p>
          )}

          {/* Success */}
          {result?.txid && (
            <div
              className={cn(
                "flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-3",
                isCompact && "gap-2 p-2",
              )}
            >
              <CheckCircle2
                className={cn(
                  "mt-0.5 size-4 flex-shrink-0 text-primary",
                  isCompact && "size-3.5",
                )}
              />
              <div className="min-w-0 flex flex-col gap-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    isCompact && "text-xs",
                  )}
                >
                  Sent successfully
                </p>
                <Badge variant="outline" className="max-w-full truncate text-xs font-mono">
                  {result.txid}
                </Badge>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className={cn(
                "flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3",
                isCompact && "gap-2 p-2",
              )}
            >
              <AlertCircle
                className={cn(
                  "mt-0.5 size-4 flex-shrink-0 text-destructive",
                  isCompact && "size-3.5",
                )}
              />
              <div className="flex flex-col gap-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    isCompact && "text-xs",
                  )}
                >
                  Send failed
                </p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            className="w-full"
            onClick={handleSend}
            disabled={!canSend || isSending || !!result?.txid}
            aria-busy={isSending}
          >
            {isSending ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Sending...
              </>
            ) : result?.txid ? (
              "Sent"
            ) : (
              `Confirm & Send${satoshis > 0 ? ` ${formatSatsDisplay(satoshis)}` : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
