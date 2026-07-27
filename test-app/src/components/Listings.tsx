import { sellOrdinal, buyOrdinal, cancelOrdinalListing } from '@1sat/actions'
import { useState } from 'react'
import {
	card,
	heading,
	input,
	button,
	buttonDisabled,
	successText,
	errorText,
	label,
	row,
} from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

type Tab = 'create' | 'purchase' | 'cancel'

export function Listings() {
	const [tab, setTab] = useState<Tab>('create')

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
	const ctx = useOneSatContext()
	const { log } = useLog()
	const [id, setId] = useState('')
	const [price, setPrice] = useState('')
	const [payAddress, setPayAddress] = useState('')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const disabled = !ctx || loading || !id || !price

	async function handleList() {
		if (!ctx || disabled) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `sellOrdinal: id=${id} for ${price} sat`)

		try {
			const res = await sellOrdinal.execute(ctx, {
				id,
				price: Number(price),
				...(payAddress && { payAddress }),
			})

			if (res.error) throw new Error(res.error)
			setResult(res.txid ?? 'no txid')
			log('success', `sellOrdinal txid: ${res.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `sellOrdinal failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	return (
		<>
			<label style={label}>Asset id</label>
			<input
				style={input}
				placeholder="actionId_0"
				value={id}
				onChange={(e) => setId(e.target.value)}
			/>
			<label style={label}>Price (satoshis)</label>
			<input
				style={input}
				placeholder="10000"
				type="number"
				value={price}
				onChange={(e) => setPrice(e.target.value)}
			/>
			<label style={label}>Payment address (optional)</label>
			<input
				style={input}
				placeholder="default: P1SAT pay key"
				value={payAddress}
				onChange={(e) => setPayAddress(e.target.value)}
			/>
			<button
				style={disabled ? buttonDisabled : button}
				disabled={disabled}
				onClick={handleList}
			>
				{loading ? 'Listing...' : 'Create Listing'}
			</button>
			{result && <div style={successText}>TXID: {result}</div>}
			{error && <div style={errorText}>{error}</div>}
		</>
	)
}

function PurchaseListing() {
	const ctx = useOneSatContext()
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
			const res = await cancelOrdinalListing.execute(ctx, { id })

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
