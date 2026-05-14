import { HttpError, type OneSatServices } from '@1sat/client'
import {
	type IndexSummary,
	Indexer,
	ORDINALS_BASKET,
	type ParseContext,
	type ParseResult,
	type Txo,
} from '@1sat/types'
import type { Inscription } from './InscriptionIndexer'
import type { Sigma } from './SigmaIndexer'
import { parseAddress } from './parseAddress'

export interface Origin {
	outpoint?: string
	nonce?: number
	insc?: Inscription
	map?: { [key: string]: unknown }
	sigma?: Sigma[]
}

export class OriginIndexer extends Indexer {
	tag = 'origin'
	name = 'Origins'

	constructor(
		public owners: Set<string>,
		public network: 'mainnet' | 'testnet',
		private services: OneSatServices,
	) {
		super(owners, network)
	}

	/**
	 * Parse identifies 1-sat ordinal outputs and extracts basic data.
	 * Origin tracking (determining if transfer vs new) is done in summarize()
	 * since it requires cross-output and cross-input context.
	 */
	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const satoshis = BigInt(txo.output.satoshis || 0)

		// Only parse 1-satoshi outputs, exclude BSV-20 tokens
		if (satoshis !== 1n) return
		const insc = txo.data.insc?.data as Inscription | undefined
		if (insc?.file?.type === 'application/bsv-20') return

		// Parse the address
		const script = txo.output.lockingScript
		const address = parseAddress(script, 0, this.network)

		// Start with placeholder origin - will be populated in summarize()
		const origin: Origin = {
			outpoint: '', // Will be set in summarize()
			nonce: 0,
			sigma: txo.data.sigma?.data as Sigma[],
		}

		// Merge current output's MAP data
		const currentMap = txo.data.map?.data as
			| { [key: string]: unknown }
			| undefined
		if (currentMap) {
			origin.map = { ...currentMap }
		}

		// If current output has inscription, use it
		if (insc) {
			origin.insc = insc
		}

