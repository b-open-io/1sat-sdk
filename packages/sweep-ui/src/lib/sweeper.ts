import {
	type Bsv20Balance,
	SWEEP_BATCH_SIZE,
	bsv20SweepBatches,
	bsv21SweepBatches,
	createContext,
	groupBsv20Tokens,
	isListedOutput,
	prepareSweepInputs,
	sweepBsv,
	sweepBsv20,
	sweepBsv21,
	sweepOrdinals,
} from '@1sat/actions'
import type { IndexedOutput } from '@1sat/types'
import { formatOutpoint, parseOutpoint } from '@1sat/utils'
import type { PrivateKey, WalletInterface } from '@bsv/sdk'
import type { ScannedAssets, TokenBalance } from './scanner'
import { getServices } from './services'

export { SWEEP_BATCH_SIZE }

/** Transferable sweep classes, same order and names as `1sat sweep import`. */
export type SweepClass = 'bsv' | 'ordinals' | 'opns' | 'bsv20' | 'bsv21'

/**
 * Per-class sweep selection. Empty sets sweep nothing in that class;
 * omit `selection` entirely to sweep every class (previous behavior).
 */
export interface SweepClassSelection {
	sweepBsv: boolean
	/** Ordinals-class outpoints (`ordinals`, listed OrdLocks included). */
	ordinalOutpoints: Set<string>
	/** OpNS-class outpoints. */
	opnsOutpoints: Set<string>
	/** BSV-20 ticks. */
	bsv20Ticks: Set<string>
	/** BSV-21 tokenIds. */
	bsv21TokenIds: Set<string>
}

/** Select every scanned asset, the default when no selection is passed. */
export function selectAllSweepClasses(
	assets: ScannedAssets,
): SweepClassSelection {
	return {
		sweepBsv: assets.funding.length > 0,
		ordinalOutpoints: new Set(assets.ordinals.map((o) => o.outpoint)),
		opnsOutpoints: new Set(assets.opnsNames.map((o) => o.outpoint)),
		bsv20Ticks: new Set(
			groupBsv20Tokens(assets.bsv20Tokens).map((t) => t.tick),
		),
		bsv21TokenIds: new Set(
			assets.bsv21Tokens
				.filter((t) => t.outputs.length > 0)
				.map((t) => t.tokenId),
		),
	}
}

/** Per-step receipt, emitted via `onResult` as each class/batch completes. */
export interface SweepStepResult {
	sweepClass: SweepClass
	label: string
	txid?: string
	error?: string
}

export interface SweepResult {
	bsvTxid?: string
	ordinalTxids: string[]
	bsv20Txids: string[]
	bsv21Txids: string[]
	errors: string[]
	/** Outpoints successfully swept (ordinals/OpNS, including listed OrdLocks). */
	sweptOutpoints: string[]
	/** Swept outpoints that were marketplace listings canceled into the wallet. */
	cancelledListings: string[]
}

/**
 * Canonical `txid.vout` form. Indexer, overlay, and SDK inputs mix `.` and
 * `_` separators; amount maps and retry sets must compare canonically.
 */
function normalizeOutpoint(outpoint: string): string {
	const { txid, vout } = parseOutpoint(outpoint)
	return formatOutpoint(txid, vout)
}

function buildKeys(
	outputs: IndexedOutput[],
	keyMap: Map<string, PrivateKey>,
	inputs: Pick<IndexedOutput, 'outpoint'>[] = outputs,
): PrivateKey[] {
	const byOutpoint = new Map(
		outputs.map((output) => [normalizeOutpoint(output.outpoint), output]),
	)
	return inputs.map(({ outpoint }) => {
		const output = byOutpoint.get(normalizeOutpoint(outpoint))
		const owners = new Set(
			(output?.events ?? [])
				.filter((e) => e.startsWith('own:'))
				.map((e) => e.slice(4)),
		)
		// Fail closed: zero or ambiguous owner matches must not sign.
		const matches = [...owners].filter((owner) => keyMap.has(owner))
		if (matches.length !== 1)
			throw new Error(
				`No key for output ${outpoint} (owner: ${[...owners].join(',') || 'unknown'})`,
			)
		return keyMap.get(matches[0])!
	})
}

function chunk<T>(items: T[], size: number): T[][] {
	const batches: T[][] = []
	for (let i = 0; i < items.length; i += size) {
		batches.push(items.slice(i, i + size))
	}
	return batches
}

