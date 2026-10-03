import { describe, expect, test } from 'bun:test'
import { Inscription, outpointFromBytes } from '@1sat/templates'
import {
	IDENTITY_FIELD,
	OPNS_BASKET,
	OPNS_REGISTER_SIG_PLACEHOLDER_LEN,
	P1SAT_PROTOCOL,
	PROFILE_FIELD,
	opnsRegisterKeyId,
} from '@1sat/types'
import { decodeProfile } from '@1sat/utils'
import {
	type CreateActionArgs,
	LockingScript,
	PrivateKey,
	ProtoWallet,
	PushDrop,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import { applyOpnsRegister } from '../apply/opnsRegister.js'
import { DIR_CONTENT_TYPE, DIR_VERSION, dirEncode } from '../ordfs/dir.js'
import { createContext } from '../types.js'
import { pushDropDecode } from '../utils/pushdrop.js'
import { registerOpns } from './index.js'

const NAME_OUTPOINT = `${'cd'.repeat(32)}.0`
const AVATAR = `${'ef'.repeat(32)}_1`

/** ProtoWallet keys + a one-row OPNS basket; createAction records its args. */
function fakeWallet(seed: number) {
	const proto = new ProtoWallet(new PrivateKey(seed))
	const created: CreateActionArgs[] = []
	const wallet = {
		getPublicKey: proto.getPublicKey.bind(proto),
		createSignature: proto.createSignature.bind(proto),
		async listOutputs() {
			return {
				totalOutputs: 1,
				BEEF: [1, 2, 3],
				outputs: [
					{
						outpoint: NAME_OUTPOINT,
						satoshis: 1,
						spendable: true,
						tags: ['opns', 'name:alice', 'id:name-1'],
						customInstructions: JSON.stringify({
							protocolID: P1SAT_PROTOCOL,
							keyID: '1sat 0',
							counterparty: 'self',
							name: 'alice',
						}),
					},
				],
			}
		},
		async createAction(args: CreateActionArgs) {
			created.push(args)
			return { txid: 'ab'.repeat(32) }
		},
	} as unknown as WalletInterface
	return { wallet, proto, created }
}

async function draftFor(
	seed: number,
	extra: Partial<Parameters<typeof registerOpns.execute>[1]> = {},
) {
	const { wallet, proto, created } = fakeWallet(seed)
	const res = await registerOpns.execute(createContext(wallet), {
		id: 'name-1',
		profile: { domain: '1sat.name' },
		usePermissionModule: true,
		...extra,
	})
	expect(res.error).toBeUndefined()
	expect(created).toHaveLength(1)
	const args = created[0]
	const out = args.outputs?.find((o) => o.basket === OPNS_BASKET)
	if (!out) throw new Error('no opns output')
	return { args, out, proto }
}

async function verifySealed(proto: ProtoWallet, script: LockingScript) {
	const fields = PushDrop.decode(script).fields.map((f) => [...f])
	const signature = fields.pop() as number[]
	const { publicKey: identityKey } = await proto.getPublicKey({
		identityKey: true,
	})
	const { valid } = await new ProtoWallet('anyone').verifySignature({
		data: fields.flat(),
		signature,
		protocolID: P1SAT_PROTOCOL,
		keyID: opnsRegisterKeyId(NAME_OUTPOINT),
		counterparty: identityKey,
	})
	return { valid, fields }
}

describe('registerOpns record', () => {
	test('builds identity + profile pairs with a zeroed signature field', async () => {
		const { out, proto } = await draftFor(9001, {
			profile: { domain: '1sat.name', name: 'Alice', avatar: AVATAR },
		})
		const { fields } = pushDropDecode(out.lockingScript)
		expect(fields).toHaveLength(5)
		expect(Utils.toUTF8(fields[0])).toBe(IDENTITY_FIELD)
		expect(Utils.toUTF8(fields[2])).toBe(PROFILE_FIELD)
		const sig = fields[4]
		expect(sig).toHaveLength(OPNS_REGISTER_SIG_PLACEHOLDER_LEN)
		expect(sig.every((b) => b === 0)).toBe(true)

		const { publicKey } = await proto.getPublicKey({ identityKey: true })
		expect(Utils.toHex(fields[1])).toBe(publicKey)
		const profile = decodeProfile(fields[3])
		expect(profile.domain).toBe('1sat.name')
		expect(profile.name).toBe('Alice')
		expect(outpointFromBytes(profile.avatar ?? [])).toBe(AVATAR)
		expect(Inscription.decode(LockingScript.fromHex(out.lockingScript))).toBe(
			null,
		)
	})

	test('rejects a missing or invalid domain', async () => {
		const { wallet } = fakeWallet(9002)
		const res = await registerOpns.execute(createContext(wallet), {
			id: 'name-1',
			profile: { domain: 'not a host' },
			usePermissionModule: true,
		})
		expect(res.error).toMatch(/domain/)
	})

	test('apply swaps in the real signature (no inscription)', async () => {
		const { args, out, proto } = await draftFor(9003)
		const draft = out.lockingScript
		await applyOpnsRegister(proto as unknown as WalletInterface, args)
		expect(out.lockingScript).not.toBe(draft)
		expect(out.lockingScript.length).toBeLessThanOrEqual(draft.length)
		const { valid, fields } = await verifySealed(
			proto,
			LockingScript.fromHex(out.lockingScript),
		)
		expect(valid).toBe(true)
		expect(fields).toHaveLength(4)
	})

	test('inscription rides after the PushDrop and survives apply', async () => {
		const content = dirEncode({
			version: DIR_VERSION,
			entries: [
				{
					name: new TextEncoder().encode('.'),
					isDir: true,
					ref: { kind: 'outpoint', txid: '12'.repeat(32), vout: 0 },
				},
			],
		})
		const { args, out, proto } = await draftFor(9004, {
			inscription: { contentType: DIR_CONTENT_TYPE, content },
		})
		const draftChunks = LockingScript.fromHex(out.lockingScript).chunks

		const before = Inscription.decode(LockingScript.fromHex(out.lockingScript))
		expect(before?.file.type).toBe(DIR_CONTENT_TYPE)
		expect(Array.from(before?.file.content ?? [])).toEqual(Array.from(content))

		await applyOpnsRegister(proto as unknown as WalletInterface, args)
		const sealed = LockingScript.fromHex(out.lockingScript)
		const { valid } = await verifySealed(proto, sealed)
		expect(valid).toBe(true)

		// In-place swap: only the signature push (chunk 2 + 4 fields) changed.
		expect(sealed.chunks).toHaveLength(draftChunks.length)
		sealed.chunks.forEach((chunk, i) => {
			if (i === 6) {
				expect(chunk.data?.some((b) => b !== 0)).toBe(true)
				expect(chunk.op).toBe(chunk.data?.length ?? -1)
			} else {
				expect(chunk).toEqual(draftChunks[i])
			}
		})

		const after = Inscription.decode(sealed)
		expect(after?.file.type).toBe(DIR_CONTENT_TYPE)
		expect(Array.from(after?.file.content ?? [])).toEqual(Array.from(content))
		// The envelope follows the PushDrop: its prefix is the sealed lock.
		const prefix = after?.scriptPrefix
		expect(prefix).toBeDefined()
		const prefixFields = PushDrop.decode(
			LockingScript.fromHex(prefix?.toHex() ?? ''),
		).fields
		expect(prefixFields[prefixFields.length - 1].some((b) => b !== 0)).toBe(
			true,
		)
	})

	test('apply refuses a draft locked to a different key', async () => {
		const { args } = await draftFor(9006)
		const other = new ProtoWallet(new PrivateKey(9007))
		await expect(
			applyOpnsRegister(other as unknown as WalletInterface, args),
		).rejects.toThrow(/lock key/)
	})

	test('apply refuses a positional (pre-#83) draft', async () => {
		const proto = new ProtoWallet(new PrivateKey(9005))
		const { publicKey } = await proto.getPublicKey({ identityKey: true })
		const lock = await new PushDrop(proto as unknown as WalletInterface).lock(
			[
				Utils.toArray(publicKey, 'hex'),
				new Array(OPNS_REGISTER_SIG_PLACEHOLDER_LEN).fill(0),
			],
			P1SAT_PROTOCOL,
			opnsRegisterKeyId(NAME_OUTPOINT),
			'anyone',
			true,
			false,
		)
		const args: CreateActionArgs = {
			description: 'positional',
			inputs: [{ outpoint: NAME_OUTPOINT, inputDescription: 'name' }],
			outputs: [
				{
					lockingScript: lock.toHex(),
					satoshis: 1,
					outputDescription: 'bind',
					basket: OPNS_BASKET,
				},
			],
		}
		await expect(
			applyOpnsRegister(proto as unknown as WalletInterface, args),
		).rejects.toThrow(/key\/value pairs/)
	})
})
