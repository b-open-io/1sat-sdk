import { describe, expect, test } from 'bun:test'
import { encodeOpnsRecord } from '@1sat/templates'
import {
	OPNS_REGISTER_COUNTERPARTY,
	P1SAT_PROTOCOL,
	opnsRegisterKeyId,
} from '@1sat/types'
import {
	type LockingScript,
	PrivateKey,
	ProtoWallet,
	PushDrop,
	Transaction,
	UnlockingScript,
	Utils,
} from '@bsv/sdk'
import { verifyPushDropBind } from '../src/paymail/resolve.js'

const SOURCE_TXID = '9a'.repeat(32)
const AVATAR = `${'ef'.repeat(32)}_2`

async function bindTx(
	wallet: ProtoWallet,
	fields: number[][],
): Promise<{ tx: Transaction; lock: LockingScript }> {
	const lock = await new PushDrop(wallet).lock(
		fields,
		P1SAT_PROTOCOL,
		opnsRegisterKeyId(`${SOURCE_TXID}.0`),
		OPNS_REGISTER_COUNTERPARTY,
		true,
		true,
	)
	const tx = new Transaction()
	tx.addInput({
		sourceTXID: SOURCE_TXID,
		sourceOutputIndex: 0,
		unlockingScript: new UnlockingScript(),
		sequence: 0xffffffff,
	})
	tx.addOutput({ lockingScript: lock, satoshis: 1 })
	return { tx, lock }
}

describe('verifyPushDropBind (OpNS record)', () => {
	test('decodes identity and profile from a signed record', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7001))
		const { publicKey: identityKey } = await wallet.getPublicKey({
			identityKey: true,
		})
		const { tx, lock } = await bindTx(
			wallet,
			encodeOpnsRecord({
				identityKey,
				profile: { domain: '1sat.name', displayName: 'Alice', avatar: AVATAR },
			}),
		)
		expect(await verifyPushDropBind(tx, 0, lock)).toEqual({
			identityKey,
			domain: '1sat.name',
			profileName: 'Alice',
			avatarOrigin: AVATAR,
		})
	})

	test('identity-only record has no profile fields', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7002))
		const { publicKey: identityKey } = await wallet.getPublicKey({
			identityKey: true,
		})
		const { tx, lock } = await bindTx(wallet, encodeOpnsRecord({ identityKey }))
		expect(await verifyPushDropBind(tx, 0, lock)).toEqual({ identityKey })
	})

	test('rejects the pre-#83 positional bind as no bind', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7003))
		const { publicKey } = await wallet.getPublicKey({ identityKey: true })
		const { tx, lock } = await bindTx(wallet, [
			Utils.toArray(publicKey, 'hex'),
			Utils.toArray('Alice', 'utf8'),
		])
		await expect(verifyPushDropBind(tx, 0, lock)).rejects.toThrow(/no bind/)
	})

	test('rejects a record signed by someone else', async () => {
		const signer = new ProtoWallet(new PrivateKey(7004))
		const other = new ProtoWallet(new PrivateKey(7005))
		const { publicKey: claimed } = await other.getPublicKey({
			identityKey: true,
		})
		const { tx, lock } = await bindTx(
			signer,
			encodeOpnsRecord({ identityKey: claimed }),
		)
		await expect(verifyPushDropBind(tx, 0, lock)).rejects.toThrow()
	})
})
