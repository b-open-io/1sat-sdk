import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Mandala } from '@1sat/templates'
import { mandalaProtocol } from '@1sat/types'
import {
	Beef,
	type CreateActionArgs,
	EncryptedMessage,
	Hash,
	LockingScript,
	MerklePath,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	type SignActionArgs,
	Transaction,
	UnlockingScript,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import { decode as dagCborDecode } from '@ipld/dag-cbor'

// Messagebox fake: records sends instead of touching the network.
const sent: Array<{ host?: string; message: Record<string, unknown> }> = []
mock.module('@bsv/message-box-client', () => ({
	MessageBoxClient: class {
		host?: string
		constructor(opts: { host?: string }) {
			this.host = opts.host
		}
		async sendMessage(message: Record<string, unknown>, host?: string) {
			sent.push({ host: host ?? this.host, message })
			return { status: 'success', messageId: 'msg-1' }
		}
	},
}))

// BRC-231 relay fake: records CBOR sends instead of AuthFetch.
const relayed: Array<{
	messagebox: string
	recipient: string
	messageBox: string
	body: Uint8Array
}> = []
mock.module('./relay.js', () => ({
	sendCborMessage: async (
		_wallet: unknown,
		messagebox: string,
		recipient: string,
		messageBox: string,
		body: Uint8Array,
	) => {
		relayed.push({ messagebox, recipient, messageBox, body })
		return { status: 'success', messageId: 'env-1' }
	},
}))

const { sendMandala } = await import('./send.js')
const {
	envelopeSigningPreimage,
	ENVELOPE_SIGNATURE_PROTOCOL,
	ENVELOPE_SIGNATURE_KEY_ID,
} = await import('./envelope.js')
const { createContext } = await import('../types.js')

const TOKEN_ID = 'ab'.repeat(32)
const SENDER = PrivateKey.fromHex('11'.repeat(32))
const RECIPIENT = PrivateKey.fromHex('22'.repeat(32))
const RECIPIENT_ID = RECIPIENT.toPublicKey().toString()
const MESSAGEBOX = 'https://messagebox.example'
const HOLD_KEY_ID = 'hold-1'
const PROTOCOL = mandalaProtocol(TOKEN_ID)

/** A mined parent, then a tx holding one 100-unit Mandala output for the sender. */
async function walletHolding(proto: ProtoWallet) {
	const parent = new Transaction()
	parent.addOutput({ lockingScript: new LockingScript([]), satoshis: 1000 })
	parent.merklePath = new MerklePath(1, [
		[{ offset: 0, hash: parent.id('hex'), txid: true }],
	])

	const { publicKey } = await proto.getPublicKey({
		protocolID: PROTOCOL,
		keyID: HOLD_KEY_ID,
		counterparty: 'self',
		forSelf: true,
	})
	const holding = new Transaction()
	holding.addInput({
		sourceTransaction: parent,
		sourceOutputIndex: 0,
		unlockingScript: new UnlockingScript([]),
	})
	holding.addOutput({
		lockingScript: Mandala.value(`${TOKEN_ID}_0`, 100n, {
			lock: new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()),
		}).lock(),
		satoshis: 1,
	})
	return holding
}

interface Recorded {
	createArgs: CreateActionArgs[]
	signArgs: SignActionArgs[]
	listBaskets: string[]
	holdingTxid: string
}

