"use client"

import { useCallback, useState } from "react"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Lock,
  Unlock,
  Clock,
  AlertCircle,
  Check,
  Loader2,
  Blocks,
} from "lucide-react"
import type { LockData, LockParams, LockOperationResult } from "./use-lock-bsv"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the LockBsvUi presentation component */
export interface LockBsvUiProps {
  /** Current lock summary data */
  lockData: LockData
  /** Whether a lock operation is in progress */
  isLocking: boolean
  /** Whether an unlock operation is in progress */
  isUnlocking: boolean
  /** Last operation error */
  error: Error | null
  /** Last successful result */
  lastResult: LockOperationResult | null
  /** Callback to execute a lock */
  onLock: (params: LockParams) => Promise<void>
  /** Callback to execute an unlock */
  onUnlock: () => Promise<void>
  /** Callback to clear error / result */
  onReset?: () => void
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSatoshis(sats: number): string {
  if (sats >= 100000000) {
    return `${(sats / 100000000).toFixed(8)} BSV`
  }
  return `${sats.toLocaleString()} sats`
}

function formatBlockHeight(height: number): string {
  return height.toLocaleString()
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LockSummary({
  lockData,
  isLoading,
}: {
  lockData: LockData
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Total Locked</span>
        <span className="text-sm font-semibold tabular-nums">
          {formatSatoshis(lockData.totalLocked)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Unlockable</span>
        <span className="text-sm font-semibold tabular-nums">
          {lockData.unlockable > 0 ? (
            <span className="text-primary">
              {formatSatoshis(lockData.unlockable)}
            </span>
          ) : (
            formatSatoshis(0)
          )}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Next Unlock</span>
        <span className="text-sm font-semibold tabular-nums">
          {lockData.nextUnlock > 0 ? (
            <span className="flex items-center gap-1">
              <Blocks data-icon className="size-3 text-muted-foreground" />
              {formatBlockHeight(lockData.nextUnlock)}
            </span>
          ) : (
            <span className="text-muted-foreground">&mdash;</span>
          )}
        </span>
      </div>
    </div>
  )
}

function LockForm({
  isLocking,
  onLock,
}: {
  isLocking: boolean
  onLock: (params: LockParams) => Promise<void>
}) {
  const [satoshis, setSatoshis] = useState("")
  const [blockHeight, setBlockHeight] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setValidationError(null)

      const sats = Number.parseInt(satoshis, 10)
      if (Number.isNaN(sats) || sats <= 0) {
        setValidationError("Amount must be a positive number of satoshis")
        return
      }

      const until = Number.parseInt(blockHeight, 10)
      if (Number.isNaN(until) || until <= 0) {
        setValidationError("Block height must be a positive integer")
        return
      }

      await onLock({ satoshis: sats, until })
      setSatoshis("")
      setBlockHeight("")
    },
    [satoshis, blockHeight, onLock]
  )

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="lock-satoshis">Amount (sats)</Label>
          <Input
            id="lock-satoshis"
            type="number"
            min={1}
            placeholder="10000"
            value={satoshis}
            onChange={(e) => setSatoshis(e.target.value)}
            disabled={isLocking}
            aria-describedby={
              validationError ? "lock-validation-error" : undefined
            }
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="lock-block-height">Lock Until (block height)</Label>
          <Input
            id="lock-block-height"
            type="number"
            min={1}
            placeholder="890000"
            value={blockHeight}
            onChange={(e) => setBlockHeight(e.target.value)}
            disabled={isLocking}
            aria-describedby={
              validationError ? "lock-validation-error" : undefined
            }
          />
        </div>
      </div>

      {validationError && (
        <p
          id="lock-validation-error"
          className="flex items-center gap-1.5 text-sm text-destructive"
        >
          <AlertCircle data-icon className="size-3.5" />
          {validationError}
        </p>
      )}

      <Button
        type="submit"
        disabled={isLocking || !satoshis || !blockHeight}
        className="w-full"
      >
        {isLocking ? (
          <>
            <Loader2 data-icon className="animate-spin" />
            Locking...
          </>
        ) : (
          <>
            <Lock data-icon />
            Lock BSV
          </>
        )}
      </Button>
    </form>
  )
}

function UnlockSection({
  unlockable,
  isUnlocking,
  onUnlock,
}: {
  unlockable: number
  isUnlocking: boolean
  onUnlock: () => Promise<void>
}) {
  if (unlockable <= 0) return null

  return (
    <>
      <Separator />
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Ready to Unlock</span>
          <span className="text-xs text-muted-foreground">
            {formatSatoshis(unlockable)} available
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isUnlocking}
          onClick={onUnlock}
        >
          {isUnlocking ? (
            <>
              <Loader2 data-icon className="animate-spin" />
              Unlocking...
            </>
          ) : (
            <>
              <Unlock data-icon />
              Unlock
            </>
          )}
        </Button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main UI
// ---------------------------------------------------------------------------

/**
 * Pure presentation for the Lock BSV block.
 *
 * Receives lock state and callbacks from the `useLockBsv` hook.
 * Never imports SDK packages directly.
 */
export function LockBsvUi({
  lockData,
  isLocking,
  isUnlocking,
  error,
  lastResult,
  onLock,
  onUnlock,
  onReset,
  className,
}: LockBsvUiProps) {
  return (
    <Card className={cn("w-full max-w-md", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock data-icon className="size-5 text-muted-foreground" />
            Lock BSV
          </CardTitle>
          {lockData.totalLocked > 0 && (
            <Badge variant="secondary">
              {formatSatoshis(lockData.totalLocked)} locked
            </Badge>
          )}
        </div>
        <CardDescription>
          Time-lock satoshis until a future block height
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <LockSummary lockData={lockData} isLoading={false} />
        <Separator />
        <LockForm isLocking={isLocking} onLock={onLock} />
        <UnlockSection
          unlockable={lockData.unlockable}
          isUnlocking={isUnlocking}
          onUnlock={onUnlock}
        />
      </CardContent>

      {(error || lastResult?.txid) && (
        <CardFooter className="flex flex-col gap-2">
          {error && (
            <div className="flex w-full items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
              <AlertCircle
                data-icon
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-destructive">
                  {error.message}
                </span>
                {onReset && (
                  <button
                    type="button"
                    onClick={onReset}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          )}

          {lastResult?.txid && !error && (
            <div className="flex w-full items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <Check
                data-icon
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  Transaction confirmed
                </span>
                <span className="break-all font-mono text-xs text-muted-foreground">
                  {lastResult.txid}
                </span>
              </div>
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
