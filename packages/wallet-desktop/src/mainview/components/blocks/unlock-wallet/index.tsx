"use client"

import { useUnlockWallet } from "./use-unlock-wallet"
import { UnlockWalletUi } from "./unlock-wallet-ui"
import type { UnlockPlatform, UnlockWalletResult } from "./use-unlock-wallet"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { useUnlockWallet } from "./use-unlock-wallet"
export { UnlockWalletUi } from "./unlock-wallet-ui"
export type {
  UnlockPlatform,
  UnlockWalletResult,
  UseUnlockWalletOptions,
  UseUnlockWalletReturn,
} from "./use-unlock-wallet"
export type { UnlockWalletUiProps } from "./unlock-wallet-ui"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the composed UnlockWallet block */
export interface UnlockWalletProps {
  /** Platform determines which unlock methods are available (default: "other") */
  platform?: UnlockPlatform
  /** Application name displayed in the unlock UI (default: "Wallet") */
  appName?: string
  /** Callback to execute the unlock attempt */
  onUnlock?: (passphrase?: string) => Promise<UnlockWalletResult>
  /** Called on successful unlock */
  onSuccess?: () => void
  /** Called on error */
  onError?: (error: Error) => void
  /** Optional CSS class */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Full Unlock Wallet block: passphrase or biometric unlock screen.
 *
 * On macOS, presents a Touch ID button first with a passphrase fallback.
 * On other platforms, presents a passphrase input directly.
 *
 * The `onUnlock` callback receives an optional passphrase string
 * (undefined for biometric) and should return `{ success, error? }`.
 *
 * @example
 * ```tsx
 * import { UnlockWallet } from "@/components/blocks/unlock-wallet"
 *
 * <UnlockWallet
 *   platform="macos"
 *   appName="My Wallet"
 *   onUnlock={async (passphrase) => {
 *     if (passphrase) {
 *       return verifyPassphrase(passphrase)
 *     }
 *     return attemptBiometric()
 *   }}
 * />
 * ```
 */
export function UnlockWallet({
  platform = "other",
  appName = "Wallet",
  onUnlock,
  onSuccess,
  onError,
  className,
}: UnlockWalletProps) {
  const { isLoading, error, isUnlocked, failedAttempts, execute, reset } =
    useUnlockWallet({
      platform,
      appName,
      onUnlock,
      onSuccess,
      onError,
    })

  return (
    <UnlockWalletUi
      platform={platform}
      appName={appName}
      isLoading={isLoading}
      error={error}
      isUnlocked={isUnlocked}
      failedAttempts={failedAttempts}
      onSubmit={execute}
      onReset={reset}
      className={className}
    />
  )
}
