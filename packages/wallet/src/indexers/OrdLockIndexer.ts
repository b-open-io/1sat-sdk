import { OrdLock, OrdLockV2 } from '@1sat/templates'
import {
	type IndexSummary,
	Indexer,
	ORDLOCK_V2_TAG,
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
		const mainnet = this.network === 'mainnet'

		// v2 (tag-output binding) first, then legacy v1. The version tag must
		// match what `sellOrdinal` / `sellOpns` emit for the same script, so a
		// listing that arrived by sync looks like one we created: v1 purge
		// paths key on `ordlock` and must not see v2 rows.
		const v2 = OrdLockV2.decode(lockingScript, mainnet)
		const decoded = v2 ?? OrdLock.decode(lockingScript, mainnet)
		if (!decoded) return

		const listing = new Listing(decoded.payout, decoded.price)

		return {
			data: listing,
			tags: [v2 ? ORDLOCK_V2_TAG : 'ordlock', `price:${listing.price}`],
			owner: decoded.seller,
			protocol: 'basket insertion', // OrdLock script requires manual unlock
		}
	}

	async summarize(ctx: ParseContext): Promise<IndexSummary | undefined> {
		// Check if any input was spending a listing
		for (const [vin, spend] of ctx.spends.entries()) {
			if (spend.data[this.tag]) {
				const unlockingScript = ctx.tx.inputs[vin].unlockingScript
				if (
					unlockingScript &&
					(OrdLockV2.isPurchase(unlockingScript) ||
						OrdLock.isPurchase(unlockingScript))
				) {
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
