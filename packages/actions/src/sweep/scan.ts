/**
 * Sweep Scan Module
 *
 * Scans addresses for UTXOs and categorizes them into asset types.
 * For BSV-21 tokens, validates against the overlay to get confirmed amounts.
 */

import type { OneSatServices } from '@1sat/client'
import type { IndexedOutput } from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import type {
	Bsv20Balance,
	ScanProgress,
	ScanResult,
	TokenBalance,
} from './types.js'

/** RUN protocol OP_RETURN prefix: OP_FALSE OP_RETURN OP_PUSH3 "run" */
const RUN_PREFIX = Uint8Array.from([0x00, 0x6a, 0x03, 0x72, 0x75, 0x6e])

function getEvent(events: string[], prefix: string): string | undefined {
	const e = events.find((ev) => ev.startsWith(prefix))
	return e ? e.slice(prefix.length) : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined
}

function asString(value: unknown): string | undefined {
	if (typeof value === 'string' && value.length > 0) return value
	if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	return undefined
}

function inscriptionJson(
	out: IndexedOutput,
): Record<string, unknown> | undefined {
	return asRecord(asRecord(asRecord(out.data)?.insc)?.json)
}

/** BSV-21 token ids are the deploy outpoint (`txid_vout` or `txid.vout`). */
function isOutpointId(value: string): boolean {
	const parts = value.split(/[._]/)
	return parts.length === 2 && parts[0].length === 64 && /^\d+$/.test(parts[1])
}

/**
 * BSV-21 vs BSV-20 share MIME `application/bsv-20`.
 * BSV-21 identity is `id` (deploy outpoint) / indexer `bsv21:`.
 * BSV-20 identity is `tick`.
 */
export function isBsv21Output(out: IndexedOutput): boolean {
	const events = out.events ?? []
	if (events.some((e) => e.startsWith('bsv21:'))) return true
	if (asRecord(asRecord(out.data)?.bsv21)) return true
	const json = inscriptionJson(out)
	const id = asString(json?.id)
	if (id && isOutpointId(id)) return true
	const op = asString(json?.op)?.toLowerCase()
	return op === 'auth' || (op?.startsWith('deploy+') ?? false)
}

export function isBsv20Output(out: IndexedOutput): boolean {
	if (isBsv21Output(out)) return false
	const events = out.events ?? []
	if (getEvent(events, 'tick:')) return true
	if (asString(asRecord(asRecord(out.data)?.bsv20)?.tick)) return true
	return Boolean(asString(inscriptionJson(out)?.tick))
}

function isTokenMime(out: IndexedOutput): boolean {
	return (out.events ?? []).includes('type:application/bsv-20')
}

