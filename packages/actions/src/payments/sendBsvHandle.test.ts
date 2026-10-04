import { beforeEach, describe, expect, test } from 'bun:test'
import { BRC29_PROTOCOL_ID } from '@1sat/types'
import {
	TRANSACTION_CBOR_CONTENT_TYPE,
	encodeMimeEntity,
	parseMimeEntity,
} from '@1sat/utils'
import {
	type CreateActionArgs,
	EncryptedMessage,
	Hash,
	type InternalizeActionArgs,
	LockingScript,
	MerklePath,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	Transaction,
	UnlockingScript,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import {
	decode as dagCborDecode,
	encode as dagCborEncode,
} from '@ipld/dag-cbor'
import { encryptBrc78 } from '../metanet/brc78.js'
import {
	ENVELOPE_SIGNATURE_KEY_ID,
	ENVELOPE_SIGNATURE_PROTOCOL,
	type EnvelopePayment,
	envelopeSigningPreimage,
	signEnvelope,
} from '../metanet/envelope.js'
import { syncMetanetInbox } from '../metanet/receive.js'
import { messageRelay } from '../metanet/relay.js'
import { createContext } from '../types.js'
import { sendBsv } from './index.js'

// BRC-231 relay fake (substituted on messageRelay): one in-memory messagebox.
interface Stored {
	messagebox: string
	recipient: string
	messageBox: string
	body: Uint8Array
	messageId: string
}
const relayed: Stored[] = []
const acknowledged: string[][] = []
const listed: Array<{ messagebox: string; messageBox: string }> = []

const SENDER = PrivateKey.fromHex('11'.repeat(32))
const SENDER_ID = SENDER.toPublicKey().toString()
const RECIPIENT = PrivateKey.fromHex('22'.repeat(32))
const RECIPIENT_ID = RECIPIENT.toPublicKey().toString()
const RESOLVED_BOX = 'https://messagebox.lkup.net'
const DEFAULT_BOX = 'https://messagebox.1sat.app'

beforeEach(() => {
	relayed.length = 0
	acknowledged.length = 0
	listed.length = 0
	Object.assign(messageRelay, {
		sendCborMessage: async (
			_wallet: unknown,
			messagebox: string,
			recipient: string,
			messageBox: string,
			body: Uint8Array,
		) => {
			const messageId = `env-${relayed.length + 1}`
			relayed.push({ messagebox, recipient, messageBox, body, messageId })
			return { status: 'success', messageId }
		},
		listCborMessages: async (
			wallet: WalletInterface,
			messagebox: string,
			messageBox: string,
		) => {
			listed.push({ messagebox, messageBox })
			const { publicKey } = await wallet.getPublicKey({ identityKey: true })
			return relayed
				.filter((m) => m.recipient === publicKey && m.messageBox === messageBox)
				.map((m) => ({
					messageId: m.messageId,
					body: m.body,
					sender: new Uint8Array(33),
				}))
		},
		acknowledgeCborMessages: async (
			_wallet: unknown,
			_messagebox: string,
			messageIds: string[],
		) => {
			acknowledged.push(messageIds)
			return { status: 'success' }
		},
	})
})

/** Sender wallet: ProtoWallet crypto plus a createAction that builds a funded tx. */
function senderWallet() {
	const createArgs: CreateActionArgs[] = []
	const wallet = Object.assign(Object.create(new ProtoWallet(SENDER)), {
		createAction: async (args: CreateActionArgs) => {
			createArgs.push(args)
			const parent = new Transaction()
			parent.addOutput({
				lockingScript: new LockingScript([]),
				satoshis: 100000,
			})
			parent.merklePath = new MerklePath(1, [
				[{ offset: 0, hash: parent.id('hex'), txid: true }],
			])
			const tx = new Transaction()
			tx.addInput({
				sourceTransaction: parent,
				sourceOutputIndex: 0,
				unlockingScript: new UnlockingScript([]),
			})
			for (const out of args.outputs ?? []) {
				tx.addOutput({
					lockingScript: LockingScript.fromHex(out.lockingScript),
					satoshis: out.satoshis,
				})
			}
			return { txid: tx.id('hex'), tx: tx.toAtomicBEEF() }
		},
	}) as WalletInterface
	return { wallet, createArgs }
}

/** Recipient wallet: ProtoWallet crypto plus a recorded internalizeAction. */
function recipientWallet(fail = false) {
	const internalized: InternalizeActionArgs[] = []
	const wallet = Object.assign(Object.create(new ProtoWallet(RECIPIENT)), {
		internalizeAction: async (args: InternalizeActionArgs) => {
			if (fail) throw new Error('internalize refused')
			internalized.push(args)
			return { accepted: true }
		},
	}) as WalletInterface
	return { wallet, internalized }
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status })