/**
 * Sweep BSV funding then ordinals into the connected wallet.
 * Same class order as `1sat sweep import` for these two classes.
 * Listed OrdLocks belong in `ordinals` and cancel in that spend.
 */
export async function executeSweep(params: {
	wallet: WalletInterface
	keys: Map<string, PrivateKey>
	funding: IndexedOutput[]
	ordinals: IndexedOutput[]
	amount?: number
	onProgress: (stage: string) => void
	/** Outpoints to skip; successes are added (canonical `txid.vout` form). */
	completed?: Set<string>
	signal?: AbortSignal
	onResult?: (result: SweepStepResult) => void
}): Promise<SweepResult> {
	const { wallet, keys, funding, ordinals, amount, onProgress } = params
	const ctx = createContext(wallet, { services: getServices(), chain: 'main' })

	const result: SweepResult = {
		ordinalTxids: [],
		bsv20Txids: [],
		bsv21Txids: [],
		errors: [],
		sweptOutpoints: [],
		cancelledListings: [],
	}

	const fundingStep = await sweepFundingStep({
		ctx,
		keys,
		funding,
		amount,
		completed: params.completed,
		signal: params.signal,
		onProgress,
		onResult: params.onResult,
	})
	if (fundingStep.bsvTxid) result.bsvTxid = fundingStep.bsvTxid
	if (fundingStep.error) result.errors.push(fundingStep.error)

	const ordinalBatches = await sweepOrdinalBatches({
		ctx,
		keys,
		ordinals,
		sweepClass: 'ordinals',
		completed: params.completed,
		signal: params.signal,
		onProgress,
		onResult: params.onResult,
	})
	result.ordinalTxids.push(...ordinalBatches.txids)
	result.sweptOutpoints.push(...ordinalBatches.swept)
	result.errors.push(...ordinalBatches.errors)
	result.cancelledListings.push(
		...cancelledIn(funding, fundingStep.swept),
		...cancelledIn(ordinals, ordinalBatches.swept),
	)

	onProgress(
		result.errors.length > 0 ? 'Sweep stopped with errors' : 'Sweep complete',
	)
	return result
}

function isCompleted(completed: Set<string> | undefined, outpoint: string) {
	if (!completed) return false
	return completed.has(normalizeOutpoint(outpoint))
}

/** Swept outpoints that were listings: every one canceled into the wallet. */
function cancelledIn(outputs: IndexedOutput[], swept: string[]): string[] {
	const done = new Set(swept.map(normalizeOutpoint))
	return outputs
		.filter((o) => done.has(normalizeOutpoint(o.outpoint)) && isListedOutput(o))
		.map((o) => o.outpoint)
}

function markCompleted(
	completed: Set<string> | undefined,
	outputs: Pick<IndexedOutput, 'outpoint'>[],
) {
	if (!completed) return
	for (const output of outputs)
		completed.add(normalizeOutpoint(output.outpoint))
}

async function sweepFundingStep(options: {
	ctx: ReturnType<typeof createContext>
	keys: Map<string, PrivateKey>
	funding: IndexedOutput[]
	amount?: number
	completed?: Set<string>
	signal?: AbortSignal
	onProgress: (stage: string) => void
	onResult?: (result: SweepStepResult) => void
}): Promise<{ bsvTxid?: string; error?: string; swept: string[] }> {
	const { ctx, keys, amount, completed, signal, onProgress, onResult } = options
	const pending = options.funding.filter(
		(o) => !isCompleted(completed, o.outpoint),
	)
	if (pending.length === 0) return { swept: [] }
	signal?.throwIfAborted()
	onProgress(`Sweeping ${pending.length} BSV UTXOs...`)
	try {
		const inputs = await prepareSweepInputs(ctx, pending)
		const bsvResult = await sweepBsv.execute(ctx, {
			inputs,
			keys: buildKeys(pending, keys, inputs),
			amount,
		})
		if (bsvResult.error) throw new Error(bsvResult.error)
		const txid = bsvResult.txid?.trim()
		if (!txid) throw new Error('Sweep returned no transaction ID')
		markCompleted(completed, pending)
		onResult?.({ sweepClass: 'bsv', label: 'BSV', txid })
		return { bsvTxid: txid, swept: pending.map((o) => o.outpoint) }
	} catch (e) {
		if (signal?.aborted) throw e
		const error = e instanceof Error ? e.message : String(e)
		onResult?.({ sweepClass: 'bsv', label: 'BSV', error })
		return { error: `BSV: ${error}`, swept: [] }
	}
}

