import { BSV20, BSV21 } from '@1sat/templates'
import { P2PKH, type WalletOutput } from '@bsv/sdk'
import { bsv21FieldsFromOutput } from './bsv21Remittance.js'

const MAX_AMT = 2n ** 64n - 1n

export type ListingKind =
	| { kind: 'nft' }
	| { kind: 'bsv21'; id: string; amt: string }
	| { kind: 'bsv20'; tick: string; amt: string }
	| { kind: 'token-unknown' }

export function isTokenMime(type: string | undefined): boolean {
	if (!type) return false
	const normalized = type.split(';')[0]!.trim().toLowerCase()
	return (
		normalized === 'application/bsv-20' ||
		normalized === 'application/bsv20' ||
		normalized === 'application/bsv-21' ||
		normalized === 'application/bsv21'
	)
}

function parseAmt(value: string | undefined): string | undefined {
	if (!value || !/^\d+$/.test(value)) return undefined
	try {
		const amt = BigInt(value)
		if (amt <= 0n || amt > MAX_AMT) return undefined
		return amt.toString()
	} catch {
		return undefined
	}
}

/** NFT vs FT from wallet tags/CI. Construction must use BSV21/BSV20.transfer. */
export function classifyWalletListing(output: WalletOutput): ListingKind {
	const tags = output.tags ?? []
	const type = tags.find((t) => t.startsWith('type:'))?.slice(5)
	const looksToken =
		isTokenMime(type) || tags.some((t) => /^bsv-?2[01](?::|$)/i.test(t))
	const fields = bsv21FieldsFromOutput(output)
	const amt = parseAmt(fields.amt)
	let tick: string | undefined
	try {
		const ci = output.customInstructions
			? (JSON.parse(output.customInstructions) as { tick?: unknown })
			: undefined
		if (
			typeof ci?.tick === 'string' &&
			ci.tick.length > 0 &&
			ci.tick.length <= 32
		)
			tick = ci.tick
	} catch {
		/* listing CI may be derivation-only */
	}
	if (fields.tokenId && amt && !tick)
		return { kind: 'bsv21', id: fields.tokenId, amt }
	if (tick && amt && !fields.tokenId) return { kind: 'bsv20', tick, amt }
	if (looksToken) return { kind: 'token-unknown' }
	return { kind: 'nft' }
}

export function tokenCancelScript(
	address: string,
	kind: Extract<ListingKind, { kind: 'bsv21' } | { kind: 'bsv20' }>,
) {
	const dest = new P2PKH().lock(address)
	return kind.kind === 'bsv21'
		? BSV21.transfer(kind.id, BigInt(kind.amt)).lock(dest)
		: BSV20.transfer(kind.tick, BigInt(kind.amt)).lock(dest)
}
