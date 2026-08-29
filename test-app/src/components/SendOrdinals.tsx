import { sendOrdinals } from '@1sat/actions'
import { Utils } from '@bsv/sdk'
import { useState, type CSSProperties } from 'react'
import {
	card,
	heading,
	input,
	button,
	buttonDisabled,
	successText,
	errorText,
	label,
} from './styles'
import { useLog } from './LogContext'
import { useActionFlags } from './useActionFlags'
import { useOneSatContext } from './useActions'

export function SendOrdinals() {
	const ctx = useOneSatContext()
	const flags = useActionFlags()
	const { log } = useLog()
	const [id, setId] = useState('')
	const [destAddress, setDestAddress] = useState('')
	const [keepSelf, setKeepSelf] = useState(false)
	const [text, setText] = useState('')
	const [contentType, setContentType] = useState('text/plain')
	const [file, setFile] = useState<File | null>(null)
	const [signWithBAP, setSignWithBAP] = useState(false)
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const hasInscription = !!(text || file)
	const disabled =
		!ctx ||
		loading ||
		!id ||
		(!keepSelf && !destAddress) ||
		(signWithBAP && !hasInscription)

	async function handleSend() {
		if (!ctx || disabled) return
		setLoading(true)
		setResult(null)
		setError(null)

		try {
			let inscription:
				| { base64Content: string; contentType: string }
				| undefined
			if (file) {
				const buffer = await file.arrayBuffer()
				inscription = {
					base64Content: Utils.toBase64(
						Array.from(new Uint8Array(buffer)),
					),
					contentType: file.type || 'application/octet-stream',
				}
				log(
					'info',
					`sendOrdinals reinscribe file ${file.name} (${inscription.contentType}, ${buffer.byteLength} bytes)`,
				)
			} else if (text) {
				inscription = {
					base64Content: Utils.toBase64(Utils.toArray(text, 'utf8')),
					contentType,
				}
				log(
					'info',
					`sendOrdinals reinscribe text (${contentType}, ${text.length} chars)`,
				)
			}

			log(
				'info',
				`sendOrdinals: id=${id} → ${keepSelf ? 'self' : destAddress}${signWithBAP ? ' + BAP' : ''}`,
			)

			const res = await sendOrdinals.execute(ctx, {
				transfers: [
					{
						id,
						...(keepSelf
							? { counterparty: 'self' }
							: { address: destAddress }),
						...(inscription && { inscription }),
						...(signWithBAP && { signWithBAP: true }),
					},
				],
				...flags,
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

	const check: CSSProperties = {
		...label,
		display: 'flex',
		alignItems: 'center',
		gap: '0.4rem',
		margin: '0.25rem 0 0.6rem',
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
			<label style={check}>
				<input
					type="checkbox"
					checked={keepSelf}
					onChange={(e) => setKeepSelf(e.target.checked)}
				/>
				Keep in wallet (self)
			</label>
			{!keepSelf && (
				<>
					<label style={label}>Destination Address</label>
					<input
						style={input}
						placeholder="1A1zP1..."
						value={destAddress}
						onChange={(e) => setDestAddress(e.target.value)}
					/>
				</>
			)}

			<label style={label}>Reinscribe text (optional)</label>
			<textarea
				style={{ ...input, minHeight: '4rem', resize: 'vertical' }}
				placeholder="New content — leave empty for a plain transfer"
				value={text}
				onChange={(e) => setText(e.target.value)}
			/>
			<label style={label}>Content Type</label>
			<select
				style={input}
				value={contentType}
				onChange={(e) => setContentType(e.target.value)}
			>
				<option value="text/plain">text/plain</option>
				<option value="text/html">text/html</option>
				<option value="application/json">application/json</option>
				<option value="image/png">image/png</option>
				<option value="image/jpeg">image/jpeg</option>
				<option value="image/svg+xml">image/svg+xml</option>
			</select>
			<label style={label}>Or upload file to reinscribe</label>
			<input
				type="file"
				style={{ ...input, padding: '0.25rem' }}
				onChange={(e) => {
					if (e.target.files?.[0]) setFile(e.target.files[0])
				}}
			/>
			<label style={check}>
				<input
					type="checkbox"
					checked={signWithBAP}
					onChange={(e) => setSignWithBAP(e.target.checked)}
					disabled={!hasInscription}
				/>
				Sign with BAP (Sigma)
			</label>
			<button
				style={disabled ? buttonDisabled : button}
				disabled={disabled}
				onClick={handleSend}
			>
				{loading
					? 'Sending...'
					: hasInscription
						? 'Reinscribe'
						: 'Send Ordinal'}
			</button>
			{result && <div style={successText}>TXID: {result}</div>}
			{error && <div style={errorText}>{error}</div>}
		</div>
	)
}
