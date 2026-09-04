import { LEGACY_P1SAT_BASKET_MIGRATIONS } from '@1sat/types'
import type { WalletInterface } from '@bsv/sdk'
import { Beef } from '@bsv/sdk'

export interface MoveBasketOptions {
	/** Max outputs to move per call (default 1000). */
	limit?: number
	/** Offset into listOutputs (default 0). */
	offset?: number
}

export interface MoveBasketResult {
	from: string
	to: string
	moved: number
	skipped: number
	outpoints: string[]
	errors: Array<{ outpoint: string; error: string }>
}

/**
 * Re-file spendable outputs from one basket into another via
 * `internalizeAction` basket insertion (merge updates `basketId` in place).
 * Tags and customInstructions are preserved. No chain spend.
 *
 * Each outpoint is internalized with an AtomicBEEF for **its** tx — outputs
 * from different txs cannot share one subject BEEF.
 */
export async function moveBasketOutputs(
	wallet: WalletInterface,
	fromBasket: string,
	toBasket: string,
	opts: MoveBasketOptions = {},
): Promise<MoveBasketResult> {
	const from = fromBasket.trim()
	const to = toBasket.trim()
	if (!from || !to) throw new Error('moveBasket: from and to baskets required')
	if (from === to) {
		return { from, to, moved: 0, skipped: 0, outpoints: [], errors: [] }
	}

	const listed = await wallet.listOutputs({
		basket: from,
		include: 'entire transactions',
		includeTags: true,
		includeCustomInstructions: true,
		limit: opts.limit ?? 1000,
		offset: opts.offset ?? 0,
	})

	const beefBin = listed.BEEF
	if (!beefBin?.length && listed.outputs.length > 0) {
		throw new Error(
			`moveBasket: listOutputs returned no BEEF for basket ${from}`,
		)
	}

	const beef = beefBin?.length ? Beef.fromBinary(Array.from(beefBin)) : null
	const errors: Array<{ outpoint: string; error: string }> = []
	const outpoints: string[] = []
	let moved = 0
	let skipped = 0

	for (const o of listed.outputs) {
		const outpoint = o.outpoint
		if (!outpoint?.includes('.')) {
			skipped++
			errors.push({ outpoint: outpoint ?? '?', error: 'bad-outpoint' })
			continue
		}
		const [txid, voutStr] = outpoint.split('.')
		const vout = Number(voutStr)
		if (!txid || !Number.isFinite(vout)) {
			skipped++
			errors.push({ outpoint, error: 'bad-vout' })
			continue
		}

		if (!beef) {
			skipped++
			errors.push({ outpoint, error: 'no-beef' })
			continue
		}

		let atomic: number[]
		try {
			if (!beef.findTxid(txid)) {
				skipped++
				errors.push({
					outpoint,
					error: `beef-missing-txid:${txid.slice(0, 12)}`,
				})
				continue
			}
			atomic = Array.from(beef.toBinaryAtomic(txid))
		} catch (e) {
			skipped++
			errors.push({
				outpoint,
				error: e instanceof Error ? e.message : 'atomic-beef-failed',
			})
			continue
		}

		try {
			await wallet.internalizeAction({
				tx: atomic,
				outputs: [
					{
						outputIndex: vout,
						protocol: 'basket insertion',
						insertionRemittance: {
							basket: to,
							tags: o.tags ?? [],
							customInstructions: o.customInstructions,
						},
					},
				],
				description: `move basket ${from} → ${to}`,
			})
			moved++
			outpoints.push(outpoint)
		} catch (err) {
			skipped++
			errors.push({
				outpoint,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	return { from, to, moved, skipped, outpoints, errors }
}

export interface MigrateLegacyBasketsResult {
	results: MoveBasketResult[]
	totalMoved: number
}

/**
 * Move every known legacy `p 1sat …` basket into its preferred plain name.
 * Idempotent when source baskets are empty.
 */
export async function migrateLegacyP1SatBaskets(
	wallet: WalletInterface,
	opts: MoveBasketOptions = {},
): Promise<MigrateLegacyBasketsResult> {
	const results: MoveBasketResult[] = []
	let totalMoved = 0
	for (const { from, to } of LEGACY_P1SAT_BASKET_MIGRATIONS) {
		const r = await moveBasketOutputs(wallet, from, to, opts)
		results.push(r)
		totalMoved += r.moved
	}
	return { results, totalMoved }
}