/**
 * Network fake: `lkup.net` offers BRC-169 handles (deggen → RECIPIENT);
 * `paymail.example` has no manifest and serves paymail P2P.
 */
async function withNetwork<T>(fn: (calls: string[]) => Promise<T>): Promise<T> {
	const calls: string[] = []
	const realFetch = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input)
		calls.push(url)
		if (url === 'https://lkup.net/manifest.json') {
			return json({ metanet: { handles: { version: '1.0' } } })
		}
		if (
			url ===
			'https://lkup.net/.well-known/metanet-handles/resolve?handle=deggen'
		) {
			return json({
				metanetHandles: '1.0',
				handle: 'deggen',
				domain: 'lkup.net',
				identityKey: RECIPIENT_ID,
				certificate: { subject: RECIPIENT_ID },
				messagebox: RESOLVED_BOX,
				ttl: 3600,
				revoked: false,
			})
		}
		if (url.startsWith('https://dns.google.com/resolve')) {
			return json({ Status: 3 })
		}
		if (url === 'https://paymail.example:443/.well-known/bsvalias') {
			return json({
				capabilities: {
					'2a40af698840': 'https://paymail.example/p2p/{alias}/dest',
					'5c55a7fdb7bb': 'https://paymail.example/p2p/{alias}/beef',
				},
			})
		}
		if (url === 'https://paymail.example/p2p/alice/dest') {
			return json({
				reference: 'ref-1',
				outputs: [
					{
						script: new P2PKH()
							.lock(RECIPIENT.toPublicKey().toAddress())
							.toHex(),
						satoshis: 1000,
					},
				],
			})
		}
		if (url === 'https://paymail.example/p2p/alice/beef') {
			return json({ txid: 'x' })
		}
		return new Response('not found', { status: 404 })
	}) as typeof fetch
	try {
		return await fn(calls)
	} finally {
		globalThis.fetch = realFetch
	}
}

interface Envelope {
	metanetHandles: string
	recipient: { handle: string; tag?: string; domain: string }
	sender: { identityKey: Uint8Array }
	created: string
	payment: EnvelopePayment
	contentHash: Uint8Array
	content: Uint8Array
	signature: Uint8Array
}

/** Post a signed envelope from SENDER to the recipient's metanet_inbox. */
async function postEnvelope(
	mime: Uint8Array,
	payment: EnvelopePayment | null,
	hashed: Uint8Array = mime,
): Promise<string> {
	const proto = new ProtoWallet(SENDER)
	const content = await encryptBrc78(proto, Array.from(mime), RECIPIENT_ID)
	const { envelope } = await signEnvelope(
		proto,
		{
			metanetHandles: '1.0',
			recipient: { handle: 'deggen', domain: 'lkup.net' },
			sender: { identityKey: Uint8Array.from(Utils.toArray(SENDER_ID, 'hex')) },
			created: '2026-10-03T00:00:00Z',
			payment,
			contentHash: Uint8Array.from(Hash.sha256(Array.from(hashed))),
		},
		Uint8Array.from(content),
	)
	const messageId = `env-${relayed.length + 1}`
	relayed.push({
		messagebox: RESOLVED_BOX,
		recipient: RECIPIENT_ID,
		messageBox: 'metanet_inbox',
		body: envelope,
		messageId,
	})
	return messageId
}