		return {
			data: origin,
			tags: [], // Tags will be added in summarize() once origin is determined
			owner: address,
			basket: ORDINALS_BASKET,
		}
	}

	/**
	 * Summarize determines origin tracking (transfer vs new origin) and
	 * fetches metadata from OrdFS for transfers.
	 */
	async summarize(ctx: ParseContext): Promise<IndexSummary | undefined> {
		// First, calculate satoshi positions and determine origins for all outputs
		await this.resolveOrigins(ctx)

		// Now compute balance summary
		let balance = 0
		let hasTag = false
		let icon: string | undefined
		let id = ''

		// Check inputs
		for (const spend of ctx.spends) {
			if (spend.data[this.tag]) {
				const origin = spend.data[this.tag].data as Origin
				if (spend.owner && this.owners.has(spend.owner)) {
					hasTag = true
					balance--
					if (!icon && origin?.insc?.file?.type.startsWith('image/')) {
						icon = origin?.outpoint
						id = (origin.map?.name as string) || ''
					}
				}
			}
		}

		// Check outputs
		for (const txo of ctx.txos) {
			if (txo.data[this.tag]) {
				if (txo.owner && this.owners.has(txo.owner)) {
					hasTag = true
					balance++
					const origin = txo.data.origin?.data as Origin
					if (!icon && origin?.insc?.file?.type.startsWith('image/')) {
						icon = origin?.outpoint
					}
				}
				// Clear file content before saving - content is loaded locally but shouldn't be persisted
				const origin = txo.data[this.tag].data as Origin
				if (origin?.insc?.file) {
					origin.insc.file.content = []
				}
			}
		}

		if (hasTag) {
			return {
				id,
				amount: balance,
				icon,
			}
		}
	}

	/**
	 * Resolve origins for all 1-sat outputs in the transaction.
	 * This determines whether each is a new origin or a transfer.
	 */
	private async resolveOrigins(ctx: ParseContext): Promise<void> {
		// Calculate satoshi positions for all outputs
		const satPositions: bigint[] = []
		let cumulative = 0n
		for (const txo of ctx.txos) {
			satPositions.push(cumulative)
			cumulative += BigInt(txo.output.satoshis || 0)
		}

		// Process each output that has origin data
		for (let vout = 0; vout < ctx.txos.length; vout++) {
			const txo = ctx.txos[vout]
			const originData = txo.data[this.tag]
			if (!originData) continue

			const origin = originData.data as Origin
			const outSat = satPositions[vout]

			// Track accumulated input satoshis to find which input contains our satoshi
			let satsIn = 0n
			let sourceOutpoint: string | undefined

			for (const spend of ctx.spends) {
				const spendSatoshis = BigInt(spend.output.satoshis || 0)
				// Check if this input's satoshi range contains our output's satoshi
				if (satsIn === outSat && spendSatoshis === 1n) {
					sourceOutpoint = spend.outpoint.toString()
					break
				}

				satsIn += spendSatoshis

				// If we've passed our satoshi position, this is a new origin
				if (satsIn > outSat) {
					break
				}
			}

			if (sourceOutpoint) {
				// Transfer - fetch metadata from OrdFS
				try {
					const metadata = await this.services.ordfs.getMetadata(
						sourceOutpoint,
						0,
					)
					origin.outpoint = metadata.origin || sourceOutpoint
					origin.nonce = metadata.sequence + 1

					// Merge inherited map with current
					if (metadata.map) {
						origin.map = { ...metadata.map, ...(origin.map || {}) }
					}

					// If no inscription on current output, use metadata from source
					// and potentially fetch text content
					if (!origin.insc) {
						origin.insc = {
							file: {
								hash: '',
								size: metadata.contentLength,
								type: metadata.contentType,
								content: [],
							},
						}

						// Fetch text content if it qualifies
						const contentType = metadata.contentType.toLowerCase()
						const isTextContent =
							contentType.startsWith('text/') ||
							contentType === 'application/json'
						if (isTextContent && metadata.contentLength <= 1000) {
							try {
								const { data } = await this.services.ordfs.getContent(
									origin.outpoint || sourceOutpoint,
								)
								if (data) {
									originData.content = new TextDecoder().decode(data)
								}
							} catch {
								// Ignore content fetch errors
							}
						}
					}
				} catch (e) {
					if (e instanceof HttpError && e.status === 404) {
						// Source outpoint not found in OrdFS - treat as new origin
						origin.outpoint = txo.outpoint.toString()
					} else {
						throw e
					}
				}
			} else {
				// New origin
				origin.outpoint = txo.outpoint.toString()
			}

			// Validate parent if inscription claims one
			const insc = txo.data.insc?.data as Inscription | undefined
			if (insc?.parent) {
				try {
					const metadata = await this.services.ordfs.getMetadata(
						txo.outpoint.toString(),
						0,
					)
					if (metadata.parent !== insc.parent) {
						if (origin.insc) {
							origin.insc.parent = undefined
						}
					}
				} catch (e) {
					if (e instanceof HttpError && e.status === 404) {
						// Can't verify parent claim - remove it
						if (origin.insc) {
							origin.insc.parent = undefined
						}
					} else {
						throw e
					}
				}
			}

			// Clear large file content to save space
			if (origin.insc?.file?.size && origin.insc.file.size > 4096) {
				origin.insc.file.content = []
			}

			// Now add tags since origin is determined
			if (txo.owner && this.owners.has(txo.owner)) {
				originData.tags.push(`origin:${origin.outpoint || ''}`)
				if (origin.insc?.file?.type) {
					const fullType = origin.insc.file.type
					const baseType = fullType.split(';')[0].trim()
					const category = baseType.split('/')[0]
					originData.tags.push(`type:${category}`)
					originData.tags.push(`type:${baseType}`)
				}
				// Extract name from map data
				const name = (origin.map?.name ??
					(origin.map?.subTypeData as Record<string, unknown>)?.name) as
					| string
					| undefined
				if (name) {
					originData.tags.push(`name:${name}`)
				}
			}
		}
	}
}
