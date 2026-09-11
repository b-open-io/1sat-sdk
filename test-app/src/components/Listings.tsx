import { buyOrdinal, cancelOrdinalListing } from '@1sat/actions'
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
	row,
	successText,
} from './styles'
import { useActionFlags } from './useActionFlags'
import { useOneSatContext } from './useActions'

type Tab = 'create' | 'purchase' | 'cancel'

export function Listings() {
	const [tab, setTab] = useState<Tab>('purchase')

	return (
		<div style={card}>
			<div style={heading}>Marketplace Listings</div>
			<div style={{ ...row, marginBottom: '0.75rem' }}>
				{(['create', 'purchase', 'cancel'] as Tab[]).map((t) => (
					<button
						key={t}
						style={{
							...button,
							background: tab === t ? '#2563eb' : '#1a1a1a',
							border: '1px solid #333',
							fontSize: '0.75rem',
							padding: '0.35rem 0.75rem',
						}}
						onClick={() => setTab(t)}
					>
						{t === 'create' ? 'List' : t === 'purchase' ? 'Buy' : 'Cancel'}
					</button>
				))}
			</div>
			{tab === 'create' && <CreateListing />}
			{tab === 'purchase' && <PurchaseListing />}
			{tab === 'cancel' && <CancelListing />}
		</div>
	)
}

function CreateListing() {
	return (
		<p style={errorText}>
			OrdLock listing create is disabled. Buy and cancel of existing listings
			remain available.
		</p>
	)
}

function PurchaseListing() {
	const ctx = useOneSatContext()
	const flags = useActionFlags()
	const { log } = useLog()
	const [listingOutpoint, setListingOutpoint] = useState('')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const disabled = !ctx || loading || !listingOutpoint

	async function handlePurchase() {
		if (!ctx || disabled) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `buyOrdinal: ${listingOutpoint}`)

		try {
			const res = await buyOrdinal.execute(ctx, {
				outpoint: listingOutpoint,
				...flags,
			})

			if (res.error) throw new Error(res.error)
			setResult(res.txid ?? 'no txid')
			log('success', `buyOrdinal txid: ${res.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `buyOrdinal failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	return (
		<>
			<label style={label}>Listing outpoint (txid.vout)</label>
			<input
				style={input}
				placeholder="abc...def.0"
				value={listingOutpoint}
				onChange={(e) => setListingOutpoint(e.target.value)}
			/>
			<button
				style={disabled ? buttonDisabled : button}
				disabled={disabled}
				onClick={handlePurchase}
			>
				{loading ? 'Purchasing...' : 'Purchase Listing'}
			</button>
			{result && <div style={successText}>TXID: {result}</div>}
			{error && <div style={errorText}>{error}</div>}
		</>
	)
}

function CancelListing() {
	const ctx = useOneSatContext()
	const flags = useActionFlags()
	const { log } = useLog()
	const [id, setId] = useState('')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const disabled = !ctx || loading || !id

	async function handleCancel() {
		if (!ctx || disabled) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `cancelOrdinalListing: id=${id}`)

		try {
			const res = await cancelOrdinalListing.execute(ctx, { id, ...flags })

			if (res.error) throw new Error(res.error)
			setResult(res.txid ?? 'no txid')
			log('success', `cancelOrdinalListing txid: ${res.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `cancelOrdinalListing failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	return (
		<>
			<label style={label}>Listing asset id</label>
			<input
				style={input}
				placeholder="actionId_0"
				value={id}
				onChange={(e) => setId(e.target.value)}
			/>
			<button
				style={disabled ? buttonDisabled : button}
				disabled={disabled}
				onClick={handleCancel}
			>
				{loading ? 'Cancelling...' : 'Cancel Listing'}
			</button>
			{result && <div style={successText}>TXID: {result}</div>}
			{error && <div style={errorText}>{error}</div>}
		</>
	)
}