const ORDINAL_CLASS_LABEL: Record<'ordinals' | 'opns', string> = {
	ordinals: 'Ordinals',
	opns: 'OpNS',
}

async function sweepOrdinalBatches(options: {
	ctx: ReturnType<typeof createContext>
	keys: Map<string, PrivateKey>
	ordinals: IndexedOutput[]
	sweepClass: 'ordinals' | 'opns'
	completed?: Set<string>
	signal?: AbortSignal
	onProgress: (stage: string) => void
	onResult?: (result: SweepStepResult) => void
}): Promise<{ txids: string[]; swept: string[]; errors: string[] }> {
	const { ctx, keys, sweepClass, completed, signal, onProgress, onResult } =
		options
	const label = ORDINAL_CLASS_LABEL[sweepClass]
	const singular = sweepClass === 'opns' ? 'OpNS name' : 'ordinal'
	const txids: string[] = []
	const swept: string[] = []
	const errors: string[] = []
	const pending = options.ordinals.filter(
		(o) => !isCompleted(completed, o.outpoint),
	)
	if (pending.length === 0) return { txids, swept, errors }

	const batches = chunk(pending, SWEEP_BATCH_SIZE)
	for (let b = 0; b < batches.length; b++) {
		signal?.throwIfAborted()
		const batch = batches[b]
		const from = b * SWEEP_BATCH_SIZE + 1
		const to = b * SWEEP_BATCH_SIZE + batch.length
		const batchLabel =
			batches.length === 1
				? label
				: `${label} (${from}–${to} of ${pending.length})`
		onProgress(
			batches.length === 1
				? `Sweeping ${batch.length} ${singular}${batch.length !== 1 ? 's' : ''}...`
				: `Sweeping ${singular}s ${from}–${to} of ${pending.length} (batch ${b + 1}/${batches.length})...`,
		)
		try {
			const inputs = await prepareSweepInputs(ctx, batch)
			const ordResult = await sweepOrdinals.execute(ctx, {
				inputs,
				keys: buildKeys(batch, keys, inputs),
			})
			if (ordResult.error) throw new Error(ordResult.error)
			const txid = ordResult.txid?.trim()
			if (!txid) throw new Error('Sweep returned no transaction ID')
			txids.push(txid)
			swept.push(...batch.map((o) => o.outpoint))
			markCompleted(completed, batch)
			onResult?.({ sweepClass, label: batchLabel, txid })
		} catch (e) {
			if (signal?.aborted) throw e
			const error = e instanceof Error ? e.message : String(e)
			errors.push(`${label} batch ${b + 1}/${batches.length}: ${error}`)
			onResult?.({ sweepClass, label: batchLabel, error })
			break
		}
	}
	return { txids, swept, errors }
}

/**
 * Sweep one BSV-21 token. Listed OrdLocks are each their own tx so one
 * invalid listing cannot sink the rest. Unlisted UTXOs of the token share a spend.
 */
export async function sweepBsv21Token(params: {
	wallet: WalletInterface
	keys: Map<string, PrivateKey>
	token: TokenBalance
	onProgress: (stage: string) => void
	signal?: AbortSignal
}): Promise<{
	txid?: string
	txids: string[]
	sweptOutpoints: string[]
	cancelledListings: string[]
	error?: string
}> {
	const { wallet, keys, token, onProgress, signal } = params
	const ctx = createContext(wallet, { services: getServices(), chain: 'main' })
	const txids: string[] = []
	const sweptOutpoints: string[] = []
	const errors: string[] = []
	const name = token.symbol ?? token.tokenId.slice(0, 8)
	const amounts = new Map(
		[...token.amounts].map(([outpoint, amount]) => [
			normalizeOutpoint(outpoint),
			amount,
		]),
	)

	for (const batch of bsv21SweepBatches(token.outputs)) {
		signal?.throwIfAborted()
		onProgress(`Sweeping ${name}...`)
		try {
			const sweepInputs = await prepareSweepInputs(ctx, batch)
			const sweepInputMap = new Map(sweepInputs.map((s) => [s.outpoint, s]))
			const inputs = batch.map((out) => {
				const base = sweepInputMap.get(out.outpoint)
				if (!base) throw new Error(`Missing sweep input for ${out.outpoint}`)
				return {
					...base,
					tokenId: token.tokenId,
					amount: amounts.get(normalizeOutpoint(out.outpoint)) ?? '0',
				}
			})
			const result = await sweepBsv21.execute(ctx, {
				inputs,
				keys: buildKeys(batch, keys),
			})
			if (result.error) errors.push(result.error)
			else if (result.txid) {
				txids.push(result.txid)
				sweptOutpoints.push(...batch.map((o) => o.outpoint))
			}
		} catch (e) {
			if (signal?.aborted) throw e
			errors.push(e instanceof Error ? e.message : String(e))
		}
	}

	return {
		txid: txids.at(-1),
		txids,
		sweptOutpoints,
		cancelledListings: cancelledIn(token.outputs, sweptOutpoints),
		error: errors[0],
	}
}

