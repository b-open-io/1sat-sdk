import type { MandalaToken } from '@1sat/templates'

/**
 * The token outpoint `<txid>_<vout>` (lowercase) a decoded Mandala output
 * belongs to, given the output's own outpoint: a deploy output's token is the
 * output itself; a value or authority output names its token by its BRC-162
 * id (32 bytes for vout 0, 36 bytes for a legacy vout > 0), which the
 * template renders as `<txid>_<vout>`.
 */
export function mandalaTokenOf(
	token: MandalaToken,
	txid: string,
	vout: number,
): string | undefined {
	if (token.role === 'deploy') return `${txid.toLowerCase()}_${vout}`
	return token.tokenId?.toLowerCase()
}
