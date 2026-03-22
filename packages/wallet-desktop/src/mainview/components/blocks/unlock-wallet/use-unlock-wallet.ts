import { useCallback, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported platform values */
export type UnlockPlatform = "macos" | "other"

/** Result returned from the onUnlock callback */
export interface UnlockWalletResult {
  /** Whether the unlock was successful */
  success: boolean
  /** Error message on failure */
  error?: string
}

/** Options for the useUnlockWallet hook */
export interface UseUnlockWalletOptions {
  /** Platform determines which unlock methods are available */
  platform?: UnlockPlatform
  /** Application name displayed in the unlock UI */
  appName?: string
  /** Callback to execute the actual unlock */
  onUnlock?: (passphrase?: string) => Promise<UnlockWalletResult>
  /** Called on successful unlock */
  onSuccess?: () => void
  /** Called on error */
  onError?: (error: Error) => void
}

/** Return type of useUnlockWallet hook */
export interface UseUnlockWalletReturn {
  /** Whether an unlock operation is in progress */
  isLoading: boolean
  /** Current error, if any */
  error: Error | null
  /** Whether the wallet has been unlocked */
  isUnlocked: boolean
  /** Number of failed attempts */
  failedAttempts: number
  /** Execute an unlock attempt */
  execute: (passphrase?: string) => Promise<UnlockWalletResult>
  /** Reset error state */
  reset: () => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUnlockWallet({
  onUnlock,
  onSuccess,
  onError,
}: UseUnlockWalletOptions = {}): UseUnlockWalletReturn {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [failedAttempts, setFailedAttempts] = useState(0)

  const execute = useCallback(
    async (passphrase?: string): Promise<UnlockWalletResult> => {
      if (!onUnlock) {
        const err = new Error("onUnlock callback is required")
        setError(err)
        onError?.(err)
        return { success: false, error: err.message }
      }

      setIsLoading(true)
      setError(null)

      try {
        const result = await onUnlock(passphrase)

        if (!result.success) {
          const errMsg = result.error ?? "Unlock failed"
          const err = new Error(errMsg)
          setError(err)
          setFailedAttempts((prev) => prev + 1)
          onError?.(err)
          return result
        }

        setIsUnlocked(true)
        setFailedAttempts(0)
        onSuccess?.()
        return result
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        setFailedAttempts((prev) => prev + 1)
        onError?.(e)
        return { success: false, error: e.message }
      } finally {
        setIsLoading(false)
      }
    },
    [onUnlock, onSuccess, onError],
  )

  const reset = useCallback(() => {
    setError(null)
  }, [])

  return { isLoading, error, isUnlocked, failedAttempts, execute, reset }
}
