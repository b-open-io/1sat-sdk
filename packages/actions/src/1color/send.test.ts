import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { OneColor } from '@1sat/templates'
import { encodeMimeEntity } from '@1sat/utils'
import {
	COLOR_KEY_ID,
	ColorPlan,
	colorProtocolID,
} from '@bsv/color-permission-module'
import {
	Beef,
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
	type TransactionDelivery,
	decodeTransactionDelivery,
	encodeTransactionDeliveryMime,
	transactionDeliveryBody,
} from '../metanet/delivery.js'
import { signEnvelope } from '../metanet/envelope.js'
import { syncTransactionInbox } from '../metanet/receive.js'
import { messageRelay } from '../metanet/relay.js'
import { createContext } from '../types.js'
import { parseColorReceipt } from './receipt.js'
import { send1Color } from './send.js'

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
let relayDown = false
Object.assign(messageRelay, {
	sendCborMessage: async (
		_wallet: unknown,
		messagebox: string,
		recipient: string,
		messageBox: string,
		body: Uint8Array,
	) => {
		if (relayDown) throw new Error('sendMessage 503')
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

const ASSET_TXID = 'ab'.repeat(32)
const ASSET_ID = `${ASSET_TXID}_0`
const BASKET = `p color ${ASSET_TXID}v0`
const TOPIC = `tm_color_${ASSET_ID}`
const SENDER = PrivateKey.fromHex('11'.repeat(32))
const SENDER_ID = SENDER.toPublicKey().toString()
const RECIPIENT = PrivateKey.fromHex('22'.repeat(32))
const RECIPIENT_ID = RECIPIENT.toPublicKey().toString()
const RESOLVED_BOX = 'https://messagebox.lkup.net'
const OVERLAY = 'https://overlay.example'
const HANDLE = '@deggen+conf@lkup.net'
const MIME_HEAD =
	'Content-Type: application/vnd.metanet.transaction+cbor\r\nContent-Transfer-Encoding: binary\r\n\r\n'

/** The plan a send carries, exactly. */
const SEND_PLAN = {
	version: 1,
	assets: [ASSET_ID],
	ownedOutputs: [],
	operations: [{ assetId: ASSET_ID, operation: 'transfer' }],
	inputPositions: [],
	changePositions: [],
	sighashTypes: [],
}

/**
 * Sender wallet: ProtoWallet crypto; createAction stands in for the
 * permissions manager with the color module, returning the completed noSend
 * handoff (a funding input plus the requested outputs).
 */
function senderWallet() {
	const created: CreateActionArgs[] = []
	const other: string[] = []
	const proto = new ProtoWallet(SENDER)
	const wallet = Object.assign(Object.create(proto), {
		createAction: async (args: CreateActionArgs) => {
			created.push(args)
			const parent = new Transaction()
			parent.addOutput({ lockingScript: new LockingScript([]), satoshis: 1000 })
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
		listOutputs: async () => {
			other.push('listOutputs')
			throw new Error('unexpected')
		},
		signAction: async () => {
			other.push('signAction')
			throw new Error('unexpected')
		},
		internalizeAction: async () => {
			other.push('internalizeAction')
			throw new Error('unexpected')
		},
	}) as WalletInterface
	return { wallet, created, other }
}

/** Recipient wallet: ProtoWallet crypto plus a recorded internalizeAction. */
function recipientWallet(log: string[] = [], fail = false) {
	const internalized: InternalizeActionArgs[] = []
	const wallet = Object.assign(Object.create(new ProtoWallet(RECIPIENT)), {
		internalizeAction: async (args: InternalizeActionArgs) => {
			log.push('internalize')
			if (fail) throw new Error('internalize refused')
			internalized.push(args)
			return { accepted: true }
		},
	}) as WalletInterface
	return { wallet, internalized }
}

const realFetch = globalThis.fetch
interface Submitted {
	topics: string
	beef: number[]
}

/**
 * Network fake: BRC-169 handle resolution for `HANDLE`, and the overlay's
 * BRC-22 `/submit`, answering a STEAK that admits `admit` for each topic.
 */
function network(log: string[], admit: number[] = [0]) {
	const submitted: Submitted[] = []
	globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url)
		if (u === 'https://lkup.net/manifest.json') {
			return new Response(
				JSON.stringify({ metanet: { handles: { version: '1.0' } } }),
			)
		}
		if (
			u === 'https://lkup.net/.well-known/metanet-handles/resolve?handle=deggen'
		) {
			return new Response(
				JSON.stringify({
					metanetHandles: '1.0',
					handle: 'deggen',
					domain: 'lkup.net',
					identityKey: RECIPIENT_ID,
					certificate: { subject: RECIPIENT_ID },
					messagebox: RESOLVED_BOX,
					ttl: 3600,
					revoked: false,
				}),
			)
		}
		if (u === `${OVERLAY}/submit`) {
			const topics = new Headers(init?.headers).get('X-Topics') ?? ''
			log.push(`submit ${topics}`)
			const blob = init?.body as Blob
			submitted.push({
				topics,
				beef: Array.from(new Uint8Array(await blob.arrayBuffer())),
			})
			return new Response(
				JSON.stringify(
					Object.fromEntries(
						topics
							.split(',')
							.map((t) => [t, { outputsToAdmit: admit, coinsToRetain: [] }]),
					),
				),
			)
		}
		throw new Error(`unexpected fetch ${u}`)
	}) as typeof fetch
	return { submitted }
}

afterEach(() => {
	globalThis.fetch = realFetch
})

beforeEach(() => {
	relayed.length = 0
	acknowledged.length = 0
	listed.length = 0
	relayDown = false
})

/** Open the last relayed envelope with the recipient's raw key. */
function openLast() {
	const env = dagCborDecode(relayed[relayed.length - 1].body) as {
		payment: unknown
		contentHash: Uint8Array
		content: Uint8Array
		sender: { identityKey: Uint8Array }
	}
	const plaintext = EncryptedMessage.decrypt(Array.from(env.content), RECIPIENT)
	return { env, plaintext }
}

/** Post a signed envelope from SENDER to the recipient's transaction-delivery box. */
async function postEnvelope(mime: Uint8Array, contentHash = true) {
	const proto = new ProtoWallet(SENDER)
	const content = await encryptBrc78(proto, Array.from(mime), RECIPIENT_ID)
	const { envelope } = await signEnvelope(
		proto,
		{
			metanetHandles: '1.0',
			recipient: { handle: 'deggen', domain: 'lkup.net' },
			sender: { identityKey: Uint8Array.from(Utils.toArray(SENDER_ID, 'hex')) },
			created: '2026-10-21T00:00:00Z',
			payment: null,
			...(contentHash && {
				contentHash: Uint8Array.from(Hash.sha256(Array.from(mime))),
			}),
		},
		Uint8Array.from(content),
	)
	const messageId = `env-${relayed.length + 1}`
	relayed.push({
		messagebox: RESOLVED_BOX,
		recipient: RECIPIENT_ID,
		messageBox: 'transaction-delivery',
		body: envelope,
		messageId,
	})
	return messageId
}

/** Send 60 units from the sender to `HANDLE`; returns the result and the delivered body. */
async function sendSixty(memo?: string) {
	const { wallet, created } = senderWallet()
	network([])
	const res = await send1Color.execute(createContext(wallet), {
		assetId: ASSET_ID,
		amount: '60',
		destination: { handle: HANDLE },
		...(memo !== undefined && { memo }),
	})
	globalThis.fetch = realFetch
	expect(res.error).toBeUndefined()
	const { plaintext } = openLast()
	const body = decodeTransactionDelivery(transactionDeliveryBody(plaintext))
	return { res, created, body }
}

describe('send1Color', () => {
	test('one createAction: the recipient output, the transfer plan and the BRC-177 handoff label', async () => {
		const { wallet, created, other } = senderWallet()
		network([])
		const res = await send1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '60',
			destination: { handle: HANDLE },
		})
		expect(res.error).toBeUndefined()
		expect(res.delivered).toBe('envelope')
		expect(res.messageId).toBe('env-1')
		// No coin selection, split, spends or filing by the action.
		expect(other).toEqual([])

		expect(created).toHaveLength(1)
		const args = created[0]
		expect(args.labels).toEqual([
			...ColorPlan.toLabels(SEND_PLAN as ColorPlan),
			'p nosend expiry seconds 31536000',
		])
		expect(ColorPlan.fromLabels(args.labels)).toEqual(SEND_PLAN as ColorPlan)
		expect(args.options).toEqual({ noSend: true, randomizeOutputs: false })
		expect(args.inputs).toBeUndefined()
		expect(args.inputBEEF).toBeUndefined()
		expect(args.description).toBe('Send 60 1Color tokens')
		expect(args.outputs).toHaveLength(1)
		const out = args.outputs![0]
		expect(out).toEqual({
			lockingScript: out.lockingScript,
			satoshis: 1,
			outputDescription: '1Color tokens',
		})
		const token = OneColor.decode(LockingScript.fromHex(out.lockingScript))
		expect(token?.role).toBe('value')
		expect(token?.tokenId).toBe(ASSET_ID)
		expect(token?.amount).toBe(60n)
	})

	test('expiry override', async () => {
		const { wallet, created } = senderWallet()
		network([])
		const res = await send1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: 100n,
			destination: { handle: HANDLE },
			expirySeconds: 86400,
		})
		expect(res.error).toBeUndefined()
		expect(created[0].labels?.at(-1)).toBe('p nosend expiry seconds 86400')
	})

	test('delivery: transaction-delivery box, payment null, BRC-232 MIME with one p color receipt', async () => {
		const { res, created } = await sendSixty('for the conference')

		expect(relayed).toHaveLength(1)
		expect(relayed[0].messagebox).toBe(RESOLVED_BOX)
		expect(relayed[0].recipient).toBe(RECIPIENT_ID)
		expect(relayed[0].messageBox).toBe('transaction-delivery')

		const { env, plaintext } = openLast()
		expect(env.payment).toBeNull()
		expect(Utils.toHex(Array.from(env.sender.identityKey))).toBe(SENDER_ID)
		expect(Array.from(env.contentHash)).toEqual(Hash.sha256(plaintext))
		expect(Utils.toUTF8(plaintext.slice(0, MIME_HEAD.length))).toBe(MIME_HEAD)

		const body = decodeTransactionDelivery(transactionDeliveryBody(plaintext))
		expect(Object.keys(body).sort()).toEqual([
			'beef',
			'lifecycles',
			'memo',
			'outputs',
			'txid',
			'version',
		])
		expect(body.version).toBe(1)
		expect(Utils.toHex(Array.from(body.txid))).toBe(res.txid!)
		// Plain BEEF (not Atomic) carrying the subject.
		expect(Array.from(body.beef)).toEqual(Beef.fromBinary(res.tx!).toBinary())
		expect(body.lifecycles).toEqual([])
		expect(body.memo).toBe('for the conference')
		expect(body.outputs).toHaveLength(1)
		const entry = body.outputs[0]
		if (entry.protocol !== 'basket insertion') throw new Error('entry')
		const receipt = parseColorReceipt(
			entry.insertionRemittance.customInstructions,
		)
		expect(entry).toEqual({
			outputIndex: 0,
			protocol: 'basket insertion',
			insertionRemittance: {
				basket: BASKET,
				customInstructions: `{"version":1,"assetId":"${ASSET_ID}","derivationPrefix":"${receipt.derivationPrefix}","derivationSuffix":"${receipt.derivationSuffix}","senderIdentityKey":"${SENDER_ID}"}`,
			},
		})
		expect(receipt.derivationPrefix).toMatch(/^[A-Za-z0-9+/]{22}==$/)

		// The recipient derives the output's key from the receipt alone.
		const { publicKey } = await new ProtoWallet(RECIPIENT).getPublicKey({
			protocolID: colorProtocolID(
				ASSET_ID,
				receipt.derivationPrefix,
				receipt.derivationSuffix,
			),
			keyID: COLOR_KEY_ID,
			counterparty: SENDER_ID,
			forSelf: true,
		})
		const out = created[0].outputs![0]
		expect(
			OneColor.decode(LockingScript.fromHex(out.lockingScript))?.lock.toHex(),
		).toBe(
			new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(),
		)
	})

	test('the asset id must be the canonical <txid>_<vout>', async () => {
		for (const assetId of [
			`${ASSET_TXID}.0`,
			`${ASSET_TXID.toUpperCase()}_0`,
			ASSET_TXID,
			'ISSUE',
		]) {
			const { wallet, created } = senderWallet()
			const res = await send1Color.execute(createContext(wallet), {
				assetId,
				amount: '1',
				destination: { handle: HANDLE },
			})
			expect(res.error).toBe('invalid-asset-id: expected <txid>_<vout>')
			expect(created).toHaveLength(0)
		}
	})

	test('a memo over 2000 UTF-8 bytes fails before createAction', async () => {
		const { wallet, created } = senderWallet()
		network([])
		const res = await send1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '1',
			destination: { handle: HANDLE },
			memo: 'é'.repeat(1001),
		})
		expect(res).toEqual({ error: 'BRC-232: memo exceeds 2000 UTF-8 bytes' })
		expect(created).toHaveLength(0)
		expect(relayed).toHaveLength(0)
	})

	test('a failed delivery returns the noSend send for retry or abort', async () => {
		const { wallet } = senderWallet()
		network([])
		relayDown = true
		const res = await send1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '1',
			destination: { handle: HANDLE },
		})
		expect(res.txid).toBeDefined()
		expect(res.tx).toBeDefined()
		expect(res.delivered).toBeUndefined()
		expect(res.error).toBe('delivery-failed: sendMessage 503')
	})
})

