/**
 * Sweep Scan Module
 *
 * Scans an address for UTXOs using the owner sync service and categorizes them
 * into funding, ordinals, and BSV-21 tokens.
 */

import type { OneSatServices } from '@1sat/client'
import type { IndexedOutput } from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import type { SweepBsv21Input, SweepInput } from './types'

/** RUN protocol OP_RETURN prefix: OP_FALSE OP_RETURN OP_PUSH3 "run" */
const RUN_PREFIX = Uint8Array.from([0x00, 0x6a, 0x03, 0x72, 0x75, 0x6e])

/** A group of BSV-21 token UTXOs with the same tokenId */
export interface TokenBalance {
	tokenId: string
	symbol?: string
	decimals: number
	totalAmount: string
	inputs: SweepBsv21Input[]
}

/** Categorized UTXOs from scanning an address */
export interface ScanResult {
	address: string
	funding: SweepInput[]
	ordinals: SweepInput[]
	bsv21Tokens: TokenBalance[]
	run: SweepInput[]
	totalFundingSats: number
}

/**
 * Scan an address for UTXOs and categorize them into funding, ordinals, and BSV-21 tokens.
 * Uses the owner sync service to fetch unspent outputs.
 */
export async function scanAddressUtxos(
	services: OneSatServices,
	address: string,
): Promise<ScanResult> {
	const utxos: IndexedOutput[] = []

	for await (const event of services.owner.getTxos(address, {
		unspent: true,
		sats: true,
	})) {
		if (event.type === 'txo') {
			utxos.push(event.data)
		} else if (event.type === 'error') {
			throw event.error
		}
	}

	const funding: SweepInput[] = []
	const ordinals: SweepInput[] = []
	const bsv21Raw: Array<{
		input: SweepBsv21Input
		sym?: string
		dec?: number
	}> = []

	for (const utxo of utxos) {
		const outpoint = utxo.outpoint
		const satoshis = utxo.satoshis ?? 0
		const data = utxo.data as Record<string, unknown> | undefined

		// lockingScript resolved later via BEEF in prepareSweepBsv
		const base: SweepInput = {
			outpoint,
			satoshis,
			lockingScript: '',
		}

		if (data?.bsv21) {
			const bsv21 = data.bsv21 as Record<string, unknown>
			const tokenId = (bsv21.id as string) || ''
			const amount = (bsv21.amt as string) || '0'
			bsv21Raw.push({
				input: { ...base, tokenId, amount },
				sym: bsv21.sym as string | undefined,
				dec: (bsv21.dec as number) ?? 0,
			})
		} else if (data?.insc || data?.origin) {
			ordinals.push(base)
		} else {
			funding.push(base)
		}
	}

	// Group BSV-21 tokens by tokenId
	const tokenGroups = new Map<
		string,
		{ inputs: SweepBsv21Input[]; sym?: string; dec: number }
	>()
	for (const { input, sym, dec } of bsv21Raw) {
		let group = tokenGroups.get(input.tokenId)
		if (!group) {
			group = { inputs: [], sym, dec: dec ?? 0 }
			tokenGroups.set(input.tokenId, group)
		}
		group.inputs.push(input)
	}

	const bsv21Tokens: TokenBalance[] = []
	for (const [tokenId, group] of tokenGroups) {
		let totalAmount = BigInt(0)
		for (const inp of group.inputs) {
			totalAmount += BigInt(inp.amount)
		}
		bsv21Tokens.push({
			tokenId,
			symbol: group.sym,
			decimals: group.dec,
			totalAmount: totalAmount.toString(),
			inputs: group.inputs,
		})
	}

	// Check funding outputs for RUN token transactions
	const run: SweepInput[] = []
	const cleanFunding: SweepInput[] = []

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

	const totalFundingSats = cleanFunding.reduce((sum, f) => sum + f.satoshis, 0)

	return { address, funding: cleanFunding, ordinals, bsv21Tokens, run, totalFundingSats }
}

/**
 * Check source transactions for the RUN protocol OP_RETURN pattern.
 * Returns the set of txids that contain a RUN OP_RETURN output.
 */
async function detectRunTransactions(
	services: OneSatServices,
	funding: SweepInput[],
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

/** Check if a locking script starts with the RUN OP_RETURN prefix */
function hasRunPrefix(script: number[]): boolean {
	if (script.length < RUN_PREFIX.length) return false
	for (let i = 0; i < RUN_PREFIX.length; i++) {
		if (script[i] !== RUN_PREFIX[i]) return false
	}
	return true
}
