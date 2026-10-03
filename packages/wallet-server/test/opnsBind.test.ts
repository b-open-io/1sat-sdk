import { describe, expect, test } from 'bun:test'
import { outpointToBytes } from '@1sat/templates'
import {
	IDENTITY_FIELD,
	OPNS_REGISTER_COUNTERPARTY,
	P1SAT_PROTOCOL,
	PROFILE_FIELD,
	opnsRegisterKeyId,
} from '@1sat/types'
import { type Profile, encodeProfile } from '@1sat/utils'
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
const utf8 = (s: string) => Utils.toArray(s, 'utf8')

/** `["identity", key, "profile", cbor?]` — the layout registerOpns writes. */
function publishFields(identityKey: string, profile?: Profile): number[][] {
	return [
		utf8(IDENTITY_FIELD),
		Utils.toArray(identityKey, 'hex'),
		...(profile ? [utf8(PROFILE_FIELD), encodeProfile(profile)] : []),
	]
}

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

async function identityOf(wallet: ProtoWallet): Promise<string> {
	return (await wallet.getPublicKey({ identityKey: true })).publicKey
}

describe('verifyPushDropBind (key/value fields)', () => {
	test('decodes identity and profile from signed fields', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7001))
		const identityKey = await identityOf(wallet)
		const { tx, lock } = await bindTx(
			wallet,
			publishFields(identityKey, {
				domain: '1sat.name',
				name: 'Alice',
				avatar: outpointToBytes(AVATAR) ?? undefined,
			}),
		)
		expect(await verifyPushDropBind(tx, 0, lock)).toEqual({
			identityKey,
			domain: '1sat.name',
			profileName: 'Alice',
			avatarOrigin: AVATAR,
		})
	})

	test('identity only has no profile members', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7002))
		const identityKey = await identityOf(wallet)
		const { tx, lock } = await bindTx(wallet, publishFields(identityKey))
		expect(await verifyPushDropBind(tx, 0, lock)).toEqual({ identityKey })
	})

	test('unknown pairs are skipped, in any position', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7006))
		const identityKey = await identityOf(wallet)
		const [idK, idV, prK, prV] = publishFields(identityKey, {
			domain: '1sat.name',
		})
		const { tx, lock } = await bindTx(wallet, [
			utf8('future'),
			[1, 2, 3],
			idK,
			idV,
			utf8('other'),
			utf8('x'),
			prK,
			prV,
		])
		expect(await verifyPushDropBind(tx, 0, lock)).toEqual({
			identityKey,
			domain: '1sat.name',
		})
	})

	test('missing or duplicate identity is no bind', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7007))
		const identityKey = await identityOf(wallet)
		const [idK, idV, prK, prV] = publishFields(identityKey, {
			domain: '1sat.name',
		})
		const missing = await bindTx(wallet, [prK, prV])
		await expect(
			verifyPushDropBind(missing.tx, 0, missing.lock),
		).rejects.toThrow(/no bind: missing identity/)
		const dup = await bindTx(wallet, [idK, idV, idK, idV])
		await expect(verifyPushDropBind(dup.tx, 0, dup.lock)).rejects.toThrow(
			/no bind: duplicate identity/,
		)
	})

	test('rejects the pre-#83 positional bind as no bind', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7003))
		const identityKey = await identityOf(wallet)
		const { tx, lock } = await bindTx(wallet, [
			Utils.toArray(identityKey, 'hex'),
			utf8('Alice'),
		])
		await expect(verifyPushDropBind(tx, 0, lock)).rejects.toThrow(/no bind/)
	})

	test('rejects fields signed by someone else', async () => {
		const signer = new ProtoWallet(new PrivateKey(7004))
		const claimed = await identityOf(new ProtoWallet(new PrivateKey(7005)))
		const { tx, lock } = await bindTx(signer, publishFields(claimed))
		await expect(verifyPushDropBind(tx, 0, lock)).rejects.toThrow()
	})
})