/** True when an indexed output is an OrdLock marketplace listing. */
export function isListedOutput(out: IndexedOutput): boolean {
	const events = out.events ?? []
	if (events.includes('ordlock') || events.some((e) => e.startsWith('list:'))) {
		return true
	}
	const data = out.data
	return Boolean(data && typeof data === 'object' && data.ordlock != null)
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
	let synced = false
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
		} else if (event.type === 'error') {
			throw event.error
		} else if (event.type === 'done') {
			synced = true
			break
		}
	}
	if (!synced)
		throw new Error('Address sync ended before completion. Retry scanning.')

	// Phase 2: Search for all unspent outputs
	onProgress?.({ phase: 'search', detail: 'Searching for assets...' })
	const allOutputs =
		(await services.txo.search(`own:${address}`, {
			unspent: true,
			events: true,
			tags: ['ordlock', 'insc', 'bsv20', 'bsv21'],
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
		listings: allResults.flatMap((r) => r.listings),
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
	const listings: IndexedOutput[] = []

	for (const out of outputs) {
		const events = out.events ?? []
		const sats = out.satoshis ?? 0

		if (isListedOutput(out)) listings.push(out)

		if (isBsv21Output(out)) {
			bsv21Raw.push(out)
			continue
		}

		if (events.some((e) => e.startsWith('lock:'))) {
			locked.push(out)
			continue
		}

		if (isBsv20Output(out) || isTokenMime(out)) {
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
		listings,
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

		const amounts = new Map<string, string>()

		if (isActive) {
			try {
				const validated = await services.bsv21.validateOutputs(
					tokenId,
					outs.map((o) => o.outpoint),
					{ unspent: true },
				)
				for (const v of validated) {
					const bsv21 = v.data?.bsv21 as { amt?: string } | undefined
					const amt = bsv21?.amt ?? parseBsv21Amount(v)
					if (amt) amounts.set(v.outpoint, amt)
				}
			} catch {
				// Overlay is advisory. Inscription amounts still sweep.
			}
		}

		for (const out of outs) {
			if (amounts.has(out.outpoint)) continue
			const amt = parseBsv21Amount(out)
			if (amt) amounts.set(out.outpoint, amt)
		}

		const outputs = outs.filter((o) => amounts.has(o.outpoint))
		let totalAmount = 0n
		for (const amt of amounts.values()) totalAmount += BigInt(amt)

		balances.push({
			tokenId,
			symbol: detail?.token?.sym,
			decimals: Number(detail?.token?.dec ?? 0),
			icon: detail?.token?.icon,
			totalAmount,
			outputs,
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

/** BSV-21 amt from overlay data, events, or inscription JSON. */
export function parseBsv21Amount(out: IndexedOutput): string | undefined {
	const events = out.events ?? []
	const data = asRecord(out.data)
	const bsv21 = asRecord(data?.bsv21)
	const json = asRecord(asRecord(data?.insc)?.json)
	const amount =
		asString(bsv21?.amt) ?? asString(json?.amt) ?? getEvent(events, 'amt:')
	if (!amount) return undefined
	try {
		if (BigInt(amount) <= 0n) return undefined
	} catch {
		return undefined
	}
	return amount
}

/** Listed OrdLocks cancel one-per-tx; unlisted of a class may share a spend. */
export function partitionListed<T extends IndexedOutput>(
	outputs: T[],
): { listed: T[]; unlisted: T[] } {
	const listed: T[] = []
	const unlisted: T[] = []
	for (const out of outputs) {
		if (isListedOutput(out)) listed.push(out)
		else unlisted.push(out)
	}
	return { listed, unlisted }
}

/** Listed BSV-21 cancels are each their own tx so one invalid listing cannot sink the rest. */
export function bsv21SweepBatches<T extends IndexedOutput>(
	outputs: T[],
): T[][] {
	const { listed, unlisted } = partitionListed(outputs)
	const batches = listed.map((out) => [out])
	if (unlisted.length) batches.push(unlisted)
	return batches
}

/** Tick / amount / decimals from indexer events or inscription JSON. */
export function parseBsv20Token(
	out: IndexedOutput,
): { tick: string; amount: string; decimals: number } | undefined {
	const events = out.events ?? []
	const data = asRecord(out.data)
	const bsv20 = asRecord(data?.bsv20)
	const json = asRecord(asRecord(data?.insc)?.json)
	const tick =
		getEvent(events, 'tick:') ?? asString(bsv20?.tick) ?? asString(json?.tick)
	const amount =
		getEvent(events, 'amt:') ?? asString(bsv20?.amt) ?? asString(json?.amt)
	if (!tick || !amount) return undefined
	try {
		if (BigInt(amount) <= 0n) return undefined
	} catch {
		return undefined
	}
	const decRaw =
		asString(bsv20?.dec) ??
		asString(json?.dec) ??
		getEvent(events, 'dec:') ??
		'0'
	const decimals = Number(decRaw)
	return {
		tick,
		amount,
		decimals: Number.isFinite(decimals) ? decimals : 0,
	}
}

/** Group BSV-20 UTXOs by ticker. Outputs with no parseable tick/amt are omitted. */
export function groupBsv20Tokens(outputs: IndexedOutput[]): Bsv20Balance[] {
	const groups = new Map<string, Bsv20Balance>()
	for (const out of outputs) {
		const parsed = parseBsv20Token(out)
		if (!parsed) continue
		let group = groups.get(parsed.tick)
		if (!group) {
			group = {
				tick: parsed.tick,
				decimals: parsed.decimals,
				totalAmount: 0n,
				outputs: [],
				amounts: new Map(),
			}
			groups.set(parsed.tick, group)
		}
		group.outputs.push(out)
		group.amounts.set(out.outpoint, parsed.amount)
		group.totalAmount += BigInt(parsed.amount)
	}
	return [...groups.values()]
}
