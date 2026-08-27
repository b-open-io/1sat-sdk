import { type Bsv21Balance, getBsv21Balances } from '@1sat/actions'
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

export function TokensList() {
	const ctx = useOneSatContext()
	const { log } = useLog()
	const [tokens, setTokens] = useState<Bsv21Balance[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const disabled = !ctx || loading

	async function handleFetch() {
		if (!ctx || disabled) return
		setLoading(true)
		setError(null)
		log('info', 'getBsv21Balances...')

		try {
			const res = await getBsv21Balances.execute(ctx, {})
			setTokens(res)
			log('success', `getBsv21Balances: ${res.length} token(s)`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `getBsv21Balances failed: ${msg}`)
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
				<div style={heading}>Token Balances (BSV21)</div>
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

			{tokens.length === 0 && !error && (
				<p style={{ color: '#666', fontSize: '0.8rem' }}>
					{ctx ? 'Click Refresh' : 'Connect wallet first'}
				</p>
			)}

			<div style={{ maxHeight: '300px', overflow: 'auto' }}>
				{tokens.map((tok) => (
					<div
						key={tok.id}
						style={{
							padding: '0.5rem',
							borderBottom: '1px solid #1a1a1a',
							fontSize: '0.8rem',
						}}
					>
						<div style={{ display: 'flex', justifyContent: 'space-between' }}>
							<span style={{ fontWeight: 600 }}>
								{tok.sym ?? tok.id.slice(0, 12)}
							</span>
							<span>{tok.amt}</span>
						</div>
						<div style={{ ...mono, color: '#888', fontSize: '0.7rem' }}>
							ID: {tok.id} | dec: {tok.dec}
						</div>
					</div>
				))}
			</div>

			{error && <div style={errorText}>{error}</div>}
		</div>
	)
}
