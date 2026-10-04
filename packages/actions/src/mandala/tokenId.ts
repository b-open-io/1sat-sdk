import { Mandala, type MandalaToken } from '@1sat/templates'
import { mandalaOutpoint } from '@1sat/types'

/**
 * Mandala tokens are referred to by BRC-36 outpoints, `<txid>.<vout>`
 * (BRC-162 defers to BRC-36). The template's own string form is
 * `<txid>_<vout>`; these helpers convert at that boundary.
 */

/** Normalize `txid.vout`, `txid_vout` or `{ txid, vout }` to BRC-36 `txid.vout`. */
export function mandalaTokenOutpoint(
	token: string | { txid: string; vout: number },
): string {
	const { txid, vout } = mandalaOutpoint(token)
	return `${txid}.${vout}`
}

/** The BRC-162 wire id (32 or 36 bytes) for a token outpoint. */
export function mandalaWireId(token: string): Uint8Array {
	const { txid, vout } = mandalaOutpoint(token)
	return Mandala.idFromString(`${txid}_${vout}`)
}

/**
 * The token outpoint `<txid>.<vout>` (lowercase) a decoded Mandala output
 * belongs to, given the output's own outpoint: a deploy output's token is the
 * output itself; a value or authority output names its token by its BRC-162
 * id (32 bytes for vout 0, 36 bytes for a legacy vout > 0).
 */
export function mandalaTokenOf(
	token: MandalaToken,
	txid: string,
	vout: number,
): string | undefined {
	if (token.role === 'deploy') return `${txid.toLowerCase()}.${vout}`
	return token.tokenId ? mandalaTokenOutpoint(token.tokenId) : undefined
}
