import { WalletOverviewUI } from "./wallet-overview-ui"
import {
  useWalletOverview,
  type UseWalletOverviewReturn,
  type WalletBalance,
} from "./use-wallet-overview"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  WalletOverviewUI,
  type WalletOverviewUIProps,
} from "./wallet-overview-ui"
export {
  useWalletOverview,
  type UseWalletOverviewReturn,
  type WalletBalance,
} from "./use-wallet-overview"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletOverviewProps {
  /** Callback fired when the Send button is clicked */
  onSend?: () => void
  /** Callback fired when the Receive button is clicked */
  onReceive?: () => void
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * Wallet overview block displaying BSV balance, addresses, and action buttons.
 *
 * Composes the `useWalletOverview` hook with the `WalletOverviewUI`
 * presentation component. Must be rendered inside `WalletProvider`
 * from `@1sat/react`.
 *
 * @example
 * ```tsx
 * import { WalletProvider } from "@1sat/react"
 * import { WalletOverview } from "@/components/blocks/wallet-overview"
 *
 * function App() {
 *   return (
 *     <WalletProvider>
 *       <WalletOverview
 *         onSend={() => console.log("Open send dialog")}
 *         onReceive={() => console.log("Open receive dialog")}
 *       />
 *     </WalletProvider>
 *   )
 * }
 * ```
 */
export function WalletOverview({
  onSend,
  onReceive,
  className,
}: WalletOverviewProps) {
  const {
    balance,
    paymentAddress,
    ordinalAddress,
    identityKey,
    isLoading,
    error,
    refetch,
  } = useWalletOverview()

  return (
    <WalletOverviewUI
      balance={balance}
      paymentAddress={paymentAddress}
      ordinalAddress={ordinalAddress}
      identityKey={identityKey}
      isLoading={isLoading}
      error={error}
      onSend={onSend}
      onReceive={onReceive}
      onRefresh={refetch}
      className={className}
    />
  )
}
