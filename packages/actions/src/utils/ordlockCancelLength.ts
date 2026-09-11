import {
	ORDLOCK_CANCEL_UNLOCK_LENGTH,
	ORDLOCK_V2_CANCEL_UNLOCK_LENGTH,
	OrdLockV2,
} from '@1sat/templates'
import { parseOutpoint } from '@1sat/utils'
import { Beef } from '@bsv/sdk'

/**
 * Unlocking-script length to reserve when cancelling a listing, chosen from
 * the listing's actual locking script (read out of its BEEF): v2 cancels
 * carry the `ol2:cancel` marker and are 11 bytes longer than v1.
 *
 * Falls back to the v2 length (the larger bound) when the script cannot be
 * found, so createAction never under-reserves.
 */
export function ordLockCancelUnlockLength(
	beef: number[],
	outpoint: string,
): number {
	try {
		const { txid, vout } = parseOutpoint(outpoint)
		const script =
			Beef.fromBinary(beef).findTxid(txid)?.tx?.outputs[vout]?.lockingScript
		if (script && !OrdLockV2.isOrdLockV2(script)) {
			return ORDLOCK_CANCEL_UNLOCK_LENGTH
		}
	} catch {}
	return ORDLOCK_V2_CANCEL_UNLOCK_LENGTH
}
