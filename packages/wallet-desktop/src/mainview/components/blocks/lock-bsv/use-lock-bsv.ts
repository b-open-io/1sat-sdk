import { useCallback, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summary of a user's time-locked BSV */
export interface LockData {
  /** Total satoshis currently locked */
  totalLocked: number
  /** Satoshis available to unlock (matured locks) */
  unlockable: number
  /** Block height of the next lock expiry (0 = no pending locks) */
  nextUnlock: number
}

/** Parameters for a lock operation */
export interface LockParams {
  /** Amount in satoshis to lock */
  satoshis: number
  /** Block height until which to lock */
  until: number
}

/** Result from a lock or unlock operation */
export interface LockOperationResult {
  /** Transaction ID on success */
  txid?: string
  /** Error message on failure */
  error?: string
}

/** Options passed to the useLockBsv hook */
export interface UseLockBsvOptions {
  /** Pre-populated lock data (skips initial fetch) */
  lockData?: LockData
  /** Callback invoked when a lock or unlock succeeds */
  onSuccess?: (result: LockOperationResult) => void
  /** Callback invoked when a lock or unlock fails */
  onError?: (error: Error) => void
  /** Execute a lock operation (connect to @1sat/actions lockBsv) */
  onLock?: (params: LockParams) => Promise<LockOperationResult>
  /** Execute an unlock of matured locks (connect to @1sat/actions unlockBsv) */
  onUnlock?: () => Promise<LockOperationResult>
}

/** Return value of the useLockBsv hook */
export interface UseLockBsvReturn {
  /** Current lock summary */
  lockData: LockData
  /** Whether a lock operation is in progress */
  isLocking: boolean
  /** Whether an unlock operation is in progress */
  isUnlocking: boolean
  /** Last operation error */
  error: Error | null
  /** Last successful result (lock or unlock) */
  lastResult: LockOperationResult | null
  /** Execute a lock */
  lock: (params: LockParams) => Promise<void>
  /** Execute an unlock */
  unlock: () => Promise<void>
  /** Clear error and last result */
  reset: () => void
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const EMPTY_LOCK_DATA: LockData = {
  totalLocked: 0,
  unlockable: 0,
  nextUnlock: 0,
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages time-lock BSV state and operations.
 *
 * Accepts `onLock` and `onUnlock` callbacks that should be wired to
 * `@1sat/actions` `lockBsv.execute` and `unlockBsv.execute` respectively.
 *
 * @example
 * ```ts
 * const { lockData, isLocking, lock, unlock } = useLockBsv({
 *   onLock: async (params) => lockBsv.execute(ctx, { requests: [params] }),
 *   onUnlock: async () => unlockBsv.execute(ctx),
 * })
 * ```
 */
export function useLockBsv({
  lockData: initialLockData,
  onSuccess,
  onError,
  onLock,
  onUnlock,
}: UseLockBsvOptions = {}): UseLockBsvReturn {
  const [lockData, setLockData] = useState<LockData>(
    initialLockData ?? EMPTY_LOCK_DATA
  )
  const [isLocking, setIsLocking] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastResult, setLastResult] = useState<LockOperationResult | null>(null)

  const lock = useCallback(
    async (params: LockParams) => {
      if (!onLock) {
        const err = new Error("onLock callback is not configured")
        setError(err)
        onError?.(err)
        return
      }

      setIsLocking(true)
      setError(null)

      try {
        const result = await onLock(params)

        if (result.error) {
          const err = new Error(result.error)
          setError(err)
          onError?.(err)
          return
        }

        setLastResult(result)
        // Optimistically update lock data
        setLockData((prev) => ({
          ...prev,
          totalLocked: prev.totalLocked + params.satoshis,
          nextUnlock:
            prev.nextUnlock === 0
              ? params.until
              : Math.min(prev.nextUnlock, params.until),
        }))
        onSuccess?.(result)
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        onError?.(e)
      } finally {
        setIsLocking(false)
      }
    },
    [onLock, onSuccess, onError]
  )

  const unlock = useCallback(async () => {
    if (!onUnlock) {
      const err = new Error("onUnlock callback is not configured")
      setError(err)
      onError?.(err)
      return
    }

    setIsUnlocking(true)
    setError(null)

    try {
      const result = await onUnlock()

      if (result.error) {
        const err = new Error(result.error)
        setError(err)
        onError?.(err)
        return
      }

      setLastResult(result)
      // Optimistically update lock data
      setLockData((prev) => ({
        ...prev,
        totalLocked: prev.totalLocked - prev.unlockable,
        unlockable: 0,
      }))
      onSuccess?.(result)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      onError?.(e)
    } finally {
      setIsUnlocking(false)
    }
  }, [onUnlock, onSuccess, onError])

  const reset = useCallback(() => {
    setError(null)
    setLastResult(null)
  }, [])

  return {
    lockData,
    isLocking,
    isUnlocking,
    error,
    lastResult,
    lock,
    unlock,
    reset,
  }
}