/**
 * Sweep one BSV-20 ticker into the connected wallet. BSV-20 needs no per-tx
 * overlay funding, so splitting listed outputs 1-per-tx is cheap — pass
 * `splitListed` so one invalid listing cannot sink the rest of the tick.
 */
export async function sweepBsv20Token(params: {
	wallet: WalletInterface
	keys: Map<string, PrivateKey>
	token: Bsv20Balance
	onProgress: (stage: string) => void
	signal?: AbortSignal
	splitListed?: boolean
}): Promise<{
	txid?: string
	txids: string[]
	sweptOutpoints: string[]
	cancelledListings: string[]
	error?: string
}> {
	const { wallet, keys, token, onProgress, signal, splitListed } = params
	const ctx = createContext(wallet, { services: getServices(), chain: 'main' })
	const txids: string[] = []
	const sweptOutpoints: string[] = []
	const errors: string[] = []
	const amounts = new Map(
		[...token.amounts].map(([outpoint, amount]) => [
			normalizeOutpoint(outpoint),
			amount,
		]),
	)
	const batches = splitListed
		? bsv20SweepBatches(token.outputs)
		: [token.outputs]

	for (const batch of batches) {
		signal?.throwIfAborted()
		onProgress(`Sweeping ${token.tick}...`)
		try {
			const sweepInputs = await prepareSweepInputs(ctx, batch)
			const sweepInputMap = new Map(sweepInputs.map((s) => [s.outpoint, s]))

			const inputs = batch.map((out) => {
				const base = sweepInputMap.get(out.outpoint)
				if (!base) throw new Error(`Missing sweep input for ${out.outpoint}`)
				return {
					...base,
					tick: token.tick,
					amount: amounts.get(normalizeOutpoint(out.outpoint)) ?? '0',
				}
			})

			const result = await sweepBsv20.execute(ctx, {
				inputs,
				keys: buildKeys(batch, keys),
			})
			if (result.error) errors.push(result.error)
			else if (result.txid) {
				txids.push(result.txid)
				sweptOutpoints.push(...batch.map((o) => o.outpoint))
			}
		} catch (e) {
			if (signal?.aborted) throw e
			errors.push(e instanceof Error ? e.message : String(e))
		}
	}

	return {
		txid: txids.at(-1),
		txids,
		sweptOutpoints,
		cancelledListings: cancelledIn(token.outputs, sweptOutpoints),
		error: errors[0],
	}
}

/**
 * Same class order as `1sat sweep import`: BSV, ordinals, OpNS, BSV-20,
 * BSV-21. Continues later classes if one fails. Pass `selection` to sweep
 * only chosen classes/items (like `1sat sweep --only/--skip`); pass
 * `completed` to skip already-swept outpoints and record new successes for
 * retry; pass `signal` to abort between steps. Listed OrdLocks stay in their
 * class and cancel in that spend.
 */
