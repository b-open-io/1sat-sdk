import { useLockBsv } from "./use-lock-bsv"
import { LockBsvUi } from "./lock-bsv-ui"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { useLockBsv } from "./use-lock-bsv"
export { LockBsvUi } from "./lock-bsv-ui"
export type {
  LockData,
  LockParams,
  LockOperationResult,
  UseLockBsvOptions,
  UseLockBsvReturn,
} from "./use-lock-bsv"
export type { LockBsvUiProps } from "./lock-bsv-ui"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the composed LockBsv block */
export interface LockBsvProps {
  /** Pre-populated lock summary data */
  lockData?: {
    totalLocked: number
    unlockable: number
    nextUnlock: number
  }
  /** Execute a lock operation (connect to @1sat/actions lockBsv) */
  onLock?: (params: {
    satoshis: number
    until: number
  }) => Promise<{ txid?: string; error?: string }>
  /** Execute an unlock of matured locks (connect to @1sat/actions unlockBsv) */
  onUnlock?: () => Promise<{ txid?: string; error?: string }>
  /** Callback on successful lock or unlock */
  onSuccess?: (result: { txid?: string; error?: string }) => void
  /** Callback on error */
  onError?: (error: Error) => void
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Time-lock BSV block: summary card, lock form, and unlock action.
 *
 * Wire `onLock` and `onUnlock` to `@1sat/actions` lock operations:
 *
 * @example
 * ```tsx
 * import { LockBsv } from "@/components/blocks/lock-bsv"
 * import { lockBsv, unlockBsv, createContext } from "@1sat/actions"
 * import { useWallet } from "@1sat/react"
 *
 * function App() {
 *   const { wallet } = useWallet()
 *   const ctx = createContext(wallet)
 *
 *   return (
 *     <LockBsv
 *       onLock={(params) =>
 *         lockBsv.execute(ctx, { requests: [params] })
 *       }
 *       onUnlock={() => unlockBsv.execute(ctx)}
 *     />
 *   )
 * }
 * ```
 */
export function LockBsv({
  lockData: initialLockData,
  onLock,
  onUnlock,
  onSuccess,
  onError,
  className,
}: LockBsvProps) {
  const { lockData, isLocking, isUnlocking, error, lastResult, lock, unlock, reset } =
    useLockBsv({
      lockData: initialLockData,
      onLock,
      onUnlock,
      onSuccess,
      onError,
    })

  return (
    <LockBsvUi
      lockData={lockData}
      isLocking={isLocking}
      isUnlocking={isUnlocking}
      error={error}
      lastResult={lastResult}
      onLock={lock}
      onUnlock={unlock}
      onReset={reset}
      className={className}
    />
  )
}
