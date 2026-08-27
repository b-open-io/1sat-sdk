import { OpnsManagerUI } from './opns-manager-ui'
import { useOpnsManager } from './use-opns-manager'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
	OpnsManagerUI,
	type OpnsManagerUIProps,
	type OpnsNameDisplay,
	type OpnsOperationResult,
} from './opns-manager-ui'
export {
	type OpnsName,
	type UseOpnsManagerOptions,
	type UseOpnsManagerReturn,
	useOpnsManager,
} from './use-opns-manager'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpnsManagerProps {
	/** Whether to auto-fetch names on mount (default: true) */
	autoFetch?: boolean
	/** Callback on successful register or deregister */
	onSuccess?: (result: { txid?: string; error?: string }) => void
	/** Callback on error */
	onError?: (error: Error) => void
	/** Number of skeleton rows to show while loading (default: 3) */
	skeletonCount?: number
	/** Optional CSS class name */
	className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * Full OpNS name manager block. Lists owned OpNS names from the connected
 * wallet and provides register/deregister identity binding actions.
 *
 * Must be rendered inside a `WalletProvider` from `@1sat/react`.
 *
 * @example
 * ```tsx
 * import { WalletProvider } from "@1sat/react"
 * import { OpnsManager } from "@/components/blocks/opns-manager"
 *
 * function App() {
 *   return (
 *     <WalletProvider>
 *       <OpnsManager
 *         onSuccess={(r) => console.log("txid:", r.txid)}
 *         onError={(e) => console.error(e)}
 *       />
 *     </WalletProvider>
 *   )
 * }
 * ```
 */
export function OpnsManager({
	autoFetch = true,
	onSuccess,
	onError,
	skeletonCount,
	className,
}: OpnsManagerProps) {
	const {
		names,
		isLoading,
		isOperating,
		error,
		register,
		deregister,
		refresh,
	} = useOpnsManager({ autoFetch, onSuccess, onError })

	return (
		<OpnsManagerUI
			names={names}
			isLoading={isLoading}
			isOperating={isOperating}
			error={error}
			onRegister={register}
			onDeregister={deregister}
			onRefresh={refresh}
			skeletonCount={skeletonCount}
			className={className}
		/>
	)
}
