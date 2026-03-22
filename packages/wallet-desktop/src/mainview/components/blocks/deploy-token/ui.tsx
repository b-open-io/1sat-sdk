"use client"

import { useCallback, type ChangeEvent } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Rocket,
  Upload,
  X,
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
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployTokenFormState {
  /** Token symbol */
  symbol: string
  /** Maximum supply (whole tokens) */
  maxSupply: string
  /** Decimal precision (0-18) */
  decimals: string
  /** Icon file for inscription */
  iconFile: File | null
  /** Preview URL for the icon */
  iconPreviewUrl: string | null
}

export interface DeployTokenUIProps {
  /** Current form state */
  form: DeployTokenFormState
  /** Callback to update symbol */
  onSymbolChange: (value: string) => void
  /** Callback to update max supply */
  onMaxSupplyChange: (value: string) => void
  /** Callback to update decimals */
  onDecimalsChange: (value: string) => void
  /** Callback to set icon file */
  onIconSelect: (file: File) => void
  /** Callback to remove the icon */
  onIconRemove: () => void
  /** Callback to trigger deploy */
  onDeploy: () => void
  /** Whether a deploy is in progress */
  isDeploying: boolean
  /** Fee estimate in satoshis */
  feeEstimate: number
  /** Deploy result txid */
  resultTxid: string | null
  /** Deploy error message */
  errorMessage: string | null
  /** Whether the form is valid for submission */
  isValid: boolean
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(value: string): string {
  const num = Number(value)
  if (Number.isNaN(num)) return value
  return num.toLocaleString()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Pure presentation component for BSV21 token deployment.
 *
 * Renders the form fields (symbol, icon upload, max supply, decimals),
 * fee estimate, and deploy button. All state management is handled by
 * the parent via props.
 */
export function DeployTokenUI({
  form,
  onSymbolChange,
  onMaxSupplyChange,
  onDecimalsChange,
  onIconSelect,
  onIconRemove,
  onDeploy,
  isDeploying,
  feeEstimate,
  resultTxid,
  errorMessage,
  isValid,
  className,
}: DeployTokenUIProps) {
  const handleIconInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (!file.type.startsWith("image/")) return
      onIconSelect(file)
    },
    [onIconSelect]
  )

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle>Deploy New Token</CardTitle>
        <CardDescription>
          Deploy a BSV21 fungible token. All tokens are minted to your wallet on
          deployment.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* Symbol */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="deploy-token-symbol">Symbol</Label>
            <span className="text-xs text-muted-foreground">
              Not required to be unique
            </span>
          </div>
          <Input
            id="deploy-token-symbol"
            placeholder="e.g. MYTOKEN"
            value={form.symbol}
            maxLength={32}
            onKeyDown={(e) => {
              if (e.key === " ") e.preventDefault()
            }}
            onChange={(e) => onSymbolChange(e.target.value.replace(/\s/g, ""))}
            aria-label="Token symbol"
          />
        </div>

        {/* Icon upload */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Token Icon</Label>
            <span className="text-xs text-muted-foreground">
              Square image recommended
            </span>
          </div>
          <div className="flex items-center gap-4">
            {form.iconPreviewUrl ? (
              <div className="relative size-10 flex-shrink-0 overflow-hidden rounded-lg border bg-muted">
                <img
                  src={form.iconPreviewUrl}
                  alt="Token icon preview"
                  className="h-full w-full object-cover"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute -right-1 -top-1 size-5"
                  onClick={onIconRemove}
                  aria-label="Remove icon"
                >
                  <X data-icon="inline-start" />
                </Button>
              </div>
            ) : (
              <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/50">
                <ImageIcon className="size-5 text-muted-foreground/50" />
              </div>
            )}
            <div className="flex-1">
              <Label
                htmlFor="deploy-token-icon"
                className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors hover:bg-muted/50"
              >
                <Upload className="size-4" />
                {form.iconFile ? "Change Icon" : "Select Image"}
              </Label>
              <input
                type="file"
                id="deploy-token-icon"
                accept="image/*"
                className="sr-only"
                onChange={handleIconInput}
              />
            </div>
          </div>
        </div>

        {/* Max Supply + Decimals row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="deploy-token-supply">Max Supply</Label>
              <span className="text-xs text-muted-foreground">
                Whole tokens
              </span>
            </div>
            <Input
              id="deploy-token-supply"
              type="text"
              inputMode="numeric"
              placeholder="21000000"
              value={form.maxSupply}
              onChange={(e) =>
                onMaxSupplyChange(e.target.value.replace(/[^0-9]/g, ""))
              }
              aria-label="Maximum token supply"
            />
            {form.maxSupply && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(form.maxSupply)} tokens
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="deploy-token-decimals">Decimals</Label>
              <span className="text-xs text-muted-foreground">0-18</span>
            </div>
            <Input
              id="deploy-token-decimals"
              type="number"
              min={0}
              max={18}
              placeholder="8"
              value={form.decimals}
              onChange={(e) => onDecimalsChange(e.target.value)}
              aria-label="Decimal precision"
            />
          </div>
        </div>

        {/* Fee estimate */}
        {isValid && (
          <>
            <Separator />
            <div className="flex items-center justify-between rounded-md border bg-muted/50 px-4 py-3">
              <span className="text-sm text-muted-foreground">
                Estimated deploy fee
              </span>
              <Badge variant="secondary">
                ~{feeEstimate.toLocaleString()} sats
              </Badge>
            </div>
          </>
        )}

        {/* Success */}
        {resultTxid && (
          <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-4">
            <CheckCircle2 className="mt-0.5 size-5 flex-shrink-0 text-primary" />
            <div className="min-w-0 flex flex-col gap-1">
              <p className="text-sm font-medium">Token deployed successfully</p>
              <a
                href={`https://whatsonchain.com/tx/${resultTxid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <Badge variant="outline" className="max-w-full truncate text-xs font-mono">
                  {resultTxid}
                </Badge>
                <ExternalLink className="size-3 flex-shrink-0" />
              </a>
            </div>
          </div>
        )}

        {/* Error */}
        {errorMessage && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-4">
            <AlertCircle className="mt-0.5 size-5 flex-shrink-0 text-destructive" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Deployment failed</p>
              <p className="text-xs text-muted-foreground">{errorMessage}</p>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter>
        <Button
          className="w-full"
          onClick={onDeploy}
          disabled={!isValid || isDeploying}
          aria-busy={isDeploying}
        >
          {isDeploying ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" />
              Deploying...
            </>
          ) : (
            <>
              <Rocket data-icon="inline-start" />
              Deploy Token
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}
