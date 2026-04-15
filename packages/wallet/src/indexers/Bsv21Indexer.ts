import { HttpError, type OneSatServices } from '@1sat/client'
import { BSV21 } from '@1sat/templates'
import { BSV21_FEE_XPUB } from '@1sat/types'
import {
	type IndexSummary,
	Indexer,
	type ParseContext,
	type ParseResult,
	type Txo,
} from '@1sat/types'
import { HD, Hash, Utils } from '@bsv/sdk'

const hdKey = HD.fromString(BSV21_FEE_XPUB)

export interface Bsv21 {
	id: string
	op: string
	amt: bigint
	dec: number
	sym?: string
	icon?: string
	status: 'valid' | 'invalid' | 'pending'
	reason?: string
	fundAddress: string
}

/**
 * Bsv21Indexer identifies and validates BSV21 tokens.
 * These are 1-sat outputs with application/bsv-20 inscription type.
 *
 * Data structure: Bsv21 with id, op, amt, dec, status, etc.
 *
 * Basket: 'bsv21'
 * Events: id, id:status, bsv21:amt
 */
export class Bsv21Indexer extends Indexer {
	tag = 'bsv21'
	name = 'BSV21 Tokens'

	constructor(
		public owners: Set<string>,
		public network: 'mainnet' | 'testnet',
		public services: OneSatServices,
	) {
		super(owners, network)
	}

	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const lockingScript = txo.output.lockingScript

		// Use template decode
		const decoded = BSV21.decode(lockingScript)
		if (!decoded) return

		const outpoint = txo.outpoint
		const tokenData = decoded.tokenData

		// Determine token ID - for deploy ops it's this outpoint, otherwise from inscription
		const tokenId = tokenData.id || outpoint.toOrdinalString()

		// Determine initial status:
		// - deploy ops (deploy+mint, deploy+auth) are always valid (they create the token)
		// - transfer/burn ops start as pending until validated in summarize()
		const isDeploy = tokenData.op.startsWith('deploy')
		const initialStatus: 'valid' | 'pending' = isDeploy ? 'valid' : 'pending'

		// Create indexer data structure with basic info from inscription
		const bsv21: Bsv21 = {
			id: tokenId,
			op: tokenData.op,
			amt: decoded.getAmount(),
			dec: decoded.getDecimals(),
			sym: tokenData.sym,
			icon: tokenData.icon,
			status: initialStatus,
			fundAddress: deriveFundAddress(outpoint.toBEBinary()),
		}

		// For non-deploy ops, fetch token metadata from server (cached)
		// This ensures we always have sym, dec, icon for any token
		if (!isDeploy) {
			try {
				const details = await this.services.bsv21.getTokenDetails(tokenId)
				bsv21.sym = details.token.sym
				bsv21.icon = resolveIcon(details.token.icon, tokenId)
				bsv21.dec = Number(details.token.dec) || 0
			} catch (e) {
				// Token not found on server - could be unconfirmed or invalid
				// Keep local values from inscription, status remains pending
				if (!(e instanceof HttpError && e.status === 404)) {
					throw e
				}
			}
		} else {
			// For deploy ops, resolve relative icon reference if present
			bsv21.icon = resolveIcon(bsv21.icon, tokenId)
		}

		// Validate amount range
		if (bsv21.amt <= 0n || bsv21.amt > 2n ** 64n - 1n) return

		const tags: string[] = []
		if (txo.owner && this.owners.has(txo.owner)) {
			tags.push(`bsv21:${bsv21.id}`)
			tags.push(`amt:${bsv21.amt.toString()}`)
			// Add metadata tags for efficient querying
			if (bsv21.sym) tags.push(`sym:${bsv21.sym}`)
			if (bsv21.icon) tags.push(`icon:${bsv21.icon}`)
			tags.push(`dec:${bsv21.dec}`)
		}

