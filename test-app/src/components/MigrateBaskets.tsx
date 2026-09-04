/**
 * Temporary harness: migrate legacy `p 1sat …` baskets → plain names.
 * One button per mapping + migrate all. Prefer Admin originator so basket
 * grants do not block list/internalize.
 */
import { moveBasketOutputs, type MoveBasketResult } from '@1sat/actions'

/** User-wallet baskets only (not hosting / sigma / bsocial / auth). */
const USER_MIGRATIONS = [
	{ from: 'p 1sat ordinals', to: '1sat' },
	{ from: 'p 1sat bsv21', to: 'bsv21' },
	{ from: 'p 1sat opns', to: 'opns' },
	{ from: 'p 1sat lock', to: 'lock' },
] as const
import { useState } from 'react'
import {
	button,
	buttonDisabled,
	card,
	errorText,
	heading,
	mono,
	successText,
} from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'
import { useLocalCwi } from '../localCwi/LocalCwiHost'
import { ADMIN_ORIGINATOR } from '../localCwi/constants'
import { withOriginator } from '../localCwi/withOriginator'

export function MigrateBaskets() {
	const ctx = useOneSatContext()
	const local = useLocalCwi()
	const { log } = useLog()
	const [busy, setBusy] = useState<string | null>(null)
	const [last, setLast] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	/** Prefer admin-bound wallet so list/internalize are not grant-gated. */
	function walletForMigrate() {
		if (local.localEnabled && local.gatedWallet) {
			return withOriginator(local.gatedWallet, ADMIN_ORIGINATOR)
		}
		return ctx?.wallet ?? null
	}

	async function countBasket(basket: string): Promise<number | string> {
		const w = walletForMigrate()
		if (!w) return '?'
		try {
			const r = await w.listOutputs({ basket, limit: 1 })
			return r.totalOutputs ?? r.outputs.length
		} catch (e) {
			return e instanceof Error ? e.message.slice(0, 40) : 'err'
		}
	}

	async function handleOne(from: string, to: string) {
		const w = walletForMigrate()
		if (!w || busy) return
		setBusy(from)
		setError(null)
		setLast(null)
		log('info', `migrate: ${from} → ${to}`)
		try {
			const beforeFrom = await countBasket(from)
			const beforeTo = await countBasket(to)
			const result: MoveBasketResult = await moveBasketOutputs(w, from, to)
			const afterFrom = await countBasket(from)
			const afterTo = await countBasket(to)
			const summary =
				`moved ${result.moved}` +
				(result.skipped ? `, skipped ${result.skipped}` : '') +
				(result.errors.length
					? `, errors ${result.errors.length}`
					: '') +
				` | ${from}: ${beforeFrom}→${afterFrom} | ${to}: ${beforeTo}→${afterTo}`
			setLast(summary)
			log('success', `migrate ${from}: ${summary}`)
			for (const e of result.errors) {
				log('error', `  ${e.outpoint}: ${e.error}`)
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `migrate ${from} failed: ${msg}`)
		} finally {
			setBusy(null)
		}
	}

	async function handleAll() {
		const w = walletForMigrate()
		if (!w || busy) return
		setBusy('all')
		setError(null)
		setLast(null)
		log('info', 'migrate: main 4 user baskets')
		try {
			const lines: string[] = []
			let totalMoved = 0
			for (const { from, to } of USER_MIGRATIONS) {
				const r = await moveBasketOutputs(w, from, to)
				totalMoved += r.moved
				if (r.moved > 0 || r.errors.length > 0) {
					lines.push(
						`${from} → ${to}: moved ${r.moved}` +
							(r.skipped ? ` skip ${r.skipped}` : '') +
							(r.errors.length ? ` err ${r.errors.length}` : ''),
					)
				}
				for (const e of r.errors) {
					log('error', `  ${e.outpoint}: ${e.error}`)
				}
			}
			const summary =
				`totalMoved ${totalMoved}` +
				(lines.length ? `\n${lines.join('\n')}` : ' (nothing to move)')
			setLast(summary)
			log('success', `migrate all: totalMoved ${totalMoved}`)
			for (const line of lines) log('info', line)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `migrate all failed: ${msg}`)
		} finally {
			setBusy(null)
		}
	}

	const disabled = !walletForMigrate() || !!busy

	return (
		<div style={card}>
			<div style={heading}>Migrate baskets (temp)</div>
			<p style={{ fontSize: '0.75rem', color: '#888', margin: '0 0 0.75rem' }}>
				Legacy <span style={mono}>p 1sat …</span> → plain names. Uses admin
				originator when Local CWI is on. No dual-read after move.
			</p>
			<button
				type="button"
				style={disabled ? buttonDisabled : button}
				disabled={disabled}
				onClick={() => void handleAll()}
			>
				{busy === 'all' ? 'Migrating…' : 'Migrate all 4 user baskets'}
			</button>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.75rem' }}>
				{USER_MIGRATIONS.map(({ from, to }) => (
					<button
						key={from}
						type="button"
						style={{
							...(disabled || busy === from ? buttonDisabled : button),
							textAlign: 'left',
							fontSize: '0.75rem',
						}}
						disabled={disabled}
						onClick={() => void handleOne(from, to)}
					>
						{busy === from ? '…' : `${from} → ${to}`}
					</button>
				))}
			</div>
			{last && (
				<pre style={{ ...successText, whiteSpace: 'pre-wrap', marginTop: '0.75rem' }}>
					{last}
				</pre>
			)}
			{error && <div style={{ ...errorText, marginTop: '0.5rem' }}>{error}</div>}
		</div>
	)
}
