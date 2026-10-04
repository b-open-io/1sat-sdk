import { describe, expect, test } from 'bun:test'
import { PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import {
	decode as dagCborDecode,
	encode as dagCborEncode,
} from '@ipld/dag-cbor'
import {
	ENVELOPE_SIGNATURE_KEY_ID,
	ENVELOPE_SIGNATURE_PROTOCOL,
	type UnsignedEnvelope,
	envelopeSigningPreimage,
	signEnvelope,
} from './envelope.js'

// BRC-169 Appendix A.7 (crumbs → deggen), binary form with an empty beef.
const CRUMBS_PRIV =
	'cf94a849be462a110807900e45a909515c38a2d17b9a8e9753c9475bfd220848'
const CRUMBS_PUB =
	'0375b162a37d8794cfdcf72938d9467931e8586885b93c0da97051ecb512f46646'
const A7_PREIMAGE =
	'a76673656e646572a366646f6d61696e6d6e657875732e6578616d706c656668616e646c65666372756d62736b6964656e746974794b657958210375b162a37d8794cfdcf72938d9467931e8586885b93c0da97051ecb512f46646676372656174656474323032362d30372d33305430393a31353a30305a677061796d656e74a56462656566406870726f746f636f6c6c333234313634353136316438687361746f736869731954297064657269766174696f6e507265666978500f5bcc8d7c345d512595d55982b5a4e37064657269766174696f6e537566666978509c42b65554891520ae960a7fb477759e6771756f746549647820306433346362333963316336666530366364346133343638363765316533333469726563697069656e74a36374616768636f6e663230333666646f6d61696e686c6b75702e6e65746668616e646c656664656767656e6b636f6e74656e7448617368582076f88073e3498f542c57fb9a2133743d6f0c1f9c4632e786116568ccd393e35c6e6d6574616e657448616e646c657363312e30'
const A7_SIGNATURE =
	'304402206a2bf0b0628386870202789d718001580279cc1add7b3dc3ff81e08858e22f8c022051d6e6d5756bf2bd1d06ea5199af080e721bb1f5dddefe9a36884796d5d04cf7'

const bytes = (hex: string) => Uint8Array.from(Utils.toArray(hex, 'hex'))
const utf8 = (s: string) => Uint8Array.from(Utils.toArray(s, 'utf8'))
const b64 = (s: string) => Uint8Array.from(Utils.toArray(s, 'base64'))

const A7: UnsignedEnvelope = {
	metanetHandles: '1.0',
	recipient: { handle: 'deggen', tag: 'conf2036', domain: 'lkup.net' },
	sender: {
		identityKey: bytes(CRUMBS_PUB),
		handle: 'crumbs',
		domain: 'nexus.example',
	},
	created: '2026-07-30T09:15:00Z',
	quoteId: '0d34cb39c1c6fe06cd4a346867e1e334',
	payment: {
		derivationPrefix: b64('D1vMjXw0XVElldVZgrWk4w=='),
		derivationSuffix: b64('nEK2VVSJFSCulgp/tHd1ng=='),
		protocol: utf8('3241645161d8'),
		satoshis: 21545,
		beef: new Uint8Array(0),
	},
	contentHash: bytes(
		'76f88073e3498f542c57fb9a2133743d6f0c1f9c4632e786116568ccd393e35c',
	),
}

/**
 * BRC-169 §7.3 types `payment.protocol` as bstr, but the Appendix A.7 binary
 * vector encodes it as tstr (`6c` + 12 bytes, not `4c`). This module follows
 * the §7.3 table. To check every other member against A.7, the vector is
 * rebuilt here with the appendix's tstr protocol.
 */
const A7_AS_PRINTED = {
	...A7,
	payment: { ...A7.payment!, protocol: '3241645161d8' },
} as unknown as UnsignedEnvelope

describe('BRC-169 envelope (DAG-CBOR)', () => {
	test('signing preimage matches Appendix A.7 byte for byte (tstr protocol as printed)', () => {
		expect(
			Utils.toHex(Array.from(envelopeSigningPreimage(A7_AS_PRINTED))),
		).toBe(A7_PREIMAGE)
	})

	test('payment.protocol is encoded as bstr per the §7.3 table', () => {
		const hex = Utils.toHex(Array.from(envelopeSigningPreimage(A7)))
		// 0x4c = bstr(12); the appendix prints 0x6c = tstr(12)
		expect(hex).toContain('6870726f746f636f6c4c333234313634353136316438')
		expect(hex).toBe(
			A7_PREIMAGE.replace('6870726f746f636f6c6c', '6870726f746f636f6c4c'),
		)
	})

	test('the Appendix A.7 signature verifies under the §7.2 derivation', async () => {
		const { valid } = await new ProtoWallet('anyone').verifySignature({
			data: Array.from(envelopeSigningPreimage(A7_AS_PRINTED)),
			signature: Utils.toArray(A7_SIGNATURE, 'hex'),
			protocolID: ENVELOPE_SIGNATURE_PROTOCOL,
			keyID: ENVELOPE_SIGNATURE_KEY_ID,
			counterparty: CRUMBS_PUB,
		})
		expect(valid).toBe(true)
	})

	test('envelope bytes are canonical DAG-CBOR and carry content + signature', async () => {
		const wallet = new ProtoWallet(PrivateKey.fromHex(CRUMBS_PRIV))
		const content = utf8('opaque content')
		const { envelope, signature } = await signEnvelope(
			wallet,
			A7_AS_PRINTED,
			content,
		)

		const decoded = dagCborDecode(envelope) as Record<string, unknown>
		expect(dagCborEncode(decoded)).toEqual(envelope)
		expect(decoded.content).toEqual(content)
		expect(decoded.signature).toEqual(signature)
		const { content: _c, signature: _s, ...rest } = decoded
		expect(Utils.toHex(Array.from(dagCborEncode(rest)))).toBe(A7_PREIMAGE)
	})

	test('signature verifies from sender.identityKey with the §7.2 derivation', async () => {
		const wallet = new ProtoWallet(PrivateKey.fromHex(CRUMBS_PRIV))
		const unsigned: UnsignedEnvelope = {
			metanetHandles: '1.0',
			recipient: { handle: 'deggen', domain: 'lkup.net' },
			sender: { identityKey: bytes(CRUMBS_PUB) },
			created: '2026-10-03T00:00:00Z',
			payment: {
				derivationPrefix: new Uint8Array(16).fill(1),
				derivationSuffix: new Uint8Array(16).fill(2),
				protocol: utf8('mandala'),
				satoshis: 1,
				beef: new Uint8Array([1, 2, 3]),
			},
		}
		const { envelope } = await signEnvelope(wallet, unsigned, utf8('x'))

		// A verifier re-encodes the received map without content/signature.
		const received = dagCborDecode(envelope) as Record<string, unknown>
		const { content: _c, signature, ...rest } = received
		const sender = (rest.sender as { identityKey: Uint8Array }).identityKey
		const preimage = envelopeSigningPreimage(
			rest as unknown as UnsignedEnvelope,
		)
		expect(preimage).toEqual(envelopeSigningPreimage(unsigned))

		const verifier = new ProtoWallet('anyone')
		const { valid } = await verifier.verifySignature({
			data: Array.from(preimage),
			signature: Array.from(signature as Uint8Array),
			protocolID: ENVELOPE_SIGNATURE_PROTOCOL,
			keyID: ENVELOPE_SIGNATURE_KEY_ID,
			counterparty: Utils.toHex(Array.from(sender)),
		})
		expect(valid).toBe(true)
	})
})
