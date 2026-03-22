"use client"

import { useCallback } from "react"
import { Coins, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import type { TokenHolding, TokenType } from "./use-token-list"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenListUIProps {
  /** Token holdings to display */
  tokens: TokenHolding[]
  /** Whether the list is loading */
  isLoading: boolean
  /** Error from the last fetch attempt */
  error: Error | null
  /** Callback when a token row is selected */
  onSelect?: (token: TokenHolding) => void
  /** Callback when an external link action is triggered (e.g. view on explorer). Receives the URL string. */
  onExternalLink?: (url: string) => void
  /** Number of skeleton rows to show while loading (default: 3) */
  skeletonCount?: number
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a raw token amount with the given decimal precision.
 *
 * For example, amount "1500000" with decimals 4 becomes "150.0000".
 */
function formatTokenAmount(amount: string, decimals: number): string {
  if (decimals === 0) {
    return BigInt(amount).toLocaleString()
  }

  const raw = amount.padStart(decimals + 1, "0")
  const intPart = raw.slice(0, -decimals) || "0"
  const decPart = raw.slice(-decimals)

  // Format integer part with locale grouping
  const formattedInt = BigInt(intPart).toLocaleString()

  // Trim trailing zeros from decimal part, keep at least 2 digits
  const trimmed = decPart.replace(/0+$/, "")
  const displayDec = trimmed.length < 2 ? decPart.slice(0, 2) : trimmed

  return `${formattedInt}.${displayDec}`
}

/** Badge variant based on token type */
function typeBadgeVariant(
  type: TokenType
): "default" | "secondary" | "outline" {
  return type === "BSV21" ? "default" : "secondary"
}

/** Truncate a token ID for display */
function truncateId(id: string, maxLen = 16): string {
  if (id.length <= maxLen) return id
  return `${id.slice(0, 8)}...${id.slice(-6)}`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TokenRowProps {
  token: TokenHolding
  onSelect?: (token: TokenHolding) => void
  onExternalLink?: (url: string) => void
  isLast: boolean
}

function TokenRow({ token, onSelect, onExternalLink, isLast }: TokenRowProps) {
  const handleClick = useCallback(() => {
    onSelect?.(token)
  }, [onSelect, token])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onSelect?.(token)
      }
    },
    [onSelect, token]
  )

  const handleExternalLink = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const url = `https://whatsonchain.com/tx/${token.tokenId.split("_")[0]}`
      onExternalLink?.(url)
    },
    [onExternalLink, token.tokenId]
  )

  const isInteractive = !!onSelect

  return (
    <>
      <div
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        className={cn(
          "flex items-center gap-4 px-4 py-3",
          isInteractive &&
            "cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
        )}
        onClick={isInteractive ? handleClick : undefined}
        onKeyDown={isInteractive ? handleKeyDown : undefined}
        aria-label={
          isInteractive
            ? `Select ${token.symbol} token, balance ${formatTokenAmount(token.balance, token.decimals)}`
            : undefined
        }
      >
        {/* Token icon */}
        <Avatar className="size-10 flex-shrink-0">
          {token.iconUrl && (
            <AvatarImage
              src={token.iconUrl}
              alt={`${token.symbol} icon`}
            />
          )}
          <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
            {token.symbol.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        {/* Symbol + balance */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground truncate">
              {token.symbol}
            </span>
            <Badge
              variant={typeBadgeVariant(token.type)}
              className="text-[10px] px-1.5 py-0 h-5"
            >
              {token.type}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {formatTokenAmount(token.balance, token.decimals)}
          </p>
        </div>

        {/* Token ID + external link */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px] hidden sm:block">
            {truncateId(token.tokenId)}
          </span>
          {onExternalLink && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 flex-shrink-0"
              onClick={handleExternalLink}
              aria-label={`View ${token.symbol} on explorer`}
            >
              <ExternalLink data-icon className="size-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>
      {!isLast && <Separator />}
    </>
  )
}

function SkeletonRow({ isLast }: { isLast: boolean }) {
  return (
    <>
      <div className="flex items-center gap-4 px-4 py-3">
        <Skeleton className="size-10 rounded-full flex-shrink-0" />
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <Skeleton className="h-3.5 w-28" />
        </div>
        <Skeleton className="h-3 w-24 hidden sm:block" />
      </div>
      {!isLast && <Separator />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main UI
// ---------------------------------------------------------------------------

/**
 * Pure presentation component for a list of fungible token holdings.
 *
 * Renders loading skeletons, an empty state, an error state, or the
 * token list rows. All data and callbacks are provided via props.
 */
export function TokenListUI({
  tokens,
  isLoading,
  error,
  onSelect,
  onExternalLink,
  skeletonCount = 3,
  className,
}: TokenListUIProps) {
  // Loading state
  if (isLoading && tokens.length === 0) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="p-0">
          {Array.from({ length: skeletonCount }, (_, i) => (
            <SkeletonRow
              key={`skeleton-${i}`}
              isLast={i === skeletonCount - 1}
            />
          ))}
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (error) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="flex flex-col items-center gap-2 py-10">
          <Coins
            className="size-10 text-destructive/60"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-destructive">
            Failed to load tokens
          </p>
          <p className="text-xs text-muted-foreground">{error.message}</p>
        </CardContent>
      </Card>
    )
  }

  // Empty state
  if (tokens.length === 0) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="flex flex-col items-center gap-2 py-10">
          <Coins
            className="size-10 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">No tokens found</p>
        </CardContent>
      </Card>
    )
  }

  // Token list
  return (
    <Card className={cn("w-full overflow-hidden", className)}>
      <CardContent className="p-0">
        {tokens.map((token, index) => (
          <TokenRow
            key={token.tokenId}
            token={token}
            onSelect={onSelect}
            onExternalLink={onExternalLink}
            isLast={index === tokens.length - 1}
          />
        ))}
      </CardContent>
    </Card>
  )
}
