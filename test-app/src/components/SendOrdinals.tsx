import { sendOrdinals } from '@1sat/actions'
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

export function SendOrdinals() {
	const ctx = useOneSatContext()
	const { log } = useLog()
	const [id, setId] = useState('')
	const [destAddress, setDestAddress] = useState('')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const disabled = !ctx || loading || !id || !destAddress

	async function handleSend() {
		if (!ctx || disabled) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `sendOrdinals: id=${id} → ${destAddress}`)

		try {
			const res = await sendOrdinals.execute(ctx, {
				transfers: [{ id, address: destAddress }],
			})

			if (res.error) throw new Error(res.error)
			setResult(res.txid ?? 'no txid')
			log('success', `sendOrdinals txid: ${res.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `sendOrdinals failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div style={card}>
			<div style={heading}>Send Ordinals</div>
			<label style={label}>Asset id (id: tag value)</label>
			<input
				style={input}
				placeholder="actionId_0"
				value={id}
				onChange={(e) => setId(e.target.value)}
			/>
			<label style={label}>Destination Address</label>
			<input
				style={input}
				placeholder="1A1zP1..."
				value={destAddress}
				onChange={(e) => setDestAddress(e.target.value)}
			/>
			<button
				style={disabled ? buttonDisabled : button}
				disabled={disabled}
				onClick={handleSend}
			>
				{loading ? 'Sending...' : 'Send Ordinal'}
			</button>
			{result && <div style={successText}>TXID: {result}</div>}
			{error && <div style={errorText}>{error}</div>}
		</div>
	)
}