describe('sendBsv destination rules', () => {
	test('@handle@domain is BRC-169 only: no paymail fallback', async () => {
		const { wallet, createArgs } = senderWallet()
		const res = await withNetwork(async (calls) => {
			const r = await sendBsv.execute(createContext(wallet), {
				requests: [{ handle: '@alice@paymail.example', satoshis: 1000 }],
			})
			expect(calls.some((c) => c.includes('bsvalias'))).toBe(false)
			expect(calls.some((c) => c.includes('dns.google'))).toBe(false)
			return r
		})
		expect(res.error).toContain('paymail.example')
		expect(createArgs).toHaveLength(0)
	})

	test('handle@domain whose manifest offers handles is BRC-169', async () => {
		const { wallet, createArgs } = senderWallet()
		const res = await withNetwork(() =>
			sendBsv.execute(createContext(wallet), {
				requests: [{ paymail: 'deggen@lkup.net', satoshis: 1000 }],
			}),
		)
		expect(res.error).toBeUndefined()
		expect(res.delivered).toBe('envelope')
		expect(createArgs[0].options?.noSend).toBe(true)
		expect(relayed).toHaveLength(1)
	})

	test('handle@domain without a handles manifest takes the paymail path', async () => {
		for (const req of [
			{ paymail: 'alice@paymail.example', satoshis: 1000 },
			{ handle: 'alice@paymail.example', satoshis: 1000 },
		]) {
			const { wallet, createArgs } = senderWallet()
			const res = await withNetwork(async (calls) => {
				const r = await sendBsv.execute(createContext(wallet), {
					requests: [req],
				})
				expect(calls[0]).toBe('https://paymail.example/manifest.json')
				expect(calls).toContain('https://paymail.example/p2p/alice/beef')
				return r
			})
			expect(res.error).toBeUndefined()
			expect(res.delivered).toBeUndefined()
			expect(createArgs).toHaveLength(1)
			expect(createArgs[0].options?.noSend).toBeUndefined()
			expect(createArgs[0].outputs?.[0].outputDescription).toBe(
				'Paymail payment to alice@paymail.example',
			)
			expect(relayed).toHaveLength(0)
		}
	})

	test('a handle payment must be the only request', async () => {
		const { wallet, createArgs } = senderWallet()
		const res = await withNetwork(() =>
			sendBsv.execute(createContext(wallet), {
				requests: [
					{ handle: '@deggen@lkup.net', satoshis: 1000 },
					{ address: RECIPIENT.toPublicKey().toAddress(), satoshis: 1000 },
				],
			}),
		)
		expect(res.error).toBe('handle-payment-must-be-the-only-request')
		expect(createArgs).toHaveLength(0)
	})
})

describe('sendBsv to a BRC-169 handle', () => {
	test('protected noSend BRC-29 output, envelope to the resolved metanet_inbox', async () => {
		const { wallet, createArgs } = senderWallet()
		const res = await withNetwork(() =>
			sendBsv.execute(createContext(wallet), {
				requests: [
					{
						handle: '@deggen+conf@lkup.net',
						satoshis: 21545,
						memo: 'See you at conf2036',
					},
				],
			}),
		)
		expect(res.error).toBeUndefined()
		expect(res.delivered).toBe('envelope')
		expect(res.messageId).toBe('env-1')

		// One protected noSend action, one output.
		expect(createArgs).toHaveLength(1)
		const args = createArgs[0]
		expect(args.options).toEqual({ noSend: true, randomizeOutputs: false })
		expect(args.labels).toEqual(['p nosend expiry seconds 31536000'])
		expect(args.outputs).toHaveLength(1)
		expect(args.outputs![0].satoshis).toBe(21545)

		// Delivered to the resolved messagebox, box metanet_inbox.
		expect(relayed).toHaveLength(1)
		expect(relayed[0].messagebox).toBe(RESOLVED_BOX)
		expect(relayed[0].recipient).toBe(RECIPIENT_ID)
		expect(relayed[0].messageBox).toBe('metanet_inbox')

		const env = dagCborDecode(relayed[0].body) as Envelope
		expect(env.metanetHandles).toBe('1.0')
		expect(env.recipient).toEqual({
			handle: 'deggen',
			tag: 'conf',
			domain: 'lkup.net',
		})
		expect(Utils.toHex(Array.from(env.sender.identityKey))).toBe(SENDER_ID)

		// payment: BRC-29 fields as bstr, beef = the action's Atomic BEEF.
		const payment = env.payment
		expect(Utils.toUTF8(Array.from(payment.protocol))).toBe('3241645161d8')
		expect(payment.satoshis).toBe(21545)
		expect(Array.from(payment.beef)).toEqual(res.tx!)
		expect(payment.derivationPrefix).toHaveLength(16)
		expect(payment.derivationSuffix).toHaveLength(16)

		// The output pays the key the recipient derives under BRC-29.
		const keyID = `${Utils.toBase64(Array.from(payment.derivationPrefix))} ${Utils.toBase64(Array.from(payment.derivationSuffix))}`
		const { publicKey: derived } = await new ProtoWallet(SENDER).getPublicKey({
			protocolID: BRC29_PROTOCOL_ID,
			keyID,
			counterparty: RECIPIENT_ID,
		})
		const { publicKey: recipientDerived } = await new ProtoWallet(
			RECIPIENT,
		).getPublicKey({
			protocolID: BRC29_PROTOCOL_ID,
			keyID,
			counterparty: SENDER_ID,
			forSelf: true,
		})
		expect(recipientDerived).toBe(derived)
		expect(args.outputs![0].lockingScript).toBe(
			new P2PKH().lock(PublicKey.fromString(derived).toAddress()).toHex(),
		)

		// content: BRC-78 to the recipient, a text/plain MIME memo.
		const plaintext = EncryptedMessage.decrypt(
			Array.from(env.content),
			RECIPIENT,
		)
		expect(Utils.toUTF8(plaintext)).toBe(
			'Content-Type: text/plain; charset=utf-8\r\n\r\nSee you at conf2036',
		)
		const entity = parseMimeEntity(plaintext)
		expect(entity.contentType).toBe('text/plain; charset=utf-8')
		expect(Array.from(env.contentHash)).toEqual(Hash.sha256(plaintext))

		// signature: §7.2 item 3, verifiable from sender.identityKey.
		const { content: _c, signature, ...unsigned } = env
		const { valid } = await new ProtoWallet('anyone').verifySignature({
			data: Array.from(envelopeSigningPreimage(unsigned)),
			signature: Array.from(signature),
			protocolID: ENVELOPE_SIGNATURE_PROTOCOL,
			keyID: ENVELOPE_SIGNATURE_KEY_ID,
			counterparty: SENDER_ID,
		})
		expect(valid).toBe(true)
	})

	test('an empty memo is an empty text/plain body', async () => {
		const { wallet } = senderWallet()
		await withNetwork(() =>
			sendBsv.execute(createContext(wallet), {
				requests: [{ handle: '@deggen@lkup.net', satoshis: 1 }],
			}),
		)
		const env = dagCborDecode(relayed[0].body) as Envelope
		expect(
			Utils.toUTF8(
				EncryptedMessage.decrypt(Array.from(env.content), RECIPIENT),
			),
		).toBe('Content-Type: text/plain; charset=utf-8\r\n\r\n')
	})

	test('a failed delivery returns the noSend action and the error', async () => {
		const { wallet } = senderWallet()
		messageRelay.sendCborMessage = async () => {
			throw new Error('sendMessage 503')
		}
		const res = await withNetwork(() =>
			sendBsv.execute(createContext(wallet), {
				requests: [{ handle: '@deggen@lkup.net', satoshis: 1 }],
			}),
		)
		expect(res.txid).toBeDefined()
		expect(res.tx).toBeDefined()
		expect(res.delivered).toBeUndefined()
		expect(res.error).toBe('delivery-failed: sendMessage 503')
	})
})

