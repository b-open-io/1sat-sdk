import {
	Indexer,
	type ParseResult,
	TWETCH_BASKET,
	TWETCH_TAG,
	type Txo,
} from '@1sat/types'
import { OP, Script, Utils } from '@bsv/sdk'
import { parseAddress } from './parseAddress.js'

/** One trait of a Twetch NFT. */
export interface TwetchAttribute {
	traitType: string
	value: string
	rarity?: string
}

/** Metadata of a Twetch NFT output. */
export interface Twetch {
	/** Hex of the 20-byte hash the output is locked to (with the owner's P2PKH). */
	hashLock: string
	title?: string
	description?: string
	/** `b://<txid>` reference to the image. */
	image?: string
	number?: number
	series?: number
	rarity?: string
	rank?: number
	/** `b://<txid>` reference to the 3D model (glTF). */
	gltfModel?: string
	/** `b://<txid>` reference to the background image. */
	background?: string
	attributes?: TwetchAttribute[]
}

/**
 * TwetchIndexer recognizes Twetch NFTs ("twonks", such as the 456 Muties), which
 * predate 1Sat ordinals. Their locking script is:
 *
 *   OP_HASH160 <20-byte hash> OP_EQUALVERIFY
 *   OP_DUP OP_HASH160 <owner pkh> OP_EQUALVERIFY OP_CHECKSIG
 *   OP_RETURN <JSON metadata>
 *
 * Spending one needs the owner's signature and the hash preimage, so these
 * outputs go to {@link TWETCH_BASKET}, never to plain funds. Sending them is
 * not supported yet.
 *
 * Basket: 'twetch'
 * Tags: 'twetch', 'name:<title>'
 */
export class TwetchIndexer extends Indexer {
	tag = 'twetch'
	name = 'Twetch NFTs'

	constructor(
		public owners = new Set<string>(),
		public network: 'mainnet' | 'testnet' = 'mainnet',
	) {
		super(owners, network)
	}

	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const chunks = txo.output.lockingScript.chunks
		if (
			chunks[0]?.op !== OP.OP_HASH160 ||
			chunks[1]?.data?.length !== 20 ||
			chunks[2]?.op !== OP.OP_EQUALVERIFY
		) {
			return
		}
		const owner = parseAddress(txo.output.lockingScript, 3, this.network)
		if (!owner || chunks[8]?.op !== OP.OP_RETURN) return
		const meta = TwetchIndexer.parseMeta(chunks[8].data)
		if (!meta) return
		meta.hashLock = Utils.toHex(chunks[1].data)

		const tags = [TWETCH_TAG]
		if (meta.title) tags.push(`name:${meta.title}`)
		return {
			data: meta,
			tags,
			owner,
			basket: TWETCH_BASKET,
		}
	}

	/**
	 * Read the JSON pushed after OP_RETURN. The SDK keeps everything after
	 * OP_RETURN as one chunk of raw script bytes, so the push is re-read here.
	 * Returns undefined unless it is a JSON object with a title or an image.
	 */
	static parseMeta(raw: number[] | undefined): Twetch | undefined {
		if (!raw?.length) return
		let json: unknown
		try {
			const data = Script.fromBinary(raw).chunks[0]?.data
			if (!data?.length) return
			json = JSON.parse(Utils.toUTF8(data))
		} catch {
			return
		}
		if (!json || typeof json !== 'object' || Array.isArray(json)) return
		const j = json as Record<string, unknown>
		const meta: Twetch = {
			hashLock: '',
			title: str(j.title),
			description: str(j.description),
			image: str(j.image),
			number: int(j.number),
			series: int(j.series),
			rarity: str(j.rarity),
			rank: int(j.rank),
			gltfModel: str(j.gltfModel),
			background: str(j.background),
		}
		if (!meta.title && !meta.image) return
		if (Array.isArray(j.attributes)) {
			const attributes: TwetchAttribute[] = []
			for (const a of j.attributes) {
				if (!a || typeof a !== 'object') continue
				const m = a as Record<string, unknown>
				const traitType = str(m.trait_type) ?? ''
				const value = str(m.value) ?? ''
				if (!traitType && !value) continue
				attributes.push({ traitType, value, rarity: str(m.rarity) })
			}
			if (attributes.length) meta.attributes = attributes
		}
		return meta
	}
}

function str(v: unknown): string | undefined {
	if (typeof v === 'string') return v || undefined
	if (typeof v === 'number') return String(v)
	return undefined
}

function int(v: unknown): number | undefined {
	const n =
		typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
	return Number.isFinite(n) ? Math.trunc(n) : undefined
}
