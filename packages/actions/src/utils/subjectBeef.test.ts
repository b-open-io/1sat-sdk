import { describe, expect, test } from 'bun:test'
import {
	BEEF_V1,
	Beef,
	P2PKH,
	PrivateKey,
	Transaction,
	UnlockingScript,
} from '@bsv/sdk'
import { SUBJECT_BEEF_PREFIX, toSubjectBeef } from './subjectBeef.js'

function tx(seed: string): Transaction {
	const t = new Transaction()
	t.addInput({
		sourceTXID: seed.repeat(32),
		sourceOutputIndex: 0,
		unlockingScript: new UnlockingScript(),
		sequence: 0xffffffff,
	})
	t.addOutput({
		lockingScript: new P2PKH().lock(
			PrivateKey.fromHex('07'.repeat(32)).toPublicKey().toAddress(),
		),
		satoshis: 1,
	})
	return t
}

describe('toSubjectBeef', () => {
	test('5709beef, the subject txid as Atomic BEEF writes it, then the BEEF V2 with unrelated txs', () => {
		const subject = tx('11')
		const other = tx('22')
		const beef = new Beef()
		beef.mergeTransaction(subject)
		beef.mergeTransaction(other)
		const txid = subject.id('hex')

		const bytes = toSubjectBeef(beef, txid)
		expect(bytes.slice(0, 4)).toEqual([0x57, 0x09, 0xbe, 0xef])
		expect(bytes.slice(0, 4)).toEqual([...SUBJECT_BEEF_PREFIX])
		// Same subject bytes as @bsv/sdk's Atomic BEEF (0x01010101 + txid).
		const atomic = beef.toBinaryAtomic(txid)
		expect(atomic.slice(0, 4)).toEqual([1, 1, 1, 1])
		expect(bytes.slice(4, 36)).toEqual(atomic.slice(4, 36))
		// Wire order is the double-SHA256 as hashed (display hex reversed).
		expect(bytes.slice(4, 36)).toEqual(subject.hash() as number[])
		// Body: BEEF V2 (0200beef) keeping the transaction that is no ancestor.
		const body = bytes.slice(36)
		expect(body.slice(0, 4)).toEqual([0x02, 0x00, 0xbe, 0xef])
		expect(body).toEqual(beef.toBinary())
		const inner = Beef.fromBinary(body)
		expect(inner.findTxid(txid)).toBeDefined()
		expect(inner.findTxid(other.id('hex'))).toBeDefined()
	})

	test('rejects a BEEF V1 and a BEEF without the subject', () => {
		const subject = tx('11')
		const v1 = new Beef(BEEF_V1)
		v1.mergeTransaction(subject)
		expect(() => toSubjectBeef(v1, subject.id('hex'))).toThrow(
			'subject-beef-not-v2',
		)
		const beef = new Beef()
		beef.mergeTransaction(tx('22'))
		expect(() => toSubjectBeef(beef, subject.id('hex'))).toThrow(
			'subject-beef-missing-subject',
		)
	})
})
