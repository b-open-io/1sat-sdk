import { useCallback, useEffect, useState } from 'react'
import type { TokenBalance } from '../../../shared/types'
import { TokenListUI, type TokenHolding } from '@/components/blocks/token-list'
import {
	SendBsv21,
	type SendBsv21Params,
	type SendBsv21Result,
	type TokenBalance as SendTokenBalance,
} from '@/components/blocks/send-bsv21'
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

/** Map RPC TokenBalance to SendBsv21 TokenBalance */
function toSendTokenBalance(b: TokenBalance): SendTokenBalance {
	return {
		tokenId: b.id,
		symbol: b.sym ?? b.id.slice(0, 8),
		balance: b.amt,
		decimals: b.dec,
		iconUrl: b.icon ? `https://ordfs.network/${b.icon}` : undefined,
	}
}

export function TokensView() {
	const [rawBalances, setRawBalances] = useState<TokenBalance[]>([])
	const [tokens, setTokens] = useState<TokenHolding[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		rpc.request
			.getTokenBalances()
			.then((result) => {
				setRawBalances(result.balances)
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

	const handleSend = useCallback(
		async (params: SendBsv21Params): Promise<SendBsv21Result> => {
			const result = await rpc.request.sendBsv21({
				tokenId: params.tokenId,
				amount: params.amount,
				address: params.address,
			})
			return result
		},
		[],
	)

	const sendBalances = rawBalances.map(toSendTokenBalance)

	return (
		<div className="p-6 space-y-6">
			<TokenListUI
				tokens={tokens}
				isLoading={loading}
				error={error}
			/>
			{rawBalances.length > 0 && (
				<div className="max-w-md">
					<SendBsv21
						balances={sendBalances}
						onSend={handleSend}
						onSuccess={(result) => {
							if (result.txid) {
								console.log('Token sent:', result.txid)
							}
						}}
					/>
				</div>
			)}
		</div>
	)
}
