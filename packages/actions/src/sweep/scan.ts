/**
 * Sweep Scan Module
 *
 * Scans addresses for UTXOs and categorizes them into asset types.
 * For BSV-21 tokens, validates against the overlay to get confirmed amounts.
 */

import type { OneSatServices } from '@1sat/client'
import type { IndexedOutput } from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import type { ScanProgress, ScanResult, TokenBalance } from './types.js'

/** RUN protocol OP_RETURN prefix: OP_FALSE OP_RETURN OP_PUSH3 "run" */
const RUN_PREFIX = Uint8Array.from([0x00, 0x6a, 0x03, 0x72, 0x75, 0x6e])

function getEvent(events: string[], prefix: string): string | undefined {
	const e = events.find((ev) => ev.startsWith(prefix))
	return e ? e.slice(prefix.length) : undefined
}

/**
 * Scan a single address: sync, search, categorize, and validate BSV-21 tokens.
 */
export async function scanAddress(
	services: OneSatServices,
	address: string,
	onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult> {
	// Phase 1: Sync the address
	onProgress?.({ phase: 'sync', detail: 'Syncing address...' })
	for await (const event of services.owner.getTxos(address, {
		refresh: true,
		limit: 1,
	})) {
		if (event.type === 'sync') {
			const p = event.data
			onProgress?.({
				phase: 'sync',
				detail: `${p.phase}: ${p.processed ?? 0}/${p.total ?? '?'}`,
			})
		} else if (event.type === 'done' || event.type === 'error') {
			break
		}
	}

	// Phase 2: Search for all unspent outputs
	onProgress?.({ phase: 'search', detail: 'Searching for assets...' })
	const allOutputs =
		(await services.txo.search(`own:${address}`, {
			unspent: true,
			events: true,
			sats: true,
			limit: 0,
		})) ?? []

	// Phase 3: Categorize and enrich
	onProgress?.({ phase: 'categorize', detail: 'Loading token details...' })
	return categorizeOutputs(services, allOutputs)
}

/**
 * Scan multiple addresses and merge results.
 */
export async function scanAddresses(
	services: OneSatServices,
	addresses: string[],
	onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult> {
	const unique = [...new Set(addresses)]
	const allResults: ScanResult[] = []

	for (const addr of unique) {
		onProgress?.({
			phase: 'sync',
			detail: `Scanning ${addr.slice(0, 8)}...`,
		})
		allResults.push(await scanAddress(services, addr, onProgress))
	}

	return {
		funding: allResults.flatMap((r) => r.funding),
		ordinals: allResults.flatMap((r) => r.ordinals),
		opnsNames: allResults.flatMap((r) => r.opnsNames),
		bsv21Tokens: allResults.flatMap((r) => r.bsv21Tokens),
		bsv20Tokens: allResults.flatMap((r) => r.bsv20Tokens),
		locked: allResults.flatMap((r) => r.locked),
		run: allResults.flatMap((r) => r.run),
		totalFundingSats: allResults.reduce(
			(sum, r) => sum + r.totalFundingSats,
			0,
		),
	}
}

/**
 * Categorize outputs by event tags into asset types.
 */
async function categorizeOutputs(
	services: OneSatServices,
	outputs: IndexedOutput[],
): Promise<ScanResult> {
	const funding: IndexedOutput[] = []
	const ordinals: IndexedOutput[] = []
	const opnsNames: IndexedOutput[] = []
	const bsv21Raw: IndexedOutput[] = []
	const bsv20Tokens: IndexedOutput[] = []
	const locked: IndexedOutput[] = []

	for (const out of outputs) {
		const events = out.events ?? []
		const sats = out.satoshis ?? 0

		if (events.some((e) => e.startsWith('bsv21:'))) {
			bsv21Raw.push(out)
			continue
		}

		if (events.some((e) => e.startsWith('lock:'))) {
			locked.push(out)
			continue
		}

		if (
			events.some((e) => e === 'type:application/bsv-20' || e === 'type:Token')
		) {
			bsv20Tokens.push(out)
			continue
		}

		if (sats === 1) {
			if (events.some((e) => e === 'type:application/op-ns')) {
				opnsNames.push(out)
			} else {
				ordinals.push(out)
			}
			continue
		}

		if (sats > 1) {
			funding.push(out)
		}
	}

	// Detect RUN protocol transactions in funding
	const run: IndexedOutput[] = []
	const cleanFunding: IndexedOutput[] = []

	if (funding.length > 0) {
		const runTxids = await detectRunTransactions(services, funding)
		for (const f of funding) {
			const { txid } = parseOutpoint(f.outpoint)
			if (runTxids.has(txid)) {
				run.push(f)
			} else {
				cleanFunding.push(f)
			}
		}
	}

	return {
		funding: cleanFunding,
		ordinals,
		opnsNames,
		bsv21Tokens: await groupBsv21Tokens(services, bsv21Raw),
		bsv20Tokens,
		locked,
		run,
		totalFundingSats: cleanFunding.reduce(
			(sum, o) => sum + (o.satoshis ?? 0),
			0,
		),
	}
}

/**
 * Group BSV-21 outputs by token ID, fetch metadata, and validate
 * active tokens against the overlay for confirmed amounts.
 */
async function groupBsv21Tokens(
	services: OneSatServices,
	outputs: IndexedOutput[],
): Promise<TokenBalance[]> {
	const groups = new Map<string, IndexedOutput[]>()

	for (const out of outputs) {
		const events = out.events ?? []
		const tokenId = getEvent(events, 'bsv21:')
		if (!tokenId) continue

		let group = groups.get(tokenId)
		if (!group) {
			group = []
			groups.set(tokenId, group)
		}
		group.push(out)
	}

	if (groups.size === 0) return []

	const tokenIds = [...groups.keys()]

	// Fetch token metadata and active status from overlay
	let details: Array<{
		tokenId: string
		token?: { sym?: string; dec?: string; icon?: string }
		status?: { is_active?: boolean }
	}> = []
	try {
		details = await services.bsv21.lookupTokens(tokenIds)
	} catch {
		// BSV21 service may not be available
	}

	const detailMap = new Map(details.map((d) => [d.tokenId, d]))

	const balances: TokenBalance[] = []
	for (const [tokenId, outs] of groups) {
		const detail = detailMap.get(tokenId)
		const isActive = detail?.status?.is_active ?? false

		let totalAmount = 0n
		const amounts = new Map<string, string>()
		let validatedOutputs = outs

		// For active tokens, validate against the overlay for real amounts
		if (isActive) {
			try {
				const outpoints = outs.map((o) => o.outpoint)
				const validated = await services.bsv21.validateOutputs(
					tokenId,
					outpoints,
					{ unspent: true },
				)
				const validOutpoints = new Set(validated.map((v) => v.outpoint))

				for (const v of validated) {
					const bsv21 = v.data?.bsv21 as { amt?: string } | undefined
					const amt = bsv21?.amt ?? '0'
					amounts.set(v.outpoint, amt)
					totalAmount += BigInt(amt)
				}

				// Keep only original outputs that the overlay validated
				validatedOutputs = outs.filter((o) => validOutpoints.has(o.outpoint))
			} catch {
				// Validation failed — show outputs without amounts
			}
		}

		balances.push({
			tokenId,
			symbol: detail?.token?.sym,
			decimals: Number(detail?.token?.dec ?? 0),
			icon: detail?.token?.icon,
			totalAmount,
			outputs: validatedOutputs,
			amounts,
			isActive,
		})
	}
	return balances
}

/**
 * Check source transactions for the RUN protocol OP_RETURN pattern.
 */
async function detectRunTransactions(
	services: OneSatServices,
	funding: IndexedOutput[],
): Promise<Set<string>> {
	const txids = [...new Set(funding.map((f) => parseOutpoint(f.outpoint).txid))]
	const runTxids = new Set<string>()

	for (const txid of txids) {
		try {
			const beef = await services.getBeefForTxid(txid)
			const beefTx = beef.findTxid(txid)
			if (!beefTx?.tx) continue

			for (const output of beefTx.tx.outputs) {
				const script = output.lockingScript?.toBinary()
				if (script && hasRunPrefix(script)) {
					runTxids.add(txid)
					break
				}
			}
		} catch {
			// If we can't fetch the tx, leave the output in funding
		}
	}

	return runTxids
}

function hasRunPrefix(script: number[]): boolean {
	if (script.length < RUN_PREFIX.length) return false
	for (let i = 0; i < RUN_PREFIX.length; i++) {
		if (script[i] !== RUN_PREFIX[i]) return false
	}
	return true
}