/** BRC-100 fake over a ProtoWallet: lists the holding, builds signable txs, applies spends. */
async function fakeWallet(): Promise<{
	wallet: WalletInterface
	rec: Recorded
}> {
	const proto = new ProtoWallet(SENDER)
	const holding = await walletHolding(proto)
	const rec: Recorded = {
		createArgs: [],
		signArgs: [],
		listBaskets: [],
		holdingTxid: holding.id('hex'),
	}
	let pending: Transaction | undefined

	const wallet = Object.assign(Object.create(proto), {
		listOutputs: async (args: { basket: string }) => {
			rec.listBaskets.push(args.basket)
			return {
				totalOutputs: 1,
				outputs: [
					{
						outpoint: `${holding.id('hex')}.0`,
						satoshis: 1,
						spendable: true,
						tags: [],
						customInstructions: JSON.stringify({
							protocolID: PROTOCOL,
							keyID: HOLD_KEY_ID,
						}),
					},
				],
				BEEF: holding.toBEEF(),
			}
		},
		createAction: async (args: CreateActionArgs) => {
			rec.createArgs.push(args)
			const beef = Beef.fromBinary(Array.from(args.inputBEEF ?? []))
			const tx = new Transaction()
			for (const input of args.inputs ?? []) {
				const [txid, vout] = input.outpoint.split('.')
				tx.addInput({
					sourceTransaction: beef.findTxid(txid)!.tx!,
					sourceOutputIndex: Number(vout),
					unlockingScript: new UnlockingScript([]),
				})
			}
			for (const out of args.outputs ?? []) {
				tx.addOutput({
					lockingScript: LockingScript.fromHex(out.lockingScript),
					satoshis: out.satoshis,
				})
			}
			pending = tx
			return {
				signableTransaction: { tx: tx.toAtomicBEEF(), reference: 'ref-1' },
			}
		},
		signAction: async (args: SignActionArgs) => {
			rec.signArgs.push(args)
			const tx = pending!
			for (const [i, spend] of Object.entries(args.spends)) {
				tx.inputs[Number(i)].unlockingScript = UnlockingScript.fromHex(
					spend.unlockingScript,
				)
			}
			return { txid: tx.id('hex'), tx: tx.toAtomicBEEF() }
		},
		abortAction: async () => ({ aborted: true }),
	}) as WalletInterface
	return { wallet, rec }
}

beforeEach(() => {
	sent.length = 0
	relayed.length = 0
})

