import { useEffect, useState } from 'react'
import type { TokenBalance } from '../../../shared/types'
import { TokenListUI, type TokenHolding } from '@/components/blocks/token-list'
import { rpc } from '../../rpc'

/** Map the RPC TokenBalance shape to the BigBlocks TokenHolding shape */
function toTokenHolding(b: TokenBalance): TokenHolding {
	return {
		tokenId: b.id,
		symbol: b.sym ?? b.id.slice(0, 8),
		type: 'BSV21',
		balance: b.amt,
		decimals: b.dec,
		iconUrl: b.icon ? `https://ordfs.network/${b.icon}` : null,
	}
}

export function TokensView() {
	const [tokens, setTokens] = useState<TokenHolding[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		rpc.request
			.getTokenBalances()
			.then((result) => {
				setTokens(result.balances.map(toTokenHolding))
			})
			.catch((err) => {
				setError(
					err instanceof Error
						? err
						: new Error('Failed to load tokens'),
				)
			})
			.finally(() => {
				setLoading(false)
			})
	}, [])

	return (
		<div className="p-6">
			<TokenListUI
				tokens={tokens}
				isLoading={loading}
				error={error}
			/>
		</div>
	)
}
