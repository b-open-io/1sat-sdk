import {
	type IndexSummary,
	Indexer,
	OPNS_BASKET,
	type ParseContext,
	type ParseResult,
	type Txo,
} from '@1sat/types'
import { Utils } from '@bsv/sdk'
import type { Inscription } from './InscriptionIndexer.js'
import type { Origin } from './OriginIndexer.js'

const OPNS_TYPE = 'application/op-ns'

/** OpNS inscription body is the bare name string (UTF-8), never JSON. */
function nameFromContent(
	content: string | number[] | undefined,
): string | undefined {
	if (content == null) return undefined
	const raw = typeof content === 'string' ? content : Utils.toUTF8(content)
	const name = raw.trim().slice(0, 64)
	return name.length > 0 ? name : undefined
}

function baseType(type: string | undefined): string | undefined {
	if (!type) return undefined
	return type.split(';')[0].trim().toLowerCase()
}

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
		const insc = txo.data.insc?.data as Inscription | undefined
		if (baseType(insc?.file?.type) !== OPNS_TYPE) return

		const tags: string[] = []
		if (txo.owner && this.owners.has(txo.owner)) {
			const name = nameFromContent(insc?.file?.content)
			if (name) tags.push(`name:${name}`)
		}

		return {
			data: insc,
			tags,
			basket: OPNS_BASKET,
		}
	}

	/**
	 * Transfers resolve type/content in OriginIndexer.summarize (OrdFS).
	 * Tag name: here from origin.content (or in-script content already parsed).
	 */
	async summarize(
		ctx: ParseContext,
		_isBroadcasted?: boolean,
	): Promise<IndexSummary | undefined> {
		for (const txo of ctx.txos) {
			if (!txo.owner || !this.owners.has(txo.owner)) continue

			const origin = txo.data.origin?.data as Origin | undefined
			const insc = txo.data.insc?.data as Inscription | undefined
			const type =
				baseType(origin?.insc?.file?.type) ?? baseType(insc?.file?.type)
			if (type !== OPNS_TYPE) continue

			txo.basket = OPNS_BASKET

			const opns = txo.data.opns
			const tags = opns?.tags ? [...opns.tags] : []
			if (!tags.some((t) => t.startsWith('name:'))) {
				const name =
					nameFromContent(txo.data.origin?.content) ??
					nameFromContent(insc?.file?.content)
				if (name) tags.push(`name:${name}`)
			}

			txo.data.opns = {
				data: opns?.data ?? insc ?? origin?.insc,
				tags,
				content: opns?.content ?? txo.data.origin?.content,
			}
		}
		return undefined
	}
}
