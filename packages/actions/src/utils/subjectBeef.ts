import { BEEF_V2, type Beef, Utils } from '@bsv/sdk'

/**
 * BRC-233 Subject BEEF envelope.
 *
 * ```
 * 5709beef || txid (32 bytes, LE on wire) || BEEF V2
 * ```
 *
 * Atomic BEEF (BRC-95) in shape, without its ancestors-only rule: the BEEF
 * may carry transactions that are not ancestors of the subject. TXID byte
 * order mirrors Atomic BEEF: display hex is the reverse of the wire bytes.
 */

export const SUBJECT_BEEF_PREFIX = [0x57, 0x09, 0xbe, 0xef] as const

/**
 * Serialize `beef` as Subject BEEF about `txid`. The BEEF must be V2
 * (BRC-96) and hold the subject transaction; nothing is trimmed.
 */
export function toSubjectBeef(beef: Beef, txid: string): number[] {
	if (beef.version !== BEEF_V2) throw new Error('subject-beef-not-v2')
	if (!beef.findTxid(txid)?.tx) throw new Error('subject-beef-missing-subject')
	return [
		...SUBJECT_BEEF_PREFIX,
		...Utils.toArray(txid, 'hex').reverse(),
		...beef.toBinary(),
	]
}
