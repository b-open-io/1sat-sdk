import {
	deriveDepositAddresses,
	type SyncAddressesResult,
	syncAddresses,
} from '@1sat/actions'
import type { SyncProgress } from '@1sat/types'
import { useCallback, useEffect, useState } from 'react'
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
 * Deposit addresses + owner sync. Funding entry point for the harness:
 * pay an address below, then Sync to internalize it into the wallet.
 */
export function DepositSync() {
	const ctx = useOneSatContext()
	const { log } = useLog()
	const [addresses, setAddresses] = useState<string[]>([])
	const [count, setCount] = useState(2)
	const [balance, setBalance] = useState<number | null>(null)
	const [balanceError, setBalanceError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<SyncAddressesResult | null>(null)
	const [error, setError] = useState<string | null>(null)

	/**
	 * The `default` basket is admin-only by design — this read fails under a
	 * dApp originator and succeeds with the Admin originator toggle on.
	 */
	const refreshBalance = useCallback(async () => {
		if (!ctx) return
		try {
			const res = await ctx.wallet.listOutputs({
				basket: 'default',
				limit: 1000,
			})
			setBalance(res.outputs.reduce((sum, o) => sum + o.satoshis, 0))
			setBalanceError(null)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setBalance(null)
			setBalanceError(msg)
			log('info', `balance read blocked: ${msg}`)
		}
	}, [ctx, log])

	useEffect(() => {
		if (!ctx) return
		deriveDepositAddresses
			.execute(ctx, { startIndex: 0, count })
			.then((res) => setAddresses(res.derivations.map((d) => d.address)))
			.catch((err: unknown) =>
				log(
					'error',
					`deriveDepositAddresses failed: ${err instanceof Error ? err.message : String(err)}`,
				),
			)
		void refreshBalance()
	}, [ctx, count, log, refreshBalance])

	async function handleSync() {
		if (!ctx) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `syncAddresses: count=${count}`)
		try {
			const res = await syncAddresses.execute(ctx, {
				count,
				onProgress: (p: SyncProgress) => {
					if (p.phase === 'error') log('error', `sync: ${p.error}`)
					else
						log(
							'info',
							`sync ${p.phase}${p.total != null ? ` ${p.processed ?? 0}/${p.total}` : ''}`,
						)
				},
			})
			setResult(res)
			log(
				res.failed > 0 ? 'error' : 'success',
				`sync processed: ${res.processed}, failed: ${res.failed}`,
			)
			await refreshBalance()
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `syncAddresses failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	const disabled = !ctx || loading

	return (
		<div style={card}>
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
				}}
			>
				<div style={heading}>Deposit / Owner Sync</div>
				<button
					style={
						disabled
							? buttonDisabled
							: { ...button, fontSize: '0.75rem', padding: '0.3rem 0.6rem' }
					}
					disabled={disabled}
					onClick={handleSync}
				>
					{loading ? 'Syncing…' : 'Sync'}
				</button>
			</div>
			<p style={{ color: '#888', fontSize: '0.75rem', margin: '0 0 0.75rem' }}>
				Pay an address below, then Sync to internalize it.
			</p>

			<div style={{ marginBottom: '0.5rem' }}>
				<span style={label}>Spendable balance</span>
				<div style={{ ...mono, color: balance ? '#22c55e' : '#888' }}>
					{balance != null
						? `${balance.toLocaleString()} sat`
						: balanceError
							? 'admin only — enable Admin originator'
							: 'unknown'}
				</div>
			</div>

			<label style={label} htmlFor="sync-count">
				Address count
			</label>
			<input
				id="sync-count"
				style={input}
				type="number"
				min={1}
				value={count}
				onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
			/>

			{addresses.map((addr, i) => (
				<div key={addr} style={{ marginBottom: '0.4rem' }}>
					<span style={label}>{`1sat ${i}`}</span>
					<div style={mono}>{addr}</div>
				</div>
			))}
			{addresses.length === 0 && (
				<p style={{ color: '#666', fontSize: '0.8rem' }}>
					{ctx ? 'Deriving…' : 'No wallet context'}
				</p>
			)}

			{result && (
				<div style={successText}>
					processed: {result.processed} · failed: {result.failed} · lastScore:{' '}
					{result.lastScore}
				</div>
			)}
			{error && <div style={errorText}>{error}</div>}
		</div>
	)
}
