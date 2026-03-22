"use client"

import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  Coins,
  ImageIcon,
  KeyRound,
  Loader2,
  RotateCcw,
  Search,
  Wallet,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type {
  ScanResult,
  SweepResult,
  SweepStep,
} from "./use-sweep-wallet"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SweepWalletUiProps {
  /** Current workflow step */
  step: SweepStep
  /** Current WIF input value */
  wifInput: string
  /** Update the WIF input */
  onWifInputChange: (value: string) => void
  /** Whether the WIF looks valid */
  isWifValid: boolean
  /** Scanned assets */
  scanResult: ScanResult | null
  /** Sweep result */
  sweepResult: SweepResult | null
  /** Error message */
  error: string | null
  /** Whether an async operation is in flight */
  isLoading: boolean
  /** Initiate scan */
  onScan: () => void
  /** Initiate sweep */
  onSweep: () => void
  /** Reset to input step */
  onReset: () => void
  /** Optional CSS class */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SATS_PER_BSV = 100_000_000

function formatSats(sats: number): string {
  if (sats >= SATS_PER_BSV) {
    return `${(sats / SATS_PER_BSV).toFixed(8)} BSV`
  }
  return `${sats.toLocaleString()} sats`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScanningState() {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium">Scanning for assets...</p>
        <p className="text-xs text-muted-foreground">
          Checking funding UTXOs, ordinals, and tokens
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}

function AssetPreview({ scanResult }: { scanResult: ScanResult }) {
  const { funding, ordinals, tokens, totalSats } = scanResult
  const fundingCount = funding.length
  const ordinalCount = ordinals.length
  const tokenCount = tokens.length

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">Found Assets</p>

      {/* Funding */}
      {fundingCount > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm">BSV</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{formatSats(totalSats)}</span>
            <Badge variant="secondary" className="text-xs">
              {fundingCount} UTXO{fundingCount !== 1 ? "s" : ""}
            </Badge>
          </div>
        </div>
      )}

      {/* Ordinals */}
      {ordinalCount > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm">Ordinals</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {ordinalCount} item{ordinalCount !== 1 ? "s" : ""}
          </Badge>
        </div>
      )}

      {/* Tokens */}
      {tokens.map((token) => (
        <div
          key={token.tokenId}
          className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <Coins className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm">{token.symbol ?? "Token"}</span>
          </div>
          <span className="text-sm font-medium font-mono">{token.amount}</span>
        </div>
      ))}

      {fundingCount === 0 && ordinalCount === 0 && tokenCount === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No assets found
        </p>
      )}
    </div>
  )
}

function SweepingState() {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <Loader2 className="size-8 animate-spin text-primary" />
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium">Sweeping assets...</p>
        <p className="text-xs text-muted-foreground">
          Building and broadcasting transactions
        </p>
      </div>
    </div>
  )
}

function SuccessState({
  sweepResult,
  onReset,
}: {
  sweepResult: SweepResult
  onReset: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-3">
        <CheckCircle2 className="mt-0.5 size-4 flex-shrink-0 text-primary" />
        <div className="min-w-0 flex flex-col gap-1">
          <p className="text-sm font-medium">Sweep complete</p>
          {sweepResult.txid && (
            <Badge
              variant="outline"
              className="max-w-full truncate text-xs font-mono"
            >
              {sweepResult.txid}
            </Badge>
          )}
        </div>
      </div>
      <Button variant="outline" className="w-full" onClick={onReset}>
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        Sweep Another Wallet
      </Button>
    </div>
  )
}

function ErrorState({
  error,
  onReset,
}: {
  error: string
  onReset: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
        <AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Sweep failed</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
      <Button variant="outline" className="w-full" onClick={onReset}>
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        Try Again
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main UI
// ---------------------------------------------------------------------------

/**
 * Pure presentation component for the sweep-wallet block.
 *
 * Renders a Card with WIF input, scan/preview, sweep progress, and
 * success/error states. Never imports SDK packages.
 */
export function SweepWalletUi({
  step,
  wifInput,
  onWifInputChange,
  isWifValid,
  scanResult,
  sweepResult,
  error,
  isLoading,
  onScan,
  onSweep,
  onReset,
  className,
}: SweepWalletUiProps) {
  const handlePaste = async () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        const text = await navigator.clipboard.readText()
        onWifInputChange(text.trim())
      } catch {
        // Clipboard permission denied -- user can paste manually
      }
    }
  }

  return (
    <Card className={cn("w-full max-w-md", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" aria-hidden="true" />
          Sweep Wallet
        </CardTitle>
        <CardDescription>
          Import assets from a WIF private key into your connected wallet.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* WIF input -- visible in input & preview steps */}
        {(step === "input" || step === "preview") && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="sweep-wif-input">WIF Private Key</Label>
            <div className="flex items-center gap-2">
              <Input
                id="sweep-wif-input"
                type="password"
                placeholder="5HueCG... or K... or L..."
                value={wifInput}
                onChange={(e) => onWifInputChange(e.target.value)}
                disabled={isLoading || step === "preview"}
                className="flex-1 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
              />
              {step === "input" && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={() => { void handlePaste() }}
                  disabled={isLoading}
                  aria-label="Paste from clipboard"
                >
                  <ClipboardPaste aria-hidden="true" data-icon="inline-start" />
                </Button>
              )}
            </div>
            {wifInput.length > 0 && !isWifValid && (
              <p className="text-xs text-destructive" role="alert">
                Invalid WIF format
              </p>
            )}
          </div>
        )}

        {/* Scanning skeleton */}
        {step === "scanning" && <ScanningState />}

        {/* Asset preview */}
        {step === "preview" && scanResult && (
          <>
            <Separator />
            <AssetPreview scanResult={scanResult} />
          </>
        )}

        {/* Sweeping progress */}
        {step === "sweeping" && <SweepingState />}

        {/* Success */}
        {step === "done" && sweepResult && (
          <SuccessState sweepResult={sweepResult} onReset={onReset} />
        )}

        {/* Error */}
        {step === "error" && error && (
          <ErrorState error={error} onReset={onReset} />
        )}
      </CardContent>

      {/* Footer actions for input & preview steps */}
      {(step === "input" || step === "preview") && (
        <CardFooter>
          {step === "input" && (
            <Button
              className="w-full"
              disabled={!isWifValid || isLoading}
              onClick={onScan}
              aria-busy={isLoading}
            >
              <Search aria-hidden="true" data-icon="inline-start" />
              Scan for Assets
            </Button>
          )}
          {step === "preview" && (
            <div className="flex w-full flex-col gap-2">
              <Button
                className="w-full"
                disabled={isLoading}
                onClick={onSweep}
                aria-busy={isLoading}
              >
                <Wallet aria-hidden="true" data-icon="inline-start" />
                Sweep All
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={onReset}
                disabled={isLoading}
              >
                Cancel
              </Button>
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
