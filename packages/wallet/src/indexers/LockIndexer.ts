import { Lock } from '@1sat/templates'
import {
	type IndexSummary,
	Indexer,
	type ParseContext,
	type ParseResult,
	type Txo,
} from '@1sat/types'

export interface LockData {
	until: number
}

export class LockIndexer extends Indexer {
	tag = 'lock'
	name = 'Locks'

	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const lockingScript = txo.output.lockingScript

		const decoded = Lock.decode(lockingScript, this.network === 'mainnet')
		if (!decoded) return

		const tags: string[] = []
		if (this.owners.has(decoded.address)) {
			tags.push(`lock:until:${decoded.until}`)
		}

		return {
			data: { until: decoded.until } as LockData,
			tags,
			owner: decoded.address,
			basket: 'lock',
			protocol: 'basket insertion', // Custom Lock script requires manual unlock
		}
	}

	async summarize(ctx: ParseContext): Promise<IndexSummary | undefined> {
		let locksOut = 0n
		for (const spend of ctx.spends) {
			if (spend.data[this.tag]) {
				const satoshis = BigInt(spend.output.satoshis || 0)
				locksOut += spend.owner && this.owners.has(spend.owner) ? satoshis : 0n
			}
		}

		let locksIn = 0n
		for (const txo of ctx.txos) {
			if (txo.data[this.tag]) {
				const satoshis = BigInt(txo.output.satoshis || 0)
				locksIn += txo.owner && this.owners.has(txo.owner) ? satoshis : 0n
			}
		}

		const balance = Number(locksIn - locksOut)
		if (balance) {
			return { amount: balance }
		}
	}
}
