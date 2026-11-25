import { describe, expect, it } from 'bun:test'
import {
	ORDLOCK_CANCEL_UNLOCK_LENGTH,
	ORDLOCK_V2_CANCEL_UNLOCK_LENGTH,
	OrdLockV2,
} from '@1sat/templates'
import { ORD_LOCK_PREFIX, ORD_LOCK_SUFFIX } from '@1sat/types'
import {
	Beef,
	type LockingScript,
	P2PKH,
	PrivateKey,
	Script,
	Transaction,
	Utils,
} from '@bsv/sdk'
import { ordLockCancelUnlockLength } from './ordlockCancelLength.js'

const addr = new PrivateKey(9001).toAddress()
const pkh = Utils.fromBase58Check(addr).data as number[]

function v1Lock(): Script {
	return Script.fromHex(
		`${ORD_LOCK_PREFIX}14${Utils.toHex(pkh)}22e803000000000000${'19'}${new P2PKH().lock(pkh).toHex()}${ORD_LOCK_SUFFIX}`,
	)
}

describe('ordLockCancelUnlockLength', () => {
	const tx = new Transaction()
	tx.addOutput({ satoshis: 1, lockingScript: v1Lock() as LockingScript })
	tx.addOutput({
		satoshis: 1,
		lockingScript: OrdLockV2.lock(addr, addr, 1000) as LockingScript,
	})
	const beef = new Beef()
	beef.mergeTransaction(tx)
	const bin = beef.toBinary()
	const txid = tx.id('hex')

	it('picks the v1 length for a v1 listing', () => {
		expect(ordLockCancelUnlockLength(bin, `${txid}.0`)).toBe(
			ORDLOCK_CANCEL_UNLOCK_LENGTH,
		)
	})
	it('picks the v2 length for a v2 listing', () => {
		expect(ordLockCancelUnlockLength(bin, `${txid}.1`)).toBe(
			ORDLOCK_V2_CANCEL_UNLOCK_LENGTH,
		)
	})
	it('falls back to the larger v2 bound when the output is not in the BEEF', () => {
		expect(ordLockCancelUnlockLength(bin, `${'00'.repeat(32)}.0`)).toBe(
			ORDLOCK_V2_CANCEL_UNLOCK_LENGTH,
		)
		expect(ordLockCancelUnlockLength([], `${txid}.0`)).toBe(
			ORDLOCK_V2_CANCEL_UNLOCK_LENGTH,
		)
	})
})