export async function sweepAllClasses(params: {
	wallet: WalletInterface
	keys: Map<string, PrivateKey>
	assets: ScannedAssets
	amount?: number
	onProgress: (stage: string) => void
	selection?: SweepClassSelection
	completed?: Set<string>
	signal?: AbortSignal
	onResult?: (result: SweepStepResult) => void
	/** Split listed BSV-20 outputs 1-per-tx so one bad listing cannot sink the tick. */
	splitListedBsv20?: boolean
}): Promise<SweepResult> {
	const { wallet, keys, assets, amount, onProgress } = params
	const selection = params.selection ?? selectAllSweepClasses(assets)
	const completed = params.completed
	const signal = params.signal
	const onResult = params.onResult
	const ctx = createContext(wallet, { services: getServices(), chain: 'main' })
	const result: SweepResult = {
		ordinalTxids: [],
		bsv20Txids: [],
		bsv21Txids: [],
		errors: [],
		sweptOutpoints: [],
		cancelledListings: [],
	}

	signal?.throwIfAborted()
	if (selection.sweepBsv) {
		const fundingStep = await sweepFundingStep({
			ctx,
			keys,
			funding: assets.funding,
			amount,
			completed,
			signal,
			onProgress,
			onResult,
		})
		if (fundingStep.bsvTxid) result.bsvTxid = fundingStep.bsvTxid
		if (fundingStep.error) result.errors.push(fundingStep.error)
		result.cancelledListings.push(
			...cancelledIn(assets.funding, fundingStep.swept),
		)
	}

	const inSelection = (outpoints: Set<string>) => (o: IndexedOutput) =>
		[...outpoints].some(
			(selected) =>
				normalizeOutpoint(selected) === normalizeOutpoint(o.outpoint),
		)

	for (const [sweepClass, outputs] of [
		[
			'ordinals',
			assets.ordinals.filter(inSelection(selection.ordinalOutpoints)),
		],
		['opns', assets.opnsNames.filter(inSelection(selection.opnsOutpoints))],
	] as const) {
		signal?.throwIfAborted()
		if (outputs.length === 0) continue
		const batches = await sweepOrdinalBatches({
			ctx,
			keys,
			ordinals: outputs,
			sweepClass,
			completed,
			signal,
			onProgress,
			onResult,
		})
		result.ordinalTxids.push(...batches.txids)
		result.sweptOutpoints.push(...batches.swept)
		result.errors.push(...batches.errors)
		result.cancelledListings.push(...cancelledIn(outputs, batches.swept))
	}

	for (const token of groupBsv20Tokens(assets.bsv20Tokens)) {
		signal?.throwIfAborted()
		if (!selection.bsv20Ticks.has(token.tick)) continue
		const outputs = token.outputs.filter(
			(o) => !isCompleted(completed, o.outpoint),
		)
		if (outputs.length === 0) continue
		const swept = await sweepBsv20Token({
			wallet,
			keys,
			token: { ...token, outputs },
			onProgress,
			signal,
			splitListed: params.splitListedBsv20,
		})
		markCompleted(
			completed,
			swept.sweptOutpoints.map((outpoint) => ({ outpoint })),
		)
		result.bsv20Txids.push(...swept.txids)
		result.cancelledListings.push(...cancelledIn(outputs, swept.sweptOutpoints))
		if (swept.error) {
			result.errors.push(`BSV-20 ${token.tick}: ${swept.error}`)
			onResult?.({ sweepClass: 'bsv20', label: token.tick, error: swept.error })
		} else if (swept.txid) {
			onResult?.({ sweepClass: 'bsv20', label: token.tick, txid: swept.txid })
		}
	}

	for (const token of assets.bsv21Tokens) {
		signal?.throwIfAborted()
		if (!selection.bsv21TokenIds.has(token.tokenId)) continue
		const outputs = token.outputs.filter(
			(o) => !isCompleted(completed, o.outpoint),
		)
		if (outputs.length === 0) continue
		const swept = await sweepBsv21Token({
			wallet,
			keys,
			token: { ...token, outputs },
			onProgress,
			signal,
		})
		markCompleted(
			completed,
			swept.sweptOutpoints.map((outpoint) => ({ outpoint })),
		)
		result.bsv21Txids.push(...swept.txids)
		result.cancelledListings.push(...cancelledIn(outputs, swept.sweptOutpoints))
		if (swept.error) {
			result.errors.push(
				`BSV-21 ${token.symbol ?? token.tokenId.slice(0, 8)}: ${swept.error}`,
			)
			onResult?.({
				sweepClass: 'bsv21',
				label: token.symbol ?? token.tokenId,
				error: swept.error,
			})
		} else if (swept.txid) {
			onResult?.({
				sweepClass: 'bsv21',
				label: token.symbol ?? token.tokenId,
				txid: swept.txid,
			})
		}
	}

	onProgress(
		result.errors.length > 0 ? 'Sweep stopped with errors' : 'Sweep complete',
	)
	return result
}
