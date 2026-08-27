import { getMneeHistory, type MneeTxHistory } from '@1sat/actions'
import { MneeClient } from '@1sat/client'
import { useState } from 'react'
import { useLog } from './LogContext'
import {
	button,
	buttonDisabled,
	card,
	errorText,
	heading,
	mono,
} from './styles'
import { useOneSatContext } from './useActions'
import { useMneeAddresses } from './useMneeAddresses'

export function MneeHistory() {
	const ctx = useOneSatContext()
	const { addresses } = useMneeAddresses()
	const { log } = useLog()
	const [entries, setEntries] = useState<MneeTxHistory[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const disabled = !ctx || loading || addresses.length === 0

	async function handleFetch() {
		if (!ctx || disabled) return
		setLoading(true)
		setError(null)
		log('info', 'getMneeHistory...')

		try {
			const res = await getMneeHistory.execute(ctx, { addresses, limit: 20 })
			setEntries(res.history)
			log('success', `getMneeHistory: ${res.history.length} transactions`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `getMneeHistory failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div style={card}>
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
				}}
			>
				<div style={heading}>MNEE History</div>
				<button
					style={
						disabled
							? buttonDisabled
							: { ...button, fontSize: '0.75rem', padding: '0.3rem 0.6rem' }
					}
					disabled={disabled}
					onClick={handleFetch}
				>
					{loading ? 'Loading...' : 'Refresh'}
				</button>
			</div>

			{entries.length === 0 && !error && (
				<p style={{ color: '#666', fontSize: '0.8rem' }}>
					{ctx
						? addresses.length > 0
							? 'Click Refresh'
							: 'Deriving addresses...'
						: 'Connect wallet first'}
				</p>
			)}

			<div style={{ maxHeight: '250px', overflow: 'auto' }}>
				{entries.map((tx) => (
					<div
						key={`${tx.txid}-${tx.score}`}
						style={{
							padding: '0.4rem 0',
							borderBottom: '1px solid #1a1a1a',
							fontSize: '0.75rem',
						}}
					>
						<div style={{ display: 'flex', justifyContent: 'space-between' }}>
							<span style={mono}>{tx.txid.slice(0, 12)}...</span>
							<span
								style={{
									color: tx.type === 'receive' ? '#22c55e' : '#ef4444',
									fontWeight: 600,
								}}
							>
								{tx.type === 'receive' ? '+' : '-'}$
								{MneeClient.fromAtomicAmount(tx.amount).toFixed(2)}
							</span>
						</div>
						<div style={{ color: '#666', fontSize: '0.65rem' }}>
							{tx.status} | block {tx.height} |{' '}
							{tx.counterparties
								.map((c) => `${c.address.slice(0, 8)}...`)
								.join(', ')}
						</div>
					</div>
				))}
			</div>

			{error && <div style={errorText}>{error}</div>}
		</div>
	)
}