describe('syncTransactionInbox: 1Color', () => {
	test('round trip: submitted to tm_color_<assetId> first, then internalized verbatim, then acknowledged', async () => {
		const { res: sent, body } = await sendSixty()
		const log: string[] = []
		const { submitted } = network(log)
		const { wallet, internalized } = recipientWallet(log)
		const res = await syncTransactionInbox.execute(createContext(wallet), {
			messageboxUrl: 'https://messagebox.example/',
			overlay: `${OVERLAY}/`,
		})
		expect(res.error).toBeUndefined()
		expect(listed).toEqual([
			{
				messagebox: 'https://messagebox.example',
				messageBox: 'transaction-delivery',
			},
		])
		expect(res.skipped).toEqual([])
		expect(res.received).toEqual([
			{
				messageId: 'env-1',
				txid: sent.txid!,
				sender: SENDER_ID,
				assetIds: [ASSET_ID],
			},
		])

		// Submit before internalize.
		expect(log).toEqual([`submit ${TOPIC}`, 'internalize'])
		expect(submitted[0].beef).toEqual(Array.from(body.beef))

		expect(internalized).toHaveLength(1)
		const args = internalized[0]
		expect(Transaction.fromAtomicBEEF(args.tx).id('hex')).toBe(sent.txid!)
		expect(args.labels).toBeUndefined()
		expect(args.description).toBe('Receive 1Color tokens')
		expect(args.outputs as unknown).toEqual(body.outputs)
		expect(acknowledged).toEqual([['env-1']])
	})

	test('an output the overlay does not admit is not internalized or acknowledged', async () => {
		await sendSixty()
		const log: string[] = []
		network(log, [])
		const { wallet, internalized } = recipientWallet(log)
		const res = await syncTransactionInbox.execute(createContext(wallet), {
			overlay: OVERLAY,
		})
		expect(res.received).toEqual([])
		expect(res.skipped[0].reason).toStartWith(`${TOPIC} did not admit `)
		expect(log).toEqual([`submit ${TOPIC}`])
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	})

	test('a failed internalize is not acknowledged', async () => {
		await sendSixty()
		const log: string[] = []
		network(log)
		const { wallet } = recipientWallet(log, true)
		const res = await syncTransactionInbox.execute(createContext(wallet), {
			overlay: OVERLAY,
		})
		expect(res.skipped).toEqual([
			{ messageId: 'env-1', reason: 'internalize refused' },
		])
		expect(acknowledged).toEqual([])
	})

	/** Re-post the last delivery with `edit` applied to its body. */
	async function repost(edit: (b: TransactionDelivery) => void) {
		const { body } = await sendSixty()
		relayed.length = 0
		edit(body)
		return postEnvelope(encodeTransactionDeliveryMime(body))
	}

	async function expectSkipped(id: string, reason: string) {
		const log: string[] = []
		network(log)
		const { wallet, internalized } = recipientWallet(log)
		const res = await syncTransactionInbox.execute(createContext(wallet), {
			overlay: OVERLAY,
		})
		expect(res.received).toEqual([])
		expect(res.skipped).toEqual([{ messageId: id, reason }])
		expect(log).toEqual([])
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	}

	test('receipt instructions with any other member are rejected', async () => {
		const id = await repost((b) => {
			const e = b.outputs[0]
			if (e.protocol !== 'basket insertion') return
			const ci = JSON.parse(e.insertionRemittance.customInstructions)
			e.insertionRemittance.customInstructions = JSON.stringify({
				...ci,
				extra: 1,
			})
		})
		await expectSkipped(
			id,
			'BRC-207: receipt customInstructions must be exactly {version, assetId, derivationPrefix, derivationSuffix, senderIdentityKey}',
		)
	})

	test('receipt instructions naming another asset are rejected', async () => {
		const other = `${'cd'.repeat(32)}_0`
		const id = await repost((b) => {
			const e = b.outputs[0]
			if (e.protocol !== 'basket insertion') return
			const ci = JSON.parse(e.insertionRemittance.customInstructions)
			e.insertionRemittance.customInstructions = JSON.stringify({
				...ci,
				assetId: other,
			})
		})
		await expectSkipped(
			id,
			`BRC-207: the receipt names ${other}, the basket ${ASSET_ID}`,
		)
	})

	test('a basket that is not p color is unsupported', async () => {
		const id = await repost((b) => {
			const e = b.outputs[0]
			if (e.protocol === 'basket insertion')
				e.insertionRemittance.basket = 'tokens'
		})
		await expectSkipped(id, 'output 0: unsupported basket tokens')
	})

	test('the authority basket for a value output is rejected', async () => {
		const id = await repost((b) => {
			const e = b.outputs[0]
			if (e.protocol === 'basket insertion') {
				e.insertionRemittance.basket = `${BASKET} authority`
			}
		})
		await expectSkipped(
			id,
			`output 0: not a 1Color authority output of ${ASSET_ID}`,
		)
	})

	test('a delivery without contentHash is not actionable', async () => {
		const { body } = await sendSixty()
		relayed.length = 0
		const id = await postEnvelope(encodeTransactionDeliveryMime(body), false)
		await expectSkipped(
			id,
			'a BRC-232 delivery requires the envelope contentHash',
		)
	})

	test('a MIME entity without Content-Transfer-Encoding: binary is rejected', async () => {
		const { body } = await sendSixty()
		relayed.length = 0
		const cbor = dagCborEncode(
			Object.fromEntries(
				Object.entries(body).filter(([, v]) => v !== undefined),
			),
		)
		const head = Utils.toArray(
			'Content-Type: application/vnd.metanet.transaction+cbor\r\n\r\n',
			'utf8',
		)
		const id = await postEnvelope(Uint8Array.from([...head, ...cbor]))
		await expectSkipped(id, 'BRC-232: Content-Transfer-Encoding must be binary')
	})

	test('the old body shape (protocolID/keyID/counterparty entries) is rejected', async () => {
		const { body } = await sendSixty()
		relayed.length = 0
		const old = {
			txid: body.txid,
			beef: body.beef,
			outputs: [
				{
					outputIndex: 0,
					protocol: 'basket insertion',
					protocolID: [2, 'color'],
					keyID: 'a b',
					counterparty: Uint8Array.from(Utils.toArray(SENDER_ID, 'hex')),
				},
			],
		}
		const id = await postEnvelope(
			Uint8Array.from([
				...Utils.toArray(MIME_HEAD, 'utf8'),
				...dagCborEncode(old),
			]),
		)
		await expectSkipped(id, 'BRC-232: the body lacks version')
	})

	test('without an overlay: 1Color messages stay (overlay-required), payment deliveries are internalized', async () => {
		const { body } = await sendSixty()
		const tokenMessage = relayed[0].messageId
		const paymentMessage = await postEnvelope(
			encodeTransactionDeliveryMime({
				...body,
				outputs: [
					{
						outputIndex: 0,
						protocol: 'wallet payment',
						paymentRemittance: {
							derivationPrefix: 'AQ==',
							derivationSuffix: 'Ag==',
							senderIdentityKey: Uint8Array.from(
								Utils.toArray(SENDER_ID, 'hex'),
							),
						},
					},
				],
			}),
		)
		const log: string[] = []
		network(log)
		const { wallet, internalized } = recipientWallet(log)
		const res = await syncTransactionInbox.execute(createContext(wallet), {})
		expect(res.error).toBeUndefined()
		expect(listed).toEqual([
			{
				messagebox: 'https://messagebox.1sat.app',
				messageBox: 'transaction-delivery',
			},
		])
		expect(res.skipped).toEqual([
			{ messageId: tokenMessage, reason: 'overlay-required' },
		])
		expect(res.received).toEqual([
			{
				messageId: paymentMessage,
				txid: Utils.toHex(Array.from(body.txid)),
				sender: SENDER_ID,
				assetIds: [],
			},
		])
		// No overlay submit; only the payment is internalized and acknowledged.
		expect(log).toEqual(['internalize'])
		expect(internalized[0].outputs).toEqual([
			{
				outputIndex: 0,
				protocol: 'wallet payment',
				paymentRemittance: {
					derivationPrefix: 'AQ==',
					derivationSuffix: 'Ag==',
					senderIdentityKey: SENDER_ID,
				},
			},
		])
		expect(acknowledged).toEqual([[paymentMessage]])
	})

	test('an unknown content type is left unacknowledged and reported', async () => {
		const id = await postEnvelope(
			encodeMimeEntity(
				'text/plain; charset=utf-8',
				Utils.toArray('hello', 'utf8'),
			),
		)
		const log: string[] = []
		network(log)
		const { wallet, internalized } = recipientWallet(log)
		const res = await syncTransactionInbox.execute(createContext(wallet), {
			overlay: OVERLAY,
		})
		expect(listed[0].messageBox).toBe('transaction-delivery')
		expect(res.received).toEqual([])
		expect(res.skipped).toEqual([
			{
				messageId: id,
				reason:
					'nothing to internalize: no payment, content type text/plain; charset=utf-8',
			},
		])
		expect(log).toEqual([])
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	})

	test('a tampered envelope fails signature verification', async () => {
		await sendSixty()
		const env = dagCborDecode(relayed[0].body) as Record<string, unknown>
		env.created = '2000-01-01T00:00:00Z'
		relayed[0].body = dagCborEncode(env)
		const log: string[] = []
		network(log)
		const { wallet, internalized } = recipientWallet(log)
		const res = await syncTransactionInbox.execute(createContext(wallet), {
			overlay: OVERLAY,
		})
		expect(listed[0].messageBox).toBe('transaction-delivery')
		expect(res.skipped).toEqual([
			{ messageId: 'env-1', reason: 'envelope signature does not verify' },
		])
		expect(log).toEqual([])
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	})
})
