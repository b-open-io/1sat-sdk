"use client"

import { cva, type VariantProps } from "class-variance-authority"
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Tag,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { OrdinalItem, ListOrdinalResult } from "./use-create-listing"

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

export const createListingTriggerVariants = cva(
  "inline-flex items-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "rounded-md border border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground px-4 py-2 text-sm",
        primary:
          "rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90 px-4 py-2 text-sm",
        ghost:
          "rounded-md text-foreground hover:bg-accent hover:text-accent-foreground px-4 py-2 text-sm",
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

export interface CreateListingUIProps
  extends VariantProps<typeof createListingTriggerVariants> {
  /** Optional CSS class name */
  className?: string
  /** Text for the trigger button */
  triggerLabel?: string
  /** The ordinal to list for sale */
  ordinal: OrdinalItem
  /** Whether the dialog is open */
  open: boolean
  /** Handle dialog open/close */
  onOpenChange: (nextOpen: boolean) => void
  /** Current price input string */
  priceInput: string
  /** Set the price input */
  onPriceInputChange: (value: string) => void
  /** Current payout address */
  payAddress: string
  /** Set the payout address */
  onPayAddressChange: (value: string) => void
  /** Whether a listing is in progress */
  isListing: boolean
  /** Listing result */
  result: ListOrdinalResult | null
  /** Error message */
  error: string | null
  /** Parsed price in satoshis */
  priceSats: number
  /** Validation error message */
  validationError: string | null
  /** Whether the form can be submitted */
  canSubmit: boolean
  /** Execute the listing */
  onList: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORDFS_CONTENT_URL = "https://ordfs.network/content"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function satsToBsv(sats: number): string {
  return (sats / 100000000).toFixed(8)
}

function formatSats(sats: number): string {
  if (sats >= 100000000) {
    return `${satsToBsv(sats)} BSV`
  }
  return `${sats.toLocaleString()} sats`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateListingUI({
  ordinal,
  triggerLabel = "List for Sale",
  variant = "default",
  className,
  open,
  onOpenChange,
  priceInput,
  onPriceInputChange,
  payAddress,
  onPayAddressChange,
  isListing,
  result,
  error,
  priceSats,
  validationError,
  canSubmit,
  onList,
}: CreateListingUIProps) {
  const thumbnailUrl = `${ORDFS_CONTENT_URL}/${ordinal.origin ?? ordinal.outpoint}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(createListingTriggerVariants({ variant }), className)}
        >
          <Tag className="size-4" />
          {triggerLabel}
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>List Ordinal for Sale</DialogTitle>
          <DialogDescription>
            Set a price and payout address to list this ordinal on the global
            orderbook.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4">
          {/* Ordinal preview */}
          <Card className="bg-muted/50">
            <CardContent className="flex items-center gap-4 p-3">
              <div className="size-16 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
                <img
                  src={thumbnailUrl}
                  alt={ordinal.name ?? "Ordinal"}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {ordinal.name ?? "Unnamed Ordinal"}
                </p>
                <p className="truncate text-xs text-muted-foreground font-mono">
                  {ordinal.outpoint}
                </p>
                {ordinal.contentType && (
                  <Badge variant="outline" className="mt-1 text-xs">
                    {ordinal.contentType}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Price input */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="listing-price">Price (satoshis)</Label>
            <Input
              id="listing-price"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 100000"
              value={priceInput}
              onChange={(e) =>
                onPriceInputChange(e.target.value.replace(/[^0-9]/g, ""))
              }
              disabled={isListing}
              aria-describedby="price-display"
            />
            {priceSats > 0 && (
              <Badge
                variant="secondary"
                id="price-display"
                className="w-fit text-xs"
              >
                {formatSats(priceSats)}
              </Badge>
            )}
          </div>

          {/* Payout address */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="listing-pay-address">Payout Address</Label>
            <Input
              id="listing-pay-address"
              type="text"
              placeholder="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
              value={payAddress}
              onChange={(e) => onPayAddressChange(e.target.value)}
              disabled={isListing}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              BSV address that will receive payment when this ordinal is
              purchased.
            </p>
          </div>

          {/* Validation error */}
          {validationError && (
            <p className="text-sm text-destructive" role="alert">
              {validationError}
            </p>
          )}

          {/* Success */}
          {result?.txid && (
            <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-3">
              <CheckCircle2 className="mt-0.5 size-4 flex-shrink-0 text-primary" />
              <div className="min-w-0 flex flex-col gap-1">
                <p className="text-sm font-medium">Listed successfully</p>
                <a
                  href={`https://whatsonchain.com/tx/${result.txid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                >
                  <Badge variant="outline" className="max-w-full truncate text-xs font-mono">
                    {result.txid}
                  </Badge>
                  <ExternalLink className="size-3 flex-shrink-0" />
                </a>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
              <AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Listing failed</p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            className="w-full"
            onClick={onList}
            disabled={!canSubmit || isListing}
            aria-busy={isListing}
          >
            {isListing ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Creating Listing...
              </>
            ) : (
              `List for ${priceSats > 0 ? formatSats(priceSats) : "..."}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
