import { TokenListUI } from './token-list-ui'
import {
	type TokenHolding,
	type TokenProtocol,
	useTokenList,
} from './use-token-list'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { TokenListUI, type TokenListUIProps } from './token-list-ui'
export {
	useTokenList,
	type UseTokenListOptions,
	type UseTokenListReturn,
	type TokenHolding,
	type TokenType,
	type TokenProtocol,
} from './use-token-list'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenListProps {
	/** BSV payment address to fetch token holdings for */
	address: string | null
	/** Token IDs to fetch balances for */
	tokenIds?: string[]
	/** Pre-populated token holdings (skips API fetch for tokens with matching IDs) */
	tokens?: TokenHolding[]
	/** Custom API base URL (default: https://api.1sat.app) */
	apiUrl?: string
	/** ORDFS base URL for icon resolution (default: https://ordfs.network) */
	ordfsBase?: string
	/** Filter by protocol type (default: "all") */
	protocol?: TokenProtocol
	/** Whether to auto-fetch on mount (default: true) */
	autoFetch?: boolean
	/** Callback when a token row is selected */
	onSelect?: (token: TokenHolding) => void
	/** Callback when an external link action is triggered. Receives the URL string. */
	onExternalLink?: (url: string) => void
	/** Number of skeleton rows to show while loading (default: 3) */
	skeletonCount?: number
	/** Optional CSS class name */
	className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * Displays a list of BSV20/BSV21 fungible token holdings with balances,
 * icons, and token details. Composes the `useTokenList` hook with the
 * `TokenListUI` presentation component.
 *
 * Requires a BSV address and a list of token IDs. Token details and balances
 * are fetched from the 1Sat API.
 *
 * @example
 * ```tsx
 * import { TokenList } from "@/components/blocks/token-list"
 *
 * function WalletTokens() {
 *   return (
 *     <TokenList
 *       address="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
 *       tokenIds={["abc123_0", "def456_0"]}
 *       onSelect={(token) => console.log("Selected:", token.symbol)}
 *     />
 *   )
 * }
 * ```
 */
export function TokenList({
	address,
	tokenIds,
	tokens: prePopulated,
	apiUrl,
	ordfsBase,
	protocol,
	autoFetch,
	onSelect,
	onExternalLink,
	skeletonCount,
	className,
}: TokenListProps) {
	const { tokens, isLoading, error } = useTokenList({
		address,
		tokenIds,
		tokens: prePopulated,
		apiUrl,
		ordfsBase,
		protocol,
		autoFetch,
	})

	return (
		<TokenListUI
			tokens={tokens}
			isLoading={isLoading}
			error={error}
			onSelect={onSelect}
			onExternalLink={onExternalLink}
			skeletonCount={skeletonCount}
			className={className}
		/>
	)
}
