import { useCallback, useEffect, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseReceiveAddressOptions {
  /** The current deposit address to display */
  address: string | null
  /** Callback to rotate to a new address */
  onRotate?: () => Promise<string>
  /** Callback fired after address is copied */
  onCopy?: (address: string) => void
}

export interface UseReceiveAddressReturn {
  /** Whether the address was just copied (2s feedback window) */
  copied: boolean
  /** Whether address rotation is in progress */
  isRotating: boolean
  /** Error from the last rotation attempt */
  rotateError: Error | null
  /** Copy the current address to clipboard */
  copyAddress: () => void
  /** Rotate to a new address via the onRotate callback */
  rotateAddress: () => void
  /** Clear the rotation error */
  resetError: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COPY_FEEDBACK_MS = 2000

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages copy-to-clipboard feedback and address rotation for the
 * receive-address block. Pure logic — no UI or SDK imports.
 *
 * @example
 * ```ts
 * const { copied, isRotating, copyAddress, rotateAddress } =
 *   useReceiveAddress({ address, onRotate, onCopy })
 * ```
 */
export function useReceiveAddress({
  address,
  onRotate,
  onCopy,
}: UseReceiveAddressOptions): UseReceiveAddressReturn {
  const [copied, setCopied] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const [rotateError, setRotateError] = useState<Error | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up copy feedback timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const copyAddress = useCallback(() => {
    if (!address || typeof window === "undefined") return
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      onCopy?.(address)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    })
  }, [address, onCopy])

  const rotateAddress = useCallback(() => {
    if (!onRotate) return
    setIsRotating(true)
    setRotateError(null)
    void onRotate()
      .catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err))
        setRotateError(e)
      })
      .finally(() => {
        setIsRotating(false)
      })
  }, [onRotate])

  const resetError = useCallback(() => setRotateError(null), [])

  return {
    copied,
    isRotating,
    rotateError,
    copyAddress,
    rotateAddress,
    resetError,
  }
}