describe('syncMetanetInbox', () => {
	async function sendPayment(memo?: string) {
		const { wallet } = senderWallet()
		const res = await withNetwork(() =>
			sendBsv.execute(createContext(wallet), {
				requests: [{ handle: '@deggen@lkup.net', satoshis: 21545, memo }],
			}),
		)
		expect(res.error).toBeUndefined()
		return res
	}

	test('round trip: a sent payment is verified, decrypted, internalized as a wallet payment, then acknowledged', async () => {
		const sent = await sendPayment('lunch')
		const env = dagCborDecode(relayed[0].body) as Envelope

		const { wallet, internalized } = recipientWallet()
		const res = await syncMetanetInbox.execute(createContext(wallet), {})
		expect(res.error).toBeUndefined()
		expect(listed).toEqual([
			{ messagebox: DEFAULT_BOX, messageBox: 'metanet_inbox' },
		])
		expect(res.skipped).toEqual([])
		expect(res.received).toEqual([
			{
				messageId: 'env-1',
				txid: sent.txid!,
				sender: SENDER_ID,
				satoshis: 21545,
				memo: 'lunch',
				tokenIds: [],
			},
		])

		expect(internalized).toHaveLength(1)
		const args = internalized[0]
		expect(Transaction.fromAtomicBEEF(args.tx).id('hex')).toBe(sent.txid!)
		expect(args.outputs).toEqual([
			{
				outputIndex: 0,
				protocol: 'wallet payment',
				paymentRemittance: {
					derivationPrefix: Utils.toBase64(
						Array.from(env.payment.derivationPrefix),
					),
					derivationSuffix: Utils.toBase64(
						Array.from(env.payment.derivationSuffix),
					),
					senderIdentityKey: SENDER_ID,
				},
			},
		])
		expect(args.labels).toEqual(['metanet payment'])
		expect(args.description).toBe('Metanet payment: lunch')
		expect(acknowledged).toEqual([['env-1']])
	})

	test('a failed internalize is not acknowledged', async () => {
		await sendPayment()
		const { wallet } = recipientWallet(true)
		const res = await syncMetanetInbox.execute(createContext(wallet), {})
		expect(res.skipped).toEqual([
			{ messageId: 'env-1', reason: 'internalize refused' },
		])
		expect(acknowledged).toEqual([])
	})

	test('a bad signature is left unacknowledged and reported', async () => {
		await sendPayment()
		const env = dagCborDecode(relayed[0].body) as Record<string, unknown>
		;(env.payment as { satoshis: number }).satoshis = 1
		relayed[0].body = dagCborEncode(env)
		const { wallet, internalized } = recipientWallet()
		const res = await syncMetanetInbox.execute(createContext(wallet), {})
		expect(res.skipped).toEqual([
			{ messageId: 'env-1', reason: 'envelope signature does not verify' },
		])
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	})

	test('a contentHash mismatch is left unacknowledged and reported', async () => {
		const id = await postEnvelope(
			encodeMimeEntity('text/plain', Utils.toArray('a', 'utf8')),
			null,
			encodeMimeEntity('text/plain', Utils.toArray('b', 'utf8')),
		)
		const { wallet, internalized } = recipientWallet()
		const res = await syncMetanetInbox.execute(createContext(wallet), {})
		expect(res.skipped).toEqual([
			{ messageId: id, reason: 'contentHash does not match the content' },
		])
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	})

	test('a JSON envelope is reported, not acknowledged', async () => {
		relayed.push({
			messagebox: RESOLVED_BOX,
			recipient: RECIPIENT_ID,
			messageBox: 'metanet_inbox',
			body: Uint8Array.from(Utils.toArray('{"metanetHandles":"1.0"}', 'utf8')),
			messageId: 'json-1',
		})
		const { wallet } = recipientWallet()
		const res = await syncMetanetInbox.execute(createContext(wallet), {})
		expect(res.skipped).toEqual([
			{ messageId: 'json-1', reason: 'not a DAG-CBOR BRC-169 envelope' },
		])
		expect(acknowledged).toEqual([])
	})

	test('BRC-232 transaction content is processed as the Mandala inbox processes it', async () => {
		// A BRC-232 delivery carrying a BRC-29 wallet-payment output.
		const sent = await sendPayment()
		const env = dagCborDecode(relayed[0].body) as Envelope
		relayed.length = 0
		const body = {
			txid: Uint8Array.from(Utils.toArray(sent.txid!, 'hex')),
			beef: Uint8Array.from(sent.tx!),
			outputs: [
				{
					outputIndex: 0,
					protocol: 'wallet payment',
					derivationPrefix: Utils.toBase64(
						Array.from(env.payment.derivationPrefix),
					),
					derivationSuffix: Utils.toBase64(
						Array.from(env.payment.derivationSuffix),
					),
					senderIdentityKey: Uint8Array.from(Utils.toArray(SENDER_ID, 'hex')),
				},
			],
		}
		const id = await postEnvelope(
			encodeMimeEntity(TRANSACTION_CBOR_CONTENT_TYPE, dagCborEncode(body)),
			null,
		)
		const { wallet, internalized } = recipientWallet()
		const res = await syncMetanetInbox.execute(createContext(wallet), {})
		expect(res.skipped).toEqual([])
		expect(res.received).toEqual([
			{ messageId: id, txid: sent.txid!, sender: SENDER_ID, tokenIds: [] },
		])
		expect(internalized).toHaveLength(1)
		expect(internalized[0].description).toBe('Receive delivered outputs')
		expect(internalized[0].labels).toBeUndefined()
		expect(internalized[0].outputs[0]).toEqual({
			outputIndex: 0,
			protocol: 'wallet payment',
			paymentRemittance: {
				derivationPrefix: body.outputs[0].derivationPrefix,
				derivationSuffix: body.outputs[0].derivationSuffix,
				senderIdentityKey: SENDER_ID,
			},
		})
		expect(acknowledged).toEqual([[id]])
	})

	test('a message with neither payment nor transaction content is left unacknowledged', async () => {
		const id = await postEnvelope(
			encodeMimeEntity('text/plain', Utils.toArray('hi', 'utf8')),
			null,
		)
		const { wallet, internalized } = recipientWallet()
		const res = await syncMetanetInbox.execute(createContext(wallet), {})
		expect(res.skipped).toEqual([
			{
				messageId: id,
				reason: 'nothing to internalize: no payment, content type text/plain',
			},
		])
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	})
})
