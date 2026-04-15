import {
	createContext,
	prepareSweepInputs,
	sweepBsv,
	sweepBsv21,
	sweepOrdinals,
} from '@1sat/actions'
import type { IndexedOutput } from '@1sat/types'
import type { PrivateKey, WalletInterface } from '@bsv/sdk'
import type { TokenBalance } from './scanner'
import { getServices } from './services'

export interface SweepResult {
	bsvTxid?: string
	ordinalTxids: string[]
	bsv21Txids: string[]
	errors: string[]
}

function getOwner(output: IndexedOutput): string | undefined {
	return output.events?.find((e) => e.startsWith('own:'))?.slice(4)
}

function buildKeys(
	outputs: IndexedOutput[],
	keyMap: Map<string, PrivateKey>,
): PrivateKey[] {
	return outputs.map((output) => {
		const owner = getOwner(output)
		const key = owner ? keyMap.get(owner) : undefined
		if (!key)
			throw new Error(`No key for output ${output.outpoint} (owner: ${owner})`)
		return key
	})
}

/**
 * Sweep BSV funding and ordinals into the connected wallet.
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
	}

	if (funding.length > 0) {
		onProgress(`Sweeping ${funding.length} BSV UTXOs...`)
		try {
			const inputs = await prepareSweepInputs(ctx, funding)
			const bsvResult = await sweepBsv.execute(ctx, {
				inputs,
				keys: buildKeys(funding, keys),
				amount,
			})
			if (bsvResult.error) result.errors.push(`BSV: ${bsvResult.error}`)
			else if (bsvResult.txid) result.bsvTxid = bsvResult.txid
		} catch (e) {
			result.errors.push(`BSV: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	if (ordinals.length > 0) {
		onProgress(`Sweeping ${ordinals.length} ordinals...`)
		try {
			const inputs = await prepareSweepInputs(ctx, ordinals)
			const ordResult = await sweepOrdinals.execute(ctx, {
				inputs,
				keys: buildKeys(ordinals, keys),
			})
			if (ordResult.error) result.errors.push(`Ordinals: ${ordResult.error}`)
			else if (ordResult.txid) result.ordinalTxids.push(ordResult.txid)
		} catch (e) {
			result.errors.push(
				`Ordinals: ${e instanceof Error ? e.message : String(e)}`,
			)
		}
	}

	onProgress('Sweep complete')
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
		const inputs = token.outputs.map((out) => ({
			outpoint: out.outpoint,
			tokenId: token.tokenId,
			amount: token.amounts.get(out.outpoint) ?? '0',
		}))

		const tokenKeys = buildKeys(token.outputs, keys)

		const result = await sweepBsv21.execute(ctx, { inputs, keys: tokenKeys })
		if (result.error) return { error: result.error }
		return { txid: result.txid }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}
