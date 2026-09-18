import { describe, expect, it } from 'bun:test'
import {
	LockingScript,
	PrivateKey,
	Transaction,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import {
	hexField,
	pushdropCustomInstructions,
	pushdropDecode,
	pushdropFieldUtf8,
	pushdropLock,
	pushdropUnsealedLock,
	PushDropTokenError,
	unlockPushDropInputs,
	utf8Field,
} from '../src/pushdrop/index.js'

// A base wallet: identity key signs everything; public key is consistent
// so PushDrop.decode can recover the locking key.
const identityKey = PrivateKey.fromRandom()
const identityPubHex = Utils.toHex(
	identityKey.toPublicKey().encode(true) as number[],
)

const wallet = {
	getPublicKey: async () => ({ publicKey: identityPubHex }),
	createSignature: async (args: {
		data?: number[]
		hashToDirectlySign?: number[]
	}) => {
		const data: number[] = args.data ?? args.hashToDirectlySign ?? []
		if (data.length === 0) throw new Error('mock: nothing to sign')
		const sig = identityKey.sign(data)
		return { signature: Array.from(sig.toDER()) }
	},
} as unknown as WalletInterface

const PROTOCOL: [1, string] = [1, 'gib commit']
const spec = {
	fields: [hexField(identityPubHex), utf8Field('txid_5')],
	protocolID: PROTOCOL,
	keyID: 'origin-txid_3',
	counterparty: 'anyone',
}

describe('pushdrop lifecycle', () => {
	it('lock → decode round-trips fields and recovers the locking key', async () => {
		const lock = await pushdropLock(wallet, spec)
		const decoded = pushdropDecode(lock)
		expect(decoded.sealed).toBe(true)
		expect(pushdropFieldUtf8(decoded, 1)).toBe('txid_5')
		expect(decoded.lockingPublicKeyHex).toBe(identityPubHex)
	})

	it('unsealed lock keeps decodable fields and differs from sealed', async () => {
		const sealed = await pushdropLock(wallet, spec)
		const unsealed = await pushdropUnsealedLock(wallet, spec, 73)
		expect(unsealed.toHex().length).toBeGreaterThan(0)
		expect(sealed.toHex()).not.toBe(unsealed.toHex())
		// fields still decode from the unsealed script (placeholder is just
		// another field); Gib seal-time swaps it for the real signature.
		const decoded = pushdropDecode(unsealed)
		expect(pushdropFieldUtf8(decoded, 1)).toBe('txid_5')
	})

	it('rejects garbage decode', () => {
		const junk = new LockingScript([
			{ op: 0x76 },
			{ op: 0xa9 },
			{ op: 20, data: new Array(20).fill(7) },
			{ op: 0x88 },
			{ op: 0xac },
		])
		expect(() => pushdropDecode(junk)).toThrow(PushDropTokenError)
	})

	it('customInstructions round-trips the signing spec', () => {
		const ci = JSON.parse(pushdropCustomInstructions(spec))
		expect(ci.protocolID).toEqual(PROTOCOL)
		expect(ci.keyID).toBe('origin-txid_3')
		expect(ci.counterparty).toBe('anyone')
	})

	it('utf8Field/hexField validate input', () => {
		expect(utf8Field('hi')).toEqual([104, 105])
		expect(hexField('00ff')).toEqual([0, 255])
		expect(() => hexField('0z')).toThrow(PushDropTokenError)
		expect(() => hexField('abc')).toThrow(PushDropTokenError)
	})

	it('unlockPushDropInputs produces spends from a signable tx', async () => {
		const lock = await pushdropLock(wallet, spec)
		const sourceTx = new Transaction()
		sourceTx.addInput({
			sourceTXID: 'ab'.repeat(32),
			sourceOutputIndex: 0,
			unlockingScript: new LockingScript(),
		})
		sourceTx.addOutput({ satoshis: 1, lockingScript: lock })

		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: sourceTx,
			sourceOutputIndex: 0,
			unlockingScript: new LockingScript(),
		})
		tx.addOutput({ satoshis: 1, lockingScript: lock })

		const spends = await unlockPushDropInputs(wallet, tx, [
			{
				index: 0,
				protocolID: PROTOCOL,
				keyID: spec.keyID,
				counterparty: 'anyone',
			},
		])
		expect(spends.length).toBe(1)
		expect(spends[0].index).toBe(0)
		expect(spends[0].unlockingScriptHex.length).toBeGreaterThan(10)
	})

	it('unlockPushDropInputs fails loudly without source data', async () => {
		const tx = new Transaction()
		tx.addInput({
			sourceTXID: 'cd'.repeat(32),
			sourceOutputIndex: 0,
			unlockingScript: new LockingScript(),
		})
		await expect(
			unlockPushDropInputs(wallet, tx, [
				{
					index: 0,
					protocolID: PROTOCOL,
					keyID: 'k',
					counterparty: 'anyone',
				},
			]),
		).rejects.toThrow(/source transaction/)
	})
})
