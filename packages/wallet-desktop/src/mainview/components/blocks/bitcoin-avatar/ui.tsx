"use client"

import Avatar, { shadcnColorPrefixColors } from "sigma-avatars"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported avatar variant styles from sigma-avatars */
type AvatarVariant =
  | "marble"
  | "pixel"
  | "beam"
  | "ring"
  | "sunset"
  | "bauhaus"
  | "fractal"
  | "mage"
  | "barcode"
  | "pepe"

export interface BitcoinAvatarUIProps {
  /** Bitcoin address or BAP ID used as the deterministic seed */
  address: string
  /** Size in pixels */
  px: number
  /** Visual style for the deterministic fallback avatar */
  variant?: AvatarVariant
  /** Optional CSS class name */
  className?: string
  /** Whether to show the resolved on-chain image */
  showOnChainImage: boolean
  /** The resolved HTTP URL for the on-chain image */
  resolvedUrl: string | null
  /** Callback when the on-chain <img> fails to load */
  onImageError: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BitcoinAvatarUI({
  address,
  px,
  variant = "marble",
  className,
  showOnChainImage,
  resolvedUrl,
  onImageError,
}: BitcoinAvatarUIProps) {
  if (showOnChainImage && resolvedUrl) {
    return (
      <img
        src={resolvedUrl}
        alt={`Avatar for ${address.slice(0, 8)}...`}
        width={px}
        height={px}
        className={cn("rounded-full object-cover", className)}
        data-testid="bitcoin-avatar"
        onError={onImageError}
      />
    )
  }

  // Deterministic fallback via sigma-avatars
  return (
    <div
      className={cn("inline-flex shrink-0", className)}
      data-testid="bitcoin-avatar"
    >
      <Avatar
        name={address}
        variant={variant}
        size={px}
        colors={shadcnColorPrefixColors}
        className="rounded-full"
      />
    </div>
  )
}
