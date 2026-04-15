import { Indexer, type ParseResult, type Txo } from '@1sat/types'
import { Cosign } from '@bopen-io/templates'

export interface CosignData {
	address: string
	cosigner: string
}

export class CosignIndexer extends Indexer {
	tag = 'cosign'
	name = 'Cosign'

	constructor(
		public owners = new Set<string>(),
		public network: 'mainnet' | 'testnet' = 'mainnet',
	) {
		super(owners, network)
	}

	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const lockingScript = txo.output.lockingScript

		// Use template decode
		// biome-ignore lint/suspicious/noExplicitAny: cross-version @bsv/sdk Script type mismatch
		const decoded = Cosign.decode(
			lockingScript as any,
			this.network === 'mainnet',
		)
		if (!decoded) return

		return {
			data: decoded as CosignData,
			tags: [],
			owner: decoded.address,
			protocol: 'basket insertion', // Cosign script requires cosigner signature
		}
	}
}
