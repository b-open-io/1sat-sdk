/**
 * Sweep Scan Module
 *
 * Scans an address for UTXOs using the owner sync service and categorizes them
 * into funding, ordinals, and BSV-21 tokens.
 */

import type { OneSatServices } from '@1sat/client'
import type { IndexedOutput } from '@1sat/types'
import type { SweepBsv21Input, SweepInput } from './types'

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

	const totalFundingSats = funding.reduce((sum, f) => sum + f.satoshis, 0)

	return { address, funding, ordinals, bsv21Tokens, totalFundingSats }
}
