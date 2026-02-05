import {
	type IndexSummary,
	Indexer,
	type ParseContext,
	type ParseResult,
	type Txo,
} from '@1sat/types'
import { parseAddress } from './parseAddress'

/**
 * FundIndexer identifies P2PKH outputs to owned addresses.
 * These are standard "funding" UTXOs that can be spent normally.
 *
 * Data structure: string (address)
 *
 * Basket: 'fund'
 * Tags: None
 */
export class FundIndexer extends Indexer {
	tag = 'fund'
	name = 'Funds'

	constructor(
		public owners = new Set<string>(),
		public network: 'mainnet' | 'testnet' = 'mainnet',
	) {
		super(owners, network)
	}

	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const script = txo.output.lockingScript
		const satoshis = BigInt(txo.output.satoshis || 0)
		const address = parseAddress(script, 0, this.network)
		if (satoshis < 2n) return

		return {
			data: address,
			tags: [],
			owner: address,
			basket: 'fund',
		}
	}

	async summarize(ctx: ParseContext): Promise<IndexSummary | undefined> {
		let satsOut = 0n
		let satsIn = 0n

		// Calculate satoshis spent from our addresses (inputs)
		for (const input of ctx.tx.inputs) {
			if (!input.sourceTransaction) {
				// If we don't have source transaction data, we can't determine balance change
				return
			}

			const sourceOutput =
				input.sourceTransaction.outputs[input.sourceOutputIndex]
			const address = parseAddress(sourceOutput.lockingScript, 0, this.network)

			if (this.owners.has(address)) {
				satsOut += BigInt(sourceOutput.satoshis || 0)
			}
		}

		// Calculate satoshis received to our addresses (outputs)
		satsIn = ctx.txos.reduce((acc, txo) => {
			if (!txo.data[this.tag]) return acc
			const satoshis = BigInt(txo.output.satoshis || 0)
			return acc + (txo.owner && this.owners.has(txo.owner) ? satoshis : 0n)
		}, 0n)

		const balance = Number(satsIn - satsOut)
		if (balance) {
			return {
				amount: balance,
			}
		}
	}
}
