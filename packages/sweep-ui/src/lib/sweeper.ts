import {
	type Bsv20Balance,
	SWEEP_BATCH_SIZE,
	createContext,
	prepareSweepInputs,
	sweepBsv,
	sweepBsv20,
	sweepBsv21,
	sweepOrdinals,
} from '@1sat/actions'
import type { IndexedOutput } from '@1sat/types'
import type { PrivateKey, WalletInterface } from '@bsv/sdk'
import type { TokenBalance } from './scanner'
import { getServices } from './services'

export { SWEEP_BATCH_SIZE }

export interface SweepResult {
	bsvTxid?: string
	ordinalTxids: string[]
	bsv21Txids: string[]
	errors: string[]
	/** Outpoints successfully swept (ordinals/OpNS, including listed OrdLocks). */
	sweptOutpoints: string[]
}

function getOwner(output: IndexedOutput): string | undefined {
	return output.events?.find((e) => e.startsWith('own:'))?.slice(4)
}

function buildKeys(
	outputs: IndexedOutput[],
	keyMap: Map<string, PrivateKey>,
	inputs: Pick<IndexedOutput, 'outpoint'>[] = outputs,
): PrivateKey[] {
	const owners = new Map(
		outputs.map((output) => [output.outpoint, getOwner(output)]),
	)
	return inputs.map(({ outpoint }) => {
		const owner = owners.get(outpoint)
		const key = owner ? keyMap.get(owner) : undefined
		if (!key) throw new Error(`No key for output ${outpoint} (owner: ${owner})`)
		return key
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
}): Promise<SweepResult> {
	const { wallet, keys, funding, ordinals, amount, onProgress } = params
	const ctx = createContext(wallet, { services: getServices(), chain: 'main' })

	const result: SweepResult = {
		ordinalTxids: [],
		bsv21Txids: [],
		errors: [],
		sweptOutpoints: [],
	}

	if (funding.length > 0) {
		onProgress(`Sweeping ${funding.length} BSV UTXOs...`)
		try {
			const inputs = await prepareSweepInputs(ctx, funding)
			const bsvResult = await sweepBsv.execute(ctx, {
				inputs,
				keys: buildKeys(funding, keys, inputs),
				amount,
			})
			if (bsvResult.error) throw new Error(bsvResult.error)
			const txid = bsvResult.txid?.trim()
			if (!txid) throw new Error('Sweep returned no transaction ID')
			result.bsvTxid = txid
		} catch (e) {
			result.errors.push(`BSV: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	if (ordinals.length > 0) {
		const batches = chunk(ordinals, SWEEP_BATCH_SIZE)
		for (let b = 0; b < batches.length; b++) {
			const batch = batches[b]
			const from = b * SWEEP_BATCH_SIZE + 1
			const to = b * SWEEP_BATCH_SIZE + batch.length
			onProgress(
				batches.length === 1
					? `Sweeping ${batch.length} ordinal${batch.length !== 1 ? 's' : ''}...`
					: `Sweeping ordinals ${from}–${to} of ${ordinals.length} (batch ${b + 1}/${batches.length})...`,
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
				result.ordinalTxids.push(txid)
				result.sweptOutpoints.push(...batch.map((o) => o.outpoint))
			} catch (e) {
				result.errors.push(
					`Ordinals batch ${b + 1}/${batches.length}: ${e instanceof Error ? e.message : String(e)}`,
				)
				break
			}
		}
	}

	onProgress(
		result.errors.length > 0 ? 'Sweep stopped with errors' : 'Sweep complete',
	)
	return result
}

/**
 * Sweep a single BSV-21 token into the connected wallet.
 * Each token requires its own transaction since all inputs must share a tokenId.
 */
export async function sweepBsv21Token(params: {
	wallet: WalletInterface
	keys: Map<string, PrivateKey>
	token: TokenBalance
	onProgress: (stage: string) => void
}): Promise<{ txid?: string; error?: string }> {
	const { wallet, keys, token, onProgress } = params
	const ctx = createContext(wallet, { services: getServices(), chain: 'main' })

	onProgress(`Sweeping ${token.symbol ?? token.tokenId.slice(0, 8)}...`)

	try {
		const sweepInputs = await prepareSweepInputs(ctx, token.outputs)
		const sweepInputMap = new Map(sweepInputs.map((s) => [s.outpoint, s]))

		const inputs = token.outputs.map((out) => {
			const base = sweepInputMap.get(out.outpoint)
			if (!base) throw new Error(`Missing sweep input for ${out.outpoint}`)
			return {
				...base,
				tokenId: token.tokenId,
				amount: token.amounts.get(out.outpoint) ?? '0',
			}
		})

		const tokenKeys = buildKeys(token.outputs, keys)

		const result = await sweepBsv21.execute(ctx, { inputs, keys: tokenKeys })
		if (result.error) return { error: result.error }
		return { txid: result.txid }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}

/** Sweep one BSV-20 ticker into the connected wallet. */
export async function sweepBsv20Token(params: {
	wallet: WalletInterface
	keys: Map<string, PrivateKey>
	token: Bsv20Balance
	onProgress: (stage: string) => void
}): Promise<{ txid?: string; error?: string }> {
	const { wallet, keys, token, onProgress } = params
	const ctx = createContext(wallet, { services: getServices(), chain: 'main' })

	onProgress(`Sweeping ${token.tick}...`)

	try {
		const sweepInputs = await prepareSweepInputs(ctx, token.outputs)
		const sweepInputMap = new Map(sweepInputs.map((s) => [s.outpoint, s]))

		const inputs = token.outputs.map((out) => {
			const base = sweepInputMap.get(out.outpoint)
			if (!base) throw new Error(`Missing sweep input for ${out.outpoint}`)
			return {
				...base,
				tick: token.tick,
				amount: token.amounts.get(out.outpoint) ?? '0',
			}
		})

		const result = await sweepBsv20.execute(ctx, {
			inputs,
			keys: buildKeys(token.outputs, keys),
		})
		if (result.error) return { error: result.error }
		return { txid: result.txid }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}