		return {
			data: bsv21,
			tags,
			basket:
				tokenId ===
				'ae59f3b898ec61acbdb6cc7a245fabeded0c094bf046f35206a3aec60ef88127_0'
					? 'mnee'
					: 'bsv21',
		}
	}

	async summarize(ctx: ParseContext): Promise<IndexSummary | undefined> {
		// Track token flows per token ID for validation
		const tokenFlows: {
			[id: string]: {
				tokensIn: bigint
				tokensOut: bigint
				inputsPending: boolean
			}
		} = {}

		let summaryToken: Bsv21 | undefined
		let summaryBalance = 0

		// Process inputs from ctx.spends (already parsed)
		for (const spend of ctx.spends) {
			const bsv21 = spend.data.bsv21
			if (!bsv21) continue

			const tokenData = bsv21.data as Bsv21

			// Initialize token tracking
			if (!tokenFlows[tokenData.id]) {
				tokenFlows[tokenData.id] = {
					tokensIn: 0n,
					tokensOut: 0n,
					inputsPending: false,
				}
			}

			const flow = tokenFlows[tokenData.id]

			// Validate this input exists on the overlay
			try {
				await this.services.bsv21.getTokenByTxid(
					tokenData.id,
					spend.outpoint.txid,
				)
			} catch (e) {
				if (e instanceof HttpError && e.status === 404) {
					// Input not on overlay yet - outputs will be pending
					flow.inputsPending = true
				} else {
					throw e
				}
			}

			// Accumulate tokens in
			flow.tokensIn += tokenData.amt

			if (!summaryToken) summaryToken = tokenData

			// Track balance change for owned inputs
			if (
				summaryToken &&
				tokenData.id === summaryToken.id &&
				spend.owner &&
				this.owners.has(spend.owner)
			) {
				summaryBalance -= Number(tokenData.amt)
			}
		}

		// Process outputs: accumulate tokensOut and validate
		for (const txo of ctx.txos) {
			const bsv21 = txo.data.bsv21
			if (!bsv21 || !['transfer', 'burn'].includes((bsv21.data as Bsv21).op))
				continue

			const tokenData = bsv21.data as Bsv21
			const flow = tokenFlows[tokenData.id]

			if (flow) {
				flow.tokensOut += tokenData.amt
			} else {
				// No inputs for this token - invalid (attempting to create tokens from nothing)
				tokenData.status = 'invalid'
			}

			if (!summaryToken) summaryToken = tokenData

			// Track balance change for owned outputs
			if (
				summaryToken &&
				tokenData.id === summaryToken.id &&
				txo.owner &&
				this.owners.has(txo.owner)
			) {
				summaryBalance += Number(tokenData.amt)
			}
		}

		// Finalize validation and apply status to outputs
		for (const txo of ctx.txos) {
			const bsv21 = txo.data.bsv21
			if (!bsv21 || !['transfer', 'burn'].includes((bsv21.data as Bsv21).op))
				continue

			const tokenData = bsv21.data as Bsv21
			if (tokenData.status === 'invalid') continue // Already marked invalid

			const flow = tokenFlows[tokenData.id]
			if (!flow) continue

			// Determine final status
			if (flow.inputsPending) {
				tokenData.status = 'pending'
			} else if (flow.tokensIn >= flow.tokensOut) {
				tokenData.status = 'valid'
			} else {
				tokenData.status = 'invalid'
			}
		}

		if (summaryToken?.sym) {
			return {
				id: summaryToken.sym,
				amount: summaryBalance / 10 ** (summaryToken.dec || 0),
				icon: summaryToken.icon,
			}
		}
	}

	serialize(bsv21: Bsv21): string {
		return JSON.stringify({
			...bsv21,
			amt: bsv21.amt.toString(10),
		})
	}

	deserialize(str: string): Bsv21 {
		const obj = JSON.parse(str)
		return {
			...obj,
			amt: BigInt(obj.amt),
		}
	}
}

/**
 * Resolve a relative icon reference to an absolute outpoint.
 * If icon starts with "_", it's a relative reference to another output
 * in the same transaction as the token deploy. We resolve it by
 * prepending the token ID's txid.
 *
 * Example: tokenId = "abc123...def_0", icon = "_1" -> "abc123...def_1"
 */
function resolveIcon(
	icon: string | undefined,
	tokenId: string,
): string | undefined {
	if (!icon || !icon.startsWith('_')) return icon

	// Token ID format is "txid_vout", extract the txid
	const txid = tokenId.substring(0, 64)
	// Icon format is "_vout", combine with txid
	return `${txid}${icon}`
}

export function deriveFundAddress(idOrOutpoint: string | number[]): string {
	const hash = Hash.sha256(idOrOutpoint)
	const reader = new Utils.Reader(hash)
	let path = `m/21/${reader.readUInt32BE() >> 1}`
	reader.pos = 24
	path += `/${reader.readUInt32BE() >> 1}`
	return hdKey.derive(path).pubKey.toAddress()
}
