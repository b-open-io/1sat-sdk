import {
	buyOpns,
	deregisterOpns,
	type ListOpnsResult,
	listOpns,
	registerOpns,
} from '@1sat/actions'
import { readAssetIdTag } from '@1sat/types'
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
	mono,
	successText,
} from './styles'
import { useOneSatContext } from './useActions'

/**
 * OpNS list + publish — primary surface for testing gated permission cards.
 */
export function OpnsPanel() {
	const ctx = useOneSatContext()
	const { log } = useLog()
	const [list, setList] = useState<ListOpnsResult | null>(null)
	const [id, setId] = useState('')
	const [profileName, setProfileName] = useState('')
	const [avatar, setAvatar] = useState('')
	const [buyOutpoint, setBuyOutpoint] = useState('')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function handleList() {
		if (!ctx) return
		setLoading(true)
		setError(null)
		log('info', 'listOpns...')
		try {
			const res = await listOpns.execute(ctx, { limit: 50 })
			setList(res)
			log('success', `listOpns: ${res.outputs.length} name(s)`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `listOpns failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	async function handleRegister() {
		if (!ctx || !id) return
		setLoading(true)
		setResult(null)
		setError(null)
		log(
			'info',
			`registerOpns: id=${id}${profileName ? ` profileName=${profileName}` : ''}${avatar ? ` avatar=${avatar}` : ''}`,
		)
		try {
			const res = await registerOpns.execute(ctx, {
				id,
				...(profileName && { profileName }),
				...(avatar && { avatar }),
			})
			if (res.error) throw new Error(res.error)
			setResult(res.txid ?? 'no txid')
			log('success', `registerOpns txid: ${res.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `registerOpns failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	async function handleDeregister() {
		if (!ctx || !id) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `deregisterOpns: id=${id}`)
		try {
			const res = await deregisterOpns.execute(ctx, { id })
			if (res.error) throw new Error(res.error)
			setResult(res.txid ?? 'no txid')
			log('success', `deregisterOpns txid: ${res.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `deregisterOpns failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	async function handleBuy() {
		if (!ctx || !buyOutpoint) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `buyOpns: ${buyOutpoint}`)
		try {
			const res = await buyOpns.execute(ctx, { outpoint: buyOutpoint })
			if (res.error) throw new Error(res.error)
			setResult(res.txid ?? 'no txid')
			log('success', `buyOpns txid: ${res.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `buyOpns failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	const actDisabled = !ctx || loading || !id

	return (
		<div style={card}>
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
				}}
			>
				<div style={heading}>OpNS (permission test)</div>
				<button
					style={
						!ctx || loading
							? buttonDisabled
							: { ...button, fontSize: '0.75rem', padding: '0.3rem 0.6rem' }
					}
					disabled={!ctx || loading}
					onClick={handleList}
				>
					{loading ? '…' : 'Refresh'}
				</button>
			</div>
			<p style={{ color: '#888', fontSize: '0.75rem', margin: '0 0 0.75rem' }}>
				Publish should show one “Publish name” card (no bare Sign payload).
			</p>

			<label style={label}>Asset id</label>
			<input
				style={input}
				placeholder="from list below"
				value={id}
				onChange={(e) => setId(e.target.value)}
			/>
			<label style={label}>Profile name (optional)</label>
			<input
				style={input}
				placeholder="display name for paymail public-profile"
				value={profileName}
				onChange={(e) => setProfileName(e.target.value)}
			/>
			<label style={label}>Avatar origin (optional)</label>
			<input
				style={input}
				placeholder="txid_vout of an image ordinal"
				value={avatar}
				onChange={(e) => setAvatar(e.target.value)}
			/>
			<div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
				<button
					style={actDisabled ? buttonDisabled : button}
					disabled={actDisabled}
					onClick={handleRegister}
				>
					Publish (register)
				</button>
				<button
					style={
						actDisabled ? buttonDisabled : { ...button, background: '#444' }
					}
					disabled={actDisabled}
					onClick={handleDeregister}
				>
					Unpublish
				</button>
			</div>

			<label style={label}>Buy listing (outpoint)</label>
			<input
				style={input}
				placeholder="txid.vout"
				value={buyOutpoint}
				onChange={(e) => setBuyOutpoint(e.target.value)}
			/>
			<button
				style={!ctx || loading || !buyOutpoint ? buttonDisabled : button}
				disabled={!ctx || loading || !buyOutpoint}
				onClick={handleBuy}
			>
				Buy Name
			</button>

			{result && <div style={successText}>TXID: {result}</div>}
			{error && <div style={errorText}>{error}</div>}

			<div style={{ maxHeight: 220, overflow: 'auto', marginTop: '0.5rem' }}>
				{list?.outputs.map((o) => {
					const assetId = readAssetIdTag(o.tags)
					const name = o.tags?.find((t) => t.startsWith('name:'))?.slice(5)
					const published = o.tags?.includes('opns:published')
					return (
						<button
							key={o.outpoint}
							type="button"
							onClick={() => assetId && setId(assetId)}
							style={rowBtn}
						>
							<div style={{ fontWeight: 600 }}>{name ?? '(unnamed)'}</div>
							{assetId && (
								<div style={{ ...mono, color: '#7dd3fc' }}>id: {assetId}</div>
							)}
							<div style={mono}>{o.outpoint}</div>
							<div style={{ color: '#888', fontSize: '0.7rem' }}>
								{published ? 'published' : 'unpublished'}
							</div>
						</button>
					)
				})}
				{list && list.outputs.length === 0 && (
					<p style={{ color: '#666', fontSize: '0.8rem' }}>
						No OpNS names in wallet
					</p>
				)}
			</div>
		</div>
	)
}

const rowBtn: React.CSSProperties = {
	display: 'block',
	width: '100%',
	textAlign: 'left',
	background: '#141414',
	border: '1px solid #2a2a2a',
	borderRadius: 6,
	padding: '0.5rem',
	marginBottom: 6,
	cursor: 'pointer',
	color: 'inherit',
}
