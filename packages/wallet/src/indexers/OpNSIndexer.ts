import { Indexer, OPNS_BASKET, type ParseResult, type Txo } from '@1sat/types'
import { Utils } from '@bsv/sdk'
import type { Inscription } from './InscriptionIndexer'

export class OpNSIndexer extends Indexer {
	tag = 'opns'
	name = 'OpNS'

	constructor(
		public owners = new Set<string>(),
		public network: 'mainnet' | 'testnet' = 'mainnet',
	) {
		super(owners, network)
	}

	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const insc = txo.data.insc?.data as Inscription
		if (insc?.file?.type !== 'application/op-ns') return

		const tags: string[] = []

		// Extract name from inscription content
		if (insc.file?.content && txo.owner && this.owners.has(txo.owner)) {
			try {
				const content = Utils.toUTF8(insc.file.content)
				const data = JSON.parse(content)
				if (data.name) {
					tags.push(`name:${data.name}`)
				}
			} catch {
				// Invalid JSON or missing name field
			}
		}

		// TODO: Add validation against OpNS server (infrastructure not ready yet)

		return {
			data: insc,
			tags,
			basket: OPNS_BASKET,
		}
	}
}
