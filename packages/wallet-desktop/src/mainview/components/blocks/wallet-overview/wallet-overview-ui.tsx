"use client"

import { useCallback, useState } from "react"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  AlertCircle,
  Fingerprint,
} from "lucide-react"
import type { WalletBalance } from "./use-wallet-overview"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletOverviewUIProps {
  /** Balance breakdown in satoshis */
  balance: WalletBalance | null
  /** BSV payment address */
  paymentAddress: string | null
  /** Ordinal receiving address */
  ordinalAddress: string | null
  /** Identity public key */
  identityKey: string | null
  /** Whether balance is loading */
  isLoading: boolean
  /** Error from balance fetch */
  error: Error | null
  /** Callback for the Send action button */
  onSend?: () => void
  /** Callback for the Receive action button */
  onReceive?: () => void
  /** Manually refetch the balance */
  onRefresh?: () => void
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format satoshis with locale grouping: 1,234,567 */
function formatSats(sats: number): string {
  return sats.toLocaleString()
}

/** Convert satoshis to BSV string: 0.01234567 */
function satsToBsv(sats: number): string {
  return (sats / 100_000_000).toFixed(8)
}

/** Truncate a string for display: "abc123...xyz9" */
function truncate(value: string, startLen = 8, endLen = 6): string {
  if (value.length <= startLen + endLen + 3) return value
  return `${value.slice(0, startLen)}...${value.slice(-endLen)}`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CopyFieldProps {
  label: string
  value: string
  icon: React.ReactNode
}

function CopyField({ label, value, icon }: CopyFieldProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (typeof window === "undefined") return
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [value])

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-md bg-muted">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-sm text-foreground">
          {truncate(value)}
        </p>
      </div>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 flex-shrink-0"
              onClick={handleCopy}
              aria-label={copied ? "Copied" : `Copy ${label}`}
            >
              {copied ? (
                <Check className="size-3.5 text-primary" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{copied ? "Copied!" : "Copy to clipboard"}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

function BalanceSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-4 w-24" />
    </div>
  )
}

function AddressSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="size-8 rounded-md" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="size-8 rounded-md" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main UI
// ---------------------------------------------------------------------------

/**
 * Pure presentation component for the wallet overview block.
 *
 * Displays BSV balance, payment address, ordinal address, identity key,
 * and action buttons. All data and callbacks are provided via props.
 */
export function WalletOverviewUI({
  balance,
  paymentAddress,
  ordinalAddress,
  identityKey,
  isLoading,
  error,
  onSend,
  onReceive,
  onRefresh,
  className,
}: WalletOverviewUIProps) {
  const [balanceHidden, setBalanceHidden] = useState(false)

  const toggleVisibility = useCallback(() => {
    setBalanceHidden((prev) => !prev)
  }, [])

  // Not connected state
  if (!paymentAddress && !isLoading) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Wallet
              className="size-6 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              Wallet not connected
            </p>
            <p className="text-sm text-muted-foreground">
              Connect a wallet to view your balance
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">Wallet</CardTitle>
        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={toggleVisibility}
                  aria-label={
                    balanceHidden ? "Show balance" : "Hide balance"
                  }
                >
                  {balanceHidden ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{balanceHidden ? "Show balance" : "Hide balance"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {onRefresh && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={onRefresh}
                    disabled={isLoading}
                    aria-label="Refresh balance"
                  >
                    <RefreshCw
                      className={cn(
                        "size-4",
                        isLoading && "animate-spin"
                      )}
                      aria-hidden="true"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Refresh balance</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Balance display */}
        {error ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertCircle
              className="size-4 flex-shrink-0 text-destructive"
              aria-hidden="true"
            />
            <p className="text-sm text-destructive">{error.message}</p>
          </div>
        ) : isLoading && !balance ? (
          <BalanceSkeleton />
        ) : balance ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {balanceHidden
                  ? "\u2022\u2022\u2022\u2022\u2022\u2022"
                  : formatSats(balance.total)}
              </span>
              <span className="text-sm text-muted-foreground">sats</span>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {balanceHidden
                ? "\u2022\u2022\u2022\u2022 BSV"
                : `${satsToBsv(balance.total)} BSV`}
            </span>
            {!balanceHidden && balance.unconfirmed !== 0 && (
              <Badge
                variant="secondary"
                className="mt-1 w-fit text-xs"
              >
                {balance.unconfirmed > 0 ? "+" : ""}
                {formatSats(balance.unconfirmed)} unconfirmed
              </Badge>
            )}
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={onSend}
            disabled={!paymentAddress}
          >
            <ArrowUpRight className="size-4" aria-hidden="true" />
            Send
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={onReceive}
            disabled={!paymentAddress}
          >
            <ArrowDownLeft className="size-4" aria-hidden="true" />
            Receive
          </Button>
        </div>

        <Separator />

        {/* Addresses */}
        <div className="flex flex-col gap-3">
          {isLoading && !paymentAddress ? (
            <>
              <AddressSkeleton />
              <AddressSkeleton />
              <AddressSkeleton />
            </>
          ) : (
            <>
              {paymentAddress && (
                <CopyField
                  label="Payment Address"
                  value={paymentAddress}
                  icon={
                    <Wallet
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  }
                />
              )}
              {ordinalAddress && (
                <CopyField
                  label="Ordinal Address"
                  value={ordinalAddress}
                  icon={
                    <svg
                      className="size-4 text-muted-foreground"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                      <path d="M2 12h20" />
                    </svg>
                  }
                />
              )}
              {identityKey && (
                <CopyField
                  label="Identity Key"
                  value={identityKey}
                  icon={
                    <Fingerprint
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  }
                />
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
