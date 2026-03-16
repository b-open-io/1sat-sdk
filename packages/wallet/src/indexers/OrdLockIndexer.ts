import { OrdLock } from '@1sat/templates'
import {
	type IndexSummary,
	Indexer,
	type ParseContext,
	type ParseResult,
	type Txo,
} from '@1sat/types'

export class Listing {
	constructor(
		public payout: number[] = [],
		public price = 0n,
	) {}
}

export class OrdLockIndexer extends Indexer {
	tag = 'list'
	name = 'Listings'

	constructor(
		public owners = new Set<string>(),
		public network: 'mainnet' | 'testnet' = 'mainnet',
	) {
		super(owners, network)
	}

	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const lockingScript = txo.output.lockingScript

		const decoded = OrdLock.decode(lockingScript, this.network === 'mainnet')
		if (!decoded) return

		const listing = new Listing(decoded.payout, decoded.price)

		return {
			data: listing,
			tags: [`list:${listing.price}`],
			owner: decoded.seller,
			protocol: 'basket insertion', // OrdLock script requires manual unlock
		}
	}

	async summarize(ctx: ParseContext): Promise<IndexSummary | undefined> {
		// Check if any input was spending a listing
		for (const [vin, spend] of ctx.spends.entries()) {
			if (spend.data[this.tag]) {
				const unlockingScript = ctx.tx.inputs[vin].unlockingScript
				if (unlockingScript && OrdLock.isPurchase(unlockingScript)) {
					// Purchased via ordlock contract
					return { amount: 1 }
				}
				// Cancelled/reclaimed by owner
				return { amount: 0 }
			}
		}

		// Check if any output is creating a listing
		for (const txo of ctx.txos) {
			if (txo.data[this.tag]) {
				return { amount: -1 }
			}
		}
	}

	serialize(listing: Listing): string {
		return JSON.stringify({
			payout: listing.payout,
			price: listing.price.toString(10),
		})
	}

	deserialize(str: string): Listing {
		const obj = JSON.parse(str)
		return new Listing(obj.payout, BigInt(obj.price))
	}
}
