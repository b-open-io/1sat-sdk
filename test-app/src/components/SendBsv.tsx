import { sendBsv } from '@1sat/actions'
import { useState } from 'react'
import { useLog } from './LogContext'
import {
	button,
	buttonDisabled,
	card,
	errorText,
	heading,
	input,
	label,
	successText,
} from './styles'
import { useOneSatContext } from './useActions'

export function SendBsv() {
	const ctx = useOneSatContext()
	const { log } = useLog()
	const [address, setAddress] = useState('')
	const [amount, setAmount] = useState('')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const disabled = !ctx || loading || !address || !amount

	async function handleSend() {
		if (!ctx || disabled) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `sendBsv: ${amount} satoshis to ${address}`)

		try {
			const res = await sendBsv.execute(ctx, {
				requests: [
					{
						address,
						satoshis: Number(amount),
					},
				],
			})

			if (res.error) throw new Error(res.error)
			setResult(res.txid ?? 'no txid')
			log('success', `sendBsv txid: ${res.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `sendBsv failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div style={card}>
			<div style={heading}>Send BSV</div>
			<label style={label}>Destination Address</label>
			<input
				style={input}
				placeholder="1A1zP1..."
				value={address}
				onChange={(e) => setAddress(e.target.value)}
			/>
			<label style={label}>Amount (satoshis)</label>
			<input
				style={input}
				placeholder="1000"
				type="number"
				value={amount}
				onChange={(e) => setAmount(e.target.value)}
			/>
			<button
				style={disabled ? buttonDisabled : button}
				disabled={disabled}
				onClick={handleSend}
			>
				{loading ? 'Sending...' : 'Send BSV'}
			</button>
			{result && <div style={successText}>TXID: {result}</div>}
			{error && <div style={errorText}>{error}</div>}
		</div>
	)
}