describe('sendMandala', () => {
	test('identityKey + messagebox: BRC-177 noSend, no change, PeerPay-shaped message', async () => {
		const { wallet, rec } = await fakeWallet()
		const res = await sendMandala.execute(createContext(wallet), {
			tokenId: TOKEN_ID,
			amount: '60',
			destination: { identityKey: RECIPIENT_ID, messagebox: MESSAGEBOX },
		})
		expect(res.error).toBeUndefined()
		expect(res.delivered).toBe('message')
		expect(res.messageId).toBe('msg-1')

		expect(rec.listBaskets).toEqual([TOKEN_ID])
		expect(rec.createArgs).toHaveLength(2)

		// 1. Split: ordinary broadcast, exact 60 + remainder 40, both to us in
		// the per-token basket, CI = derivation only.
		const split = rec.createArgs[0]
		expect(split.options?.noSend).toBeUndefined()
		expect(split.labels).toEqual(['mandala', `mandala:${TOKEN_ID}`])
		expect(split.inputs?.map((i) => i.outpoint)).toEqual([
			`${rec.holdingTxid}.0`,
		])
		const splitOuts = split.outputs ?? []
		expect(
			splitOuts.map(
				(o) => Mandala.decode(LockingScript.fromHex(o.lockingScript))?.amount,
			),
		).toEqual([60n, 40n])
		for (const o of splitOuts) {
			expect(o.satoshis).toBe(1)
			expect(o.basket).toBe(TOKEN_ID)
			expect(o.tags ?? []).not.toContain(`mandala:${TOKEN_ID}`)
			const ci = JSON.parse(o.customInstructions!)
			expect(Object.keys(ci).sort()).toEqual(['keyID', 'protocolID'])
			expect(ci.protocolID).toEqual(PROTOCOL)
		}

		// 2. (BRC-177 anchor funding is the wallet's.) 3. Protected send: spends
		// only the exact split output; one output, no token or satoshi change.
		const args = rec.createArgs[1]
		expect(args.options?.noSend).toBe(true)
		expect(args.options?.randomizeOutputs).toBe(false)
		expect(args.labels).toEqual([
			'mandala',
			`mandala:${TOKEN_ID}`,
			'p nosend expiry seconds 604800',
		])
		const splitTxid = args.inputs![0].outpoint.split('.')[0]
		expect(args.inputs?.map((i) => i.outpoint)).toEqual([`${splitTxid}.0`])
		expect(splitTxid).not.toBe(rec.holdingTxid)
		const outputs = args.outputs ?? []
		expect(outputs).toHaveLength(1)
		const token0 = Mandala.decode(
			LockingScript.fromHex(outputs[0].lockingScript),
		)
		expect(token0?.role).toBe('value')
		expect(token0?.tokenId).toBe(`${TOKEN_ID}_0`)
		expect(token0?.amount).toBe(60n)
		expect(outputs[0].satoshis).toBe(1)

		// The message: PeerPay body + protocol/outputIndex/sender, to payment_inbox.
		expect(sent).toHaveLength(1)
		expect(sent[0].host).toBe(MESSAGEBOX)
		expect(sent[0].message.recipient).toBe(RECIPIENT_ID)
		expect(sent[0].message.messageBox).toBe('payment_inbox')
		const body = sent[0].message.body as {
			customInstructions: {
				derivationPrefix: string
				derivationSuffix: string
				protocol: string
			}
			transaction: number[]
			outputIndex: number
			amount: number
			senderIdentityKey: string
		}
		expect(body.customInstructions.protocol).toBe(`mandala ${TOKEN_ID}`)
		expect(body.outputIndex).toBe(0)
		expect(body.amount).toBe(1)
		expect(body.senderIdentityKey).toBe(SENDER.toPublicKey().toString())
		expect(body.transaction).toEqual(res.tx!)

		// The recipient derives the token output's key from the message alone.
		const { publicKey } = await new ProtoWallet(RECIPIENT).getPublicKey({
			protocolID: PROTOCOL,
			keyID: `${body.customInstructions.derivationPrefix} ${body.customInstructions.derivationSuffix}`,
			counterparty: body.senderIdentityKey,
			forSelf: true,
		})
		const tx = Transaction.fromAtomicBEEF(body.transaction)
		const token = Mandala.decode(tx.outputs[body.outputIndex].lockingScript)
		expect(token?.lock.toHex()).toBe(
			new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(),
		)
		// The token inputs were unlocked by the pipeline (P2PKH under the prefix).
		expect(rec.signArgs[0].spends[0].unlockingScript.length).toBeGreaterThan(0)
		expect(rec.signArgs[1].spends[0].unlockingScript.length).toBeGreaterThan(0)
	})

	test('peer send of an exact-amount output: no split, one protected send', async () => {
		const { wallet, rec } = await fakeWallet()
		const res = await sendMandala.execute(createContext(wallet), {
			tokenId: TOKEN_ID,
			amount: '100',
			destination: { identityKey: RECIPIENT_ID, messagebox: MESSAGEBOX },
		})
		expect(res.error).toBeUndefined()
		expect(rec.createArgs).toHaveLength(1)
		const args = rec.createArgs[0]
		expect(args.options?.noSend).toBe(true)
		expect(args.inputs?.map((i) => i.outpoint)).toEqual([
			`${rec.holdingTxid}.0`,
		])
		expect(args.outputs).toHaveLength(1)
	})

	test('handle: resolves, sends a signed §7.3 envelope with BRC-78 content to payment_inbox', async () => {
		const { wallet, rec } = await fakeWallet()
		const realFetch = globalThis.fetch
		const fetched: string[] = []
		globalThis.fetch = (async (url: RequestInfo | URL) => {
			fetched.push(String(url))
			if (String(url) === 'https://lkup.net/manifest.json') {
				return new Response(
					JSON.stringify({ metanet: { handles: { version: '1.0' } } }),
				)
			}
			return new Response(
				JSON.stringify({
					metanetHandles: '1.0',
					handle: 'deggen',
					domain: 'lkup.net',
					identityKey: RECIPIENT_ID,
					certificate: { subject: RECIPIENT_ID },
					messagebox: 'https://messagebox.lkup.net',
					ttl: 3600,
					revoked: false,
				}),
			)
		}) as typeof fetch
		let res: Awaited<ReturnType<typeof sendMandala.execute>>
		try {
			res = await sendMandala.execute(createContext(wallet), {
				tokenId: TOKEN_ID,
				amount: '60',
				destination: { handle: '@deggen+conf@lkup.net' },
			})
		} finally {
			globalThis.fetch = realFetch
		}
		expect(res.error).toBeUndefined()
		expect(res.delivered).toBe('envelope')
		expect(res.messageId).toBe('env-1')
		expect(fetched[1]).toBe(
			'https://lkup.net/.well-known/metanet-handles/resolve?handle=deggen',
		)

		// Same peer-send rules as identityKey + messagebox.
		expect(rec.createArgs).toHaveLength(2)
		const args = rec.createArgs[1]
		expect(args.options?.noSend).toBe(true)
		expect(args.labels).toEqual([
			'mandala',
			`mandala:${TOKEN_ID}`,
			'p nosend expiry seconds 604800',
		])

		// Posted to the resolved messagebox, payment_inbox, for the identity key.
		expect(sent).toHaveLength(0)
		expect(relayed).toHaveLength(1)
		expect(relayed[0].messagebox).toBe('https://messagebox.lkup.net')
		expect(relayed[0].recipient).toBe(RECIPIENT_ID)
		expect(relayed[0].messageBox).toBe('payment_inbox')

		const env = dagCborDecode(relayed[0].body) as {
			metanetHandles: string
			recipient: { handle: string; tag?: string; domain: string }
			sender: { identityKey: Uint8Array }
			payment: {
				derivationPrefix: Uint8Array
				derivationSuffix: Uint8Array
				protocol: Uint8Array
				satoshis: number
				beef: Uint8Array
			}
			contentHash: Uint8Array
			content: Uint8Array
			signature: Uint8Array
		}
		expect(env.metanetHandles).toBe('1.0')
		expect(env.recipient).toEqual({
			handle: 'deggen',
			tag: 'conf',
			domain: 'lkup.net',
		})
		const senderHex = Utils.toHex(Array.from(env.sender.identityKey))
		expect(senderHex).toBe(SENDER.toPublicKey().toString())
		expect(Utils.toUTF8(Array.from(env.payment.protocol))).toBe(
			`mandala ${TOKEN_ID}`,
		)
		expect(env.payment.satoshis).toBe(1)
		expect(Array.from(env.payment.beef)).toEqual(res.tx!)

		// content: BRC-78, decrypts with @bsv/sdk using the recipient's raw key.
		const plaintext = EncryptedMessage.decrypt(
			Array.from(env.content),
			RECIPIENT,
		)
		expect(JSON.parse(Utils.toUTF8(plaintext))).toEqual({
			tokenId: TOKEN_ID,
			amount: '60',
		})
		expect(Array.from(env.contentHash)).toEqual(Hash.sha256(plaintext))

		// signature: §7.2 item 3, verifiable from sender.identityKey alone.
		const { content: _c, signature, ...unsigned } = env
		const { valid } = await new ProtoWallet('anyone').verifySignature({
			data: Array.from(
				envelopeSigningPreimage(
					unsigned as unknown as Parameters<typeof envelopeSigningPreimage>[0],
				),
			),
			signature: Array.from(signature),
			protocolID: ENVELOPE_SIGNATURE_PROTOCOL,
			keyID: ENVELOPE_SIGNATURE_KEY_ID,
			counterparty: senderHex,
		})
		expect(valid).toBe(true)

		// The recipient derives the token output's key from the envelope.
		const keyID = `${Utils.toBase64(Array.from(env.payment.derivationPrefix))} ${Utils.toBase64(Array.from(env.payment.derivationSuffix))}`
		const { publicKey } = await new ProtoWallet(RECIPIENT).getPublicKey({
			protocolID: PROTOCOL,
			keyID,
			counterparty: senderHex,
			forSelf: true,
		})
		const tx = Transaction.fromAtomicBEEF(Array.from(env.payment.beef))
		expect(Mandala.decode(tx.outputs[0].lockingScript)?.lock.toHex()).toBe(
			new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(),
		)
	})

	test('address: broadcast, no noSend, no expiry label', async () => {
		const { wallet, rec } = await fakeWallet()
		const address = RECIPIENT.toPublicKey().toAddress()
		const res = await sendMandala.execute(createContext(wallet), {
			tokenId: TOKEN_ID,
			amount: 100n,
			destination: { address },
		})
		expect(res.error).toBeUndefined()
		expect(res.delivered).toBe('broadcast')
		expect(sent).toHaveLength(0)

		const args = rec.createArgs[0]
		expect(args.options?.noSend).toBeUndefined()
		expect(args.labels).toEqual(['mandala', `mandala:${TOKEN_ID}`])
		expect(args.outputs).toHaveLength(1)
		const token = Mandala.decode(
			LockingScript.fromHex(args.outputs![0].lockingScript),
		)
		expect(token?.amount).toBe(100n)
		expect(token?.lock.toHex()).toBe(new P2PKH().lock(address).toHex())
	})

	test('address + overlay: BRC-22 submit with tm_<tokenId>, wallet does not broadcast', async () => {
		const { wallet, rec } = await fakeWallet()
		const posts: Array<{ url: string; topics: string | null; body: Blob }> = []
		const realFetch = globalThis.fetch
		globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers)
			posts.push({
				url: String(url),
				topics: headers.get('x-topics'),
				body: init?.body as Blob,
			})
			return new Response(JSON.stringify({ status: 'success' }))
		}) as typeof fetch
		try {
			const res = await sendMandala.execute(createContext(wallet), {
				tokenId: TOKEN_ID,
				amount: '100',
				destination: { address: RECIPIENT.toPublicKey().toAddress() },
				overlay: 'https://overlay.example/',
			})
			expect(res.error).toBeUndefined()
			expect(res.delivered).toBe('overlay')
			// Default broadcast not requested: the wallet holds it as noSend.
			expect(rec.createArgs[0].options?.noSend).toBe(true)
			expect(rec.signArgs[0].options?.sendWith).toBeUndefined()
			expect(posts).toHaveLength(1)
			expect(posts[0].url).toBe('https://overlay.example/submit')
			expect(posts[0].topics).toBe(`tm_${TOKEN_ID}`)
			const sentBeef = Array.from(
				new Uint8Array(await posts[0].body.arrayBuffer()),
			)
			expect(sentBeef).toEqual(res.tx!)
		} finally {
			globalThis.fetch = realFetch
		}
	})

	test('overlay is ignored for peer sends', async () => {
		const { wallet } = await fakeWallet()
		const realFetch = globalThis.fetch
		let fetched = 0
		globalThis.fetch = (async () => {
			fetched++
			return new Response('{}')
		}) as unknown as typeof fetch
		try {
			const res = await sendMandala.execute(createContext(wallet), {
				tokenId: TOKEN_ID,
				amount: '10',
				destination: { identityKey: RECIPIENT_ID, messagebox: MESSAGEBOX },
				overlay: 'https://overlay.example',
			})
			expect(res.delivered).toBe('message')
			expect(fetched).toBe(0)
		} finally {
			globalThis.fetch = realFetch
		}
	})

	test('insufficient balance', async () => {
		const { wallet, rec } = await fakeWallet()
		const res = await sendMandala.execute(createContext(wallet), {
			tokenId: TOKEN_ID,
			amount: '101',
			destination: { address: RECIPIENT.toPublicKey().toAddress() },
		})
		expect(res.error).toBe('insufficient-tokens')
		expect(rec.createArgs).toHaveLength(0)
	})
})
