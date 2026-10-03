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
	 * An OpNS name is recognised by its ORIGIN's type (OriginIndexer has
	 * resolved it by now), never by an inscription on the current output: a
	 * published name may carry a reinscription (e.g. an `ordfs/dir` release)
	 * and is still the same name. The name string comes from the origin
	 * content (fetched by OriginIndexer for transfers) or, when this output is
	 * the origin, from the `name:` tag parse() took from its own content.
	 */
	async summarize(
		ctx: ParseContext,
		_isBroadcasted?: boolean,
	): Promise<IndexSummary | undefined> {
		for (const txo of ctx.txos) {
			if (!txo.owner || !this.owners.has(txo.owner)) continue

			const origin = txo.data.origin?.data as Origin | undefined
			if (!origin) continue
			if (baseType(origin.insc?.file?.type) !== OPNS_TYPE) {
				// parse() saw an op-ns envelope on an output whose origin is
				// something else — a reinscription, not a name.
				const { opns: _misclaimed, ...rest } = txo.data
				txo.data = rest
				continue
			}

			txo.basket = OPNS_BASKET

			// parse() read a name from this output's own envelope; that is the
			// name only when this output IS the origin (the mint).
			const isOrigin = origin.outpoint === txo.outpoint.toString()
			const opns = txo.data.opns
			const tags = isOrigin && opns?.tags ? [...opns.tags] : []
			if (!tags.some((t) => t.startsWith('name:'))) {
				const name = nameFromContent(txo.data.origin?.content)
				if (name) tags.push(`name:${name}`)
			}

			txo.data.opns = {
				data: origin.insc,
				tags,
				content:
					txo.data.origin?.content ?? (isOrigin ? opns?.content : undefined),
			}
		}
		return undefined
	}
}
