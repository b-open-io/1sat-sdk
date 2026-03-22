"use client"

import { ReceiveAddressUI } from "./receive-address-ui"
import { useReceiveAddress } from "./use-receive-address"
import type { ReactNode } from "react"
import type { ReceiveAddressVariant } from "./receive-address-ui"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  ReceiveAddressUI,
  type ReceiveAddressUIProps,
  type ReceiveAddressVariant,
} from "./receive-address-ui"
export {
  useReceiveAddress,
  type UseReceiveAddressOptions,
  type UseReceiveAddressReturn,
} from "./use-receive-address"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReceiveAddressProps {
  /** The deposit address to display */
  address: string | null
  /** Callback to rotate to a new address */
  onRotate?: () => Promise<string>
  /** Callback fired after address is copied */
  onCopy?: (address: string) => void
  /** Visual layout variant */
  variant?: ReceiveAddressVariant
  /** QR code pixel dimensions (default 200) */
  qrSize?: number
  /** Custom QR code renderer — receives the address and returns a ReactNode */
  renderQr?: (address: string) => ReactNode
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * Receive address block displaying a QR code and deposit address with copy
 * and optional address rotation.
 *
 * Composes the `useReceiveAddress` hook with the `ReceiveAddressUI`
 * presentation component.
 *
 * @example
 * ```tsx
 * import { ReceiveAddress } from "@/components/blocks/receive-address"
 *
 * function App() {
 *   return (
 *     <ReceiveAddress
 *       address="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
 *       onRotate={async () => {
 *         const newAddr = await generateNewAddress()
 *         return newAddr
 *       }}
 *       onCopy={(addr) => console.log("Copied:", addr)}
 *     />
 *   )
 * }
 * ```
 */
export function ReceiveAddress({
  address,
  onRotate,
  onCopy,
  variant,
  qrSize,
  renderQr,
  className,
}: ReceiveAddressProps) {
  const {
    copied,
    isRotating,
    rotateError,
    copyAddress,
    rotateAddress,
  } = useReceiveAddress({ address, onRotate, onCopy })

  return (
    <ReceiveAddressUI
      address={address}
      variant={variant}
      qrSize={qrSize}
      copied={copied}
      isRotating={isRotating}
      rotateError={rotateError}
      canRotate={!!onRotate}
      renderQr={renderQr}
      onCopy={copyAddress}
      onRotate={rotateAddress}
      className={className}
    />
  )
}
