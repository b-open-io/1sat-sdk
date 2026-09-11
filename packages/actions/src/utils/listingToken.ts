import { BSV20, BSV21 } from '@1sat/templates'
import { TOKEN_CONTENT_TYPE } from '@1sat/types'
import { P2PKH, type WalletOutput } from '@bsv/sdk'
import { bsv21FieldsFromOutput } from './bsv21Remittance.js'

const MAX_AMT = 2n ** 64n - 1n

export type ListingToken =
	| { kind: 'nft' }
	| { kind: 'bsv21'; id: string; amt: string }
	| { kind: 'bsv20'; tick: string; amt: string }
	| { kind: 'incomplete' }

function integerAmt(value: string | undefined): string | undefined {
	if (!value || !/^\d+$/.test(value)) return undefined
	const amt = BigInt(value)
	if (amt <= 0n || amt > MAX_AMT) return undefined
	return amt.toString()
}

/** NFT vs FT from wallet tags/CI. MIME is only application/bsv-20. */
export function listingToken(output: WalletOutput): ListingToken {
	const type = output.tags
		?.find((tag) => tag.startsWith('type:'))
		?.slice('type:'.length)
	if (type !== TOKEN_CONTENT_TYPE) return { kind: 'nft' }
	const fields = bsv21FieldsFromOutput(output)
	const amt = integerAmt(fields.amt)
	if (!amt) return { kind: 'incomplete' }
	if (fields.tokenId) return { kind: 'bsv21', id: fields.tokenId, amt }
	let tick: string | undefined
	try {
		const ci = output.customInstructions
			? (JSON.parse(output.customInstructions) as { tick?: unknown })
			: undefined
		if (typeof ci?.tick === 'string' && ci.tick.length > 0) tick = ci.tick
	} catch {
		/* CI may be derivation-only */
	}
	if (tick) return { kind: 'bsv20', tick, amt }
	return { kind: 'incomplete' }
}

export function tokenTransferLock(
	address: string,
	token: Extract<ListingToken, { kind: 'bsv21' } | { kind: 'bsv20' }>,
) {
	const dest = new P2PKH().lock(address)
	const amt = BigInt(token.amt)
	return token.kind === 'bsv21'
		? BSV21.transfer(token.id, amt).lock(dest)
		: BSV20.transfer(token.tick, amt).lock(dest)
}
