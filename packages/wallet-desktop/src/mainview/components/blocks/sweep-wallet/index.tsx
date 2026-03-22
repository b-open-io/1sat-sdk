import { SweepWalletUi, type SweepWalletUiProps } from "./sweep-wallet-ui"
import {
  useSweepWallet,
  type ScanResult,
  type SweepResult,
  type UseSweepWalletOptions,
  type UseSweepWalletReturn,
} from "./use-sweep-wallet"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { SweepWalletUi, type SweepWalletUiProps } from "./sweep-wallet-ui"
export {
  useSweepWallet,
  type ScanResult,
  type SweepResult,
  type SweepStep,
  type SweepFundingUtxo,
  type SweepOrdinalUtxo,
  type SweepTokenGroup,
  type UseSweepWalletOptions,
  type UseSweepWalletReturn,
} from "./use-sweep-wallet"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the composed SweepWallet block */
export interface SweepWalletProps {
  /** Scan a WIF for spendable assets */
  onScan: (wif: string) => Promise<ScanResult>
  /** Execute the sweep transaction */
  onSweep: (wif: string, assets: ScanResult) => Promise<SweepResult>
  /** Callback after a successful sweep */
  onSuccess?: (result: SweepResult) => void
  /** Callback on any error */
  onError?: (error: Error) => void
  /** Optional CSS class */
  className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * Full sweep-wallet block: WIF input, scan, preview, sweep, and success/error states.
 *
 * Wires `useSweepWallet` (logic) into `SweepWalletUi` (presentation).
 * The caller provides `onScan` and `onSweep` callbacks that integrate with
 * `@1sat/actions` sweep utilities.
 *
 * @example
 * ```tsx
 * import { SweepWallet } from "@/components/blocks/sweep-wallet"
 *
 * <SweepWallet
 *   onScan={async (wif) => {
 *     const pk = PrivateKey.fromWif(wif)
 *     const address = pk.toPublicKey().toAddress()
 *     return await scanAddressUtxos(services, address)
 *   }}
 *   onSweep={async (wif, assets) => {
 *     const inputs = await prepareSweepInputs(ctx, assets.funding)
 *     return await sweepBsv.execute(ctx, { inputs, wif })
 *   }}
 * />
 * ```
 */
export function SweepWallet({
  onScan,
  onSweep,
  onSuccess,
  onError,
  className,
}: SweepWalletProps) {
  const hook = useSweepWallet({ onScan, onSweep, onSuccess, onError })

  return (
    <SweepWalletUi
      step={hook.step}
      wifInput={hook.wifInput}
      onWifInputChange={hook.setWifInput}
      isWifValid={hook.isWifValid}
      scanResult={hook.scanResult}
      sweepResult={hook.sweepResult}
      error={hook.error}
      isLoading={hook.isLoading}
      onScan={hook.handleScan}
      onSweep={hook.handleSweep}
      onReset={hook.handleReset}
      className={className}
    />
  )
}
