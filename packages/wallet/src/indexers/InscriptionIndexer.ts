import { Inscription as InscriptionTemplate } from '@1sat/templates'
import {
	Indexer,
	type IndexSummary,
	type ParseContext,
	type ParseResult,
	type Txo,
} from '@1sat/types'
import { OP, Script, Utils } from '@bsv/sdk'
import { MapIndexer } from './MapIndexer'
import { parseAddress } from './parseAddress'

export interface File {
	hash: string
	size: number
	type: string
	content: number[]
}

export interface Inscription {
	file?: File
	fields?: { [key: string]: string }
	parent?: string
}

/**
 * InscriptionIndexer identifies and parses ordinal inscriptions.
 * These are outputs with exactly 1 satoshi containing OP_FALSE OP_IF "ord" envelope.
 *
 * Data structure: Inscription with file, fields, and optional parent
 *
 * Basket: None (no basket assignment - this is preliminary data for other indexers)
 * Events: address for owned outputs
 */
export class InscriptionIndexer extends Indexer {
	tag = 'insc'
	name = 'Inscriptions'

	constructor(
		public owners = new Set<string>(),
		public network: 'mainnet' | 'testnet' = 'mainnet',
	) {
		super(owners, network)
	}

	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const satoshis = BigInt(txo.output.satoshis || 0)
		if (satoshis !== 1n) return

		const script = txo.output.lockingScript

		// Use template decode
		const decoded = InscriptionTemplate.decode(script)
		if (!decoded) return

		// Extract owner from script prefix or suffix
		let owner = parseAddress(script, 0, this.network)
		if (!owner && decoded.scriptSuffix) {
			// Try to find owner in suffix (after OP_ENDIF)
			owner = parseAddress(decoded.scriptSuffix, 0, this.network)
			// Also check for OP_CODESEPARATOR pattern
			if (
				!owner &&
				decoded.scriptSuffix.chunks[0]?.op === OP.OP_CODESEPARATOR
			) {
				owner = parseAddress(decoded.scriptSuffix, 1, this.network)
			}
		}

		// Handle MAP field if present (special case)
		// Note: This writes to txo.data.map directly as a side effect
		if (decoded.fields?.has('MAP')) {
			const mapData = decoded.fields.get('MAP')
			if (mapData) {
				const map = MapIndexer.parseMap(
					Script.fromBinary(Array.from(mapData)),
					0,
				)
				if (map) {
					txo.data.map = { data: map, tags: [] }
				}
			}
		}

		// Convert to wallet-toolbox format
		const insc: Inscription = {
			file: {
				hash: Utils.toBase64(Array.from(decoded.file.hash)),
				size: decoded.file.size,
				type: decoded.file.type,
				content: Array.from(decoded.file.content),
			},
			fields: {},
		}

		// Extract text content if it's a text-based inscription and small enough
		let content: string | undefined
		const contentType = decoded.file.type.toLowerCase()
		const isTextContent =
			contentType.startsWith('text/') || contentType === 'application/json'
		if (isTextContent && decoded.file.size <= 1000) {
			try {
				content = new TextDecoder().decode(decoded.file.content)
			} catch {
				// Ignore decoding errors
			}
		}

		// Convert parent outpoint to string format
		if (decoded.parent) {
			try {
				const reader = new Utils.Reader(Array.from(decoded.parent))
				const txid = Utils.toHex(reader.read(32).reverse())
				const vout = reader.readInt32LE()
				insc.parent = `${txid}.${vout}`
			} catch {
				// Ignore parsing errors
			}
		}

		// Convert fields to base64 strings
		if (decoded.fields && insc.fields) {
			for (const [key, value] of decoded.fields) {
				if (key !== 'MAP') {
					insc.fields[key] = Utils.toBase64(Array.from(value))
				}
			}
		}

		return {
			data: insc,
			tags: [],
			owner,
			content,
		}
	}

	async summarize(ctx: ParseContext): Promise<IndexSummary | undefined> {
		// Clear file content before saving - content is loaded locally but shouldn't be persisted
		for (const txo of ctx.txos) {
			const insc = txo.data[this.tag]?.data as Inscription | undefined
			if (insc?.file) {
				insc.file.content = []
			}
		}
		return undefined
	}
}
