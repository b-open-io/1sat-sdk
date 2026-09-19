import { describe, expect, it } from 'bun:test'
import { PrivateKey, ProtoWallet, PushDrop, Utils } from '@bsv/sdk'
import {
	PUSHDROP_SIG_PLACEHOLDER_LEN,
	pushDropCustomInstructions,
	pushDropDecode,
	pushDropLock,
	pushDropSeal,
} from '../src/utils/pushdrop'

const PROTOCOL: [0 | 1 | 2, string] = [1, 'test pushdrop']

describe('pushDrop lifecycle', () => {
	it('mints unsealed, seals, decodes fields', async () => {
		const wallet = new ProtoWallet(new PrivateKey(8001))
		const { publicKey } = await wallet.getPublicKey({ identityKey: true })
		const fields = [
			Utils.toArray('gib', 'utf8'),
			Utils.toArray(publicKey, 'hex'),
		]
		const unsealed = await pushDropLock(wallet, {
			fields,
			protocolID: PROTOCOL,
			keyID: 'root-outpoint',
			counterparty: 'anyone',
			forSelf: true,
		})
		const before = PushDrop.decode(unsealed)
		const placeholder = before.fields[before.fields.length - 1]
		expect(placeholder.length).toBe(PUSHDROP_SIG_PLACEHOLDER_LEN)
		expect(placeholder.every((b) => b === 0)).toBe(true)

		const sealed = await pushDropSeal(wallet, unsealed, {
			protocolID: PROTOCOL,
			keyID: 'root-outpoint',
			counterparty: 'anyone',
			forSelf: true,
		})
		const after = pushDropDecode(sealed)
		const sig = after.fields[after.fields.length - 1]
		expect(sig.some((b) => b !== 0)).toBe(true)
		expect(Utils.toUTF8(after.fields[0])).toBe('gib')
		expect(sealed.toHex().length).toBeLessThanOrEqual(unsealed.toHex().length)
	})

	it('includeSignature mints already sealed', async () => {
		const wallet = new ProtoWallet(new PrivateKey(8002))
		const script = await pushDropLock(
			wallet,
			{
				fields: [Utils.toArray('x', 'utf8')],
				protocolID: PROTOCOL,
				keyID: 'k',
			},
			{ includeSignature: true },
		)
		const { fields } = pushDropDecode(script.toHex())
		expect(fields[fields.length - 1].some((b) => b !== 0)).toBe(true)
		expect(
			pushDropSeal(wallet, script, { protocolID: PROTOCOL, keyID: 'k' }),
		).rejects.toThrow(/not zeroed/)
	})

	it('customInstructions JSON', () => {
		expect(
			JSON.parse(
				pushDropCustomInstructions({ protocolID: PROTOCOL, keyID: 'k' }),
			),
		).toEqual({
			protocolID: PROTOCOL,
			keyID: 'k',
			counterparty: 'anyone',
		})
	})
})
