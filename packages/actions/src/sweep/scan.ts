/**
 * Sweep Scan Module
 *
 * Pure HTTP function to scan an address for UTXOs and categorize them.
 * No OneSatContext dependency — can be used standalone by any client.
 */

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
 * Uses the GorillaPool API to fetch unspent outputs.
 */
export async function scanAddressUtxos(address: string): Promise<ScanResult> {
	const res = await fetch(
		`https://ordinals.gorillapool.io/api/txos/address/${address}/unspent?limit=1000`,
	)
	if (!res.ok) {
		throw new Error(`GorillaPool API error: ${res.status}`)
	}

	const utxos = (await res.json()) as Array<Record<string, unknown>>

	const funding: SweepInput[] = []
	const ordinals: SweepInput[] = []
	const bsv21Raw: Array<{
		input: SweepBsv21Input
		sym?: string
		dec?: number
	}> = []

	for (const utxo of utxos) {
		const txid = utxo.txid as string
		const vout = utxo.vout as number
		const outpoint = `${txid}_${vout}`
		const satoshis = (utxo.satoshis as number) || 0
		const script = (utxo.script as string) || ''
		const origin = utxo.origin as Record<string, unknown> | undefined
		const originData = origin?.data as Record<string, unknown> | undefined

		const base: SweepInput = {
			outpoint,
			satoshis,
			lockingScript: script,
		}

		if (originData?.bsv21) {
			const bsv21 = originData.bsv21 as Record<string, unknown>
			const tokenId = (bsv21.id as string) || ''
			const amount = (bsv21.amt as string) || '0'
			bsv21Raw.push({
				input: { ...base, tokenId, amount },
				sym: bsv21.sym as string | undefined,
				dec: (bsv21.dec as number) ?? 0,
			})
		} else if (originData?.insc || origin?.outpoint) {
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
