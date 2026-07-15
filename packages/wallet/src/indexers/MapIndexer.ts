import { MAP_PREFIX } from '@1sat/templates'
import { Indexer, type ParseResult, type Txo } from '@1sat/types'
import { OP, Script, Utils } from '@bsv/sdk'

export class MapIndexer extends Indexer {
	tag = 'map'
	name = 'MAP'

	constructor(
		public owners = new Set<string>(),
		public network: 'mainnet' | 'testnet' = 'mainnet',
	) {
		super(owners, network)
	}

	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const script = txo.output.lockingScript

		const retPos = script.chunks.findIndex((chunk) => chunk.op === OP.OP_RETURN)
		if (retPos < 0 || !script.chunks[retPos]?.data?.length) {
			return
		}

		let chunks = Script.fromBinary(script.chunks[retPos].data).chunks
		while (chunks.length) {
			if (Utils.toUTF8(chunks[0]?.data || []) === MAP_PREFIX) {
				const map = MapIndexer.parseMap(new Script(chunks), 1)
				const name = (map?.name ??
					(map?.subTypeData as Record<string, unknown>)?.name) as
					| string
					| undefined
				const tags = name ? [`name:${name}`] : []
				return map ? { data: map, tags } : undefined
			}

			const pipePos = chunks.findIndex(
				(chunk) => chunk.data?.length === 1 && chunk.data[0] !== 0x7c,
			)
			if (pipePos > -1) {
				chunks = chunks.slice(pipePos + 1)
			} else break
		}
	}

	static parseMap(
		script: Script,
		mapPos: number,
	): { [key: string]: unknown } | undefined {
		if (Utils.toUTF8(script.chunks[mapPos]?.data || []) !== 'SET') {
			return
		}

		const map: { [key: string]: unknown } = {}
		for (let i = mapPos + 1; i < script.chunks.length; i += 2) {
			const chunk = script.chunks[i]
			if (
				chunk.op === OP.OP_RETURN ||
				(chunk.data?.length === 1 && chunk.data[0] !== 0x7c)
			) {
				break
			}

			const key = Utils.toUTF8(chunk.data || [])
			const value = Utils.toUTF8(script.chunks[i + 1]?.data || [])

			if (key === 'subTypeData') {
				try {
					map[key] = JSON.parse(value)
					continue
				} catch {
					// If JSON parsing fails, fall through to store as string
				}
			}

			map[key] = value
		}

		return map
	}
}
