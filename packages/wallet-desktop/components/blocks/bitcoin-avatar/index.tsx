"use client"

import { cn } from "@/lib/utils"
import { BitcoinAvatarUI } from "./ui"
import {
  useBitcoinAvatar,
  type UseBitcoinAvatarReturn,
  type UseBitcoinAvatarOptions,
} from "./use-bitcoin-avatar"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { BitcoinAvatarUI, type BitcoinAvatarUIProps } from "./ui"
export {
  useBitcoinAvatar,
  type UseBitcoinAvatarReturn,
  type UseBitcoinAvatarOptions,
} from "./use-bitcoin-avatar"

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

export interface BitcoinAvatarProps {
  /** Bitcoin address or BAP ID used as the deterministic seed */
  address: string
  /** On-chain image URL (ord://, b://, bitfs://) to resolve and display */
  imageUrl?: string
  /** Size variant: sm=32, md=40, lg=64, xl=96 */
  size?: "sm" | "md" | "lg" | "xl"
  /** Visual style for the deterministic fallback avatar */
  variant?: AvatarVariant
  /** Optional CSS class name */
  className?: string
}

const SIZE_MAP: Record<"sm" | "md" | "lg" | "xl", number> = {
  sm: 32,
  md: 40,
  lg: 64,
  xl: 96,
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * A hybrid avatar component for Bitcoin addresses.
 *
 * When `imageUrl` is provided (e.g. `ord://txid`), it resolves the on-chain
 * image via `bitcoin-image` and displays it. If resolution fails or no
 * `imageUrl` is given, it renders a deterministic SVG avatar from
 * `sigma-avatars` seeded by the `address` prop.
 */
export function BitcoinAvatar({
  address,
  imageUrl,
  size = "md",
  variant = "marble",
  className,
}: BitcoinAvatarProps) {
  const px = SIZE_MAP[size]
  const hook = useBitcoinAvatar({ address, imageUrl })

  return (
    <BitcoinAvatarUI
      address={address}
      px={px}
      variant={variant}
      className={className}
      showOnChainImage={hook.showOnChainImage}
      resolvedUrl={hook.resolvedUrl}
      onImageError={hook.markResolutionFailed}
    />
  )
}
