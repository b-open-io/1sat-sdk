import { beforeEach, describe, expect, test } from 'bun:test'
import { Mandala } from '@1sat/templates'
import { mandalaProtocol } from '@1sat/types'
import {
	TRANSACTION_CBOR_CONTENT_TYPE,
	encodeMimeEntity,
	parseMimeEntity,
} from '@1sat/utils'
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
	type SignActionArgs,
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
	envelopeSigningPreimage,
	signEnvelope,
} from '../metanet/envelope.js'
import { messageRelay } from '../metanet/relay.js'
import { createContext } from '../types.js'
import { syncMandalaInbox } from './receive.js'
import { sendMandala } from './send.js'

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

const TOKEN_TXID = 'ab'.repeat(32)
const TOKEN_ID = `${TOKEN_TXID}.0`
const SENDER = PrivateKey.fromHex('11'.repeat(32))
const SENDER_ID = SENDER.toPublicKey().toString()
const RECIPIENT = PrivateKey.fromHex('22'.repeat(32))
const RECIPIENT_ID = RECIPIENT.toPublicKey().toString()
const RESOLVED_BOX = 'https://messagebox.lkup.net'
const HOLD_KEY_ID = 'hold-1'
const PROTOCOL = mandalaProtocol(TOKEN_ID)
const HANDLE = '@deggen+conf@lkup.net'

/** A mined parent, then a tx holding Mandala outputs (`amounts`) for the sender. */
async function walletHolding(proto: ProtoWallet, amounts: bigint[]) {
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
	for (const amount of amounts) {
		holding.addOutput({
			lockingScript: Mandala.value(`${TOKEN_TXID}_0`, amount, {
				lock: new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()),
			}).lock(),
			satoshis: 1,
		})
	}
	return holding
}

interface Recorded {
	createArgs: CreateActionArgs[]
	signArgs: SignActionArgs[]
	listBaskets: string[]
	holdingTxid: string
}

/** BRC-100 fake over a ProtoWallet: lists the holding, builds signable txs, applies spends. */
async function fakeWallet(amounts: bigint[] = [100n]): Promise<{
	wallet: WalletInterface
	rec: Recorded
}> {
	const proto = new ProtoWallet(SENDER)
	const holding = await walletHolding(proto, amounts)
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
				totalOutputs: amounts.length,
				outputs: amounts.map((_, i) => ({
					outpoint: `${holding.id('hex')}.${i}`,
					satoshis: 1,
					spendable: true,
					tags: [],
					customInstructions: JSON.stringify({
						protocolID: PROTOCOL,
						keyID: HOLD_KEY_ID,
					}),
				})),
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

/** Resolve `HANDLE` to the recipient (BRC-169 §5) without the network. */
async function withResolver<T>(fn: () => Promise<T>): Promise<T> {
	const realFetch = globalThis.fetch
	globalThis.fetch = (async (url: RequestInfo | URL) => {
		if (String(url) === 'https://lkup.net/manifest.json') {
			return new Response(
				JSON.stringify({ metanet: { handles: { version: '1.0' } } }),
			)
		}
		expect(String(url)).toBe(
			'https://lkup.net/.well-known/metanet-handles/resolve?handle=deggen',
		)
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
	}) as typeof fetch
	try {
		return await fn()
	} finally {
		globalThis.fetch = realFetch
	}
}

interface Envelope {
	metanetHandles: string
	recipient: { handle: string; tag?: string; domain: string }
	sender: { identityKey: Uint8Array }
	payment: unknown
	contentHash: Uint8Array
	content: Uint8Array
	signature: Uint8Array
}

interface Body {
	memo?: string
	txid: Uint8Array
	beef: Uint8Array
	outputs: Array<{
		outputIndex: number
		protocol: string
		protocolID: [number, string]
		keyID: string
		counterparty: Uint8Array
	}>
}

/** Open the last relayed envelope with the recipient's raw key. */
function openLast() {
	const env = dagCborDecode(relayed[relayed.length - 1].body) as Envelope
	const plaintext = EncryptedMessage.decrypt(Array.from(env.content), RECIPIENT)
	const entity = parseMimeEntity(plaintext)
	const body = dagCborDecode(entity.body) as Body
	return { env, plaintext, entity, body }
}

/** Post a signed envelope from SENDER to the recipient's mandala_inbox. */
async function postEnvelope(mime: Uint8Array) {
	const proto = new ProtoWallet(SENDER)
	const content = await encryptBrc78(proto, Array.from(mime), RECIPIENT_ID)
	const { envelope } = await signEnvelope(
		proto,
		{
			metanetHandles: '1.0',
			recipient: { handle: 'deggen', domain: 'lkup.net' },
			sender: { identityKey: Uint8Array.from(Utils.toArray(SENDER_ID, 'hex')) },
			created: '2026-10-03T00:00:00Z',
			payment: null,
			contentHash: Uint8Array.from(Hash.sha256(Array.from(mime))),
		},
		Uint8Array.from(content),
	)
	const messageId = `env-${relayed.length + 1}`
	relayed.push({
		messagebox: RESOLVED_BOX,
		recipient: RECIPIENT_ID,
		messageBox: 'mandala_inbox',
		body: envelope,
		messageId,
	})
	return messageId
}

beforeEach(() => {
	relayed.length = 0
	acknowledged.length = 0
	listed.length = 0
})

describe('sendMandala', () => {
	test('splits when no output holds exactly amount, then one protected noSend send', async () => {
		const { wallet, rec } = await fakeWallet()
		const res = await withResolver(() =>
			sendMandala.execute(createContext(wallet), {
				tokenId: TOKEN_ID,
				amount: '60',
				destination: { handle: HANDLE },
			}),
		)
		expect(res.error).toBeUndefined()
		expect(res.delivered).toBe('envelope')
		expect(res.messageId).toBe('env-1')

		expect(rec.listBaskets).toEqual([`mandala ${TOKEN_TXID} 0`])
		expect(rec.createArgs).toHaveLength(2)

		// Split: ordinary broadcast, exact 60 + remainder 40, both to us in the
		// per-token basket, CI = derivation only.
		const split = rec.createArgs[0]
		expect(split.options?.noSend).toBeUndefined()
		expect(split.labels).toEqual(['mandala', `mandala ${TOKEN_TXID} 0`])
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
			expect(o.basket).toBe(`mandala ${TOKEN_TXID} 0`)
			const ci = JSON.parse(o.customInstructions!)
			expect(Object.keys(ci).sort()).toEqual(['keyID', 'protocolID'])
			expect(ci.protocolID).toEqual(PROTOCOL)
		}

		// Protected send: exactly one input (the exact split output), one output.
		const args = rec.createArgs[1]
		expect(args.options?.noSend).toBe(true)
		expect(args.options?.randomizeOutputs).toBe(false)
		expect(args.labels).toEqual([
			'mandala',
			`mandala ${TOKEN_TXID} 0`,
			'p nosend expiry seconds 31536000',
		])
		const splitTxid = args.inputs![0].outpoint.split('.')[0]
		expect(args.inputs?.map((i) => i.outpoint)).toEqual([`${splitTxid}.0`])
		expect(splitTxid).not.toBe(rec.holdingTxid)
		expect(args.outputs).toHaveLength(1)
		const out = args.outputs![0]
		expect(out.basket).toBeUndefined()
		expect(out.satoshis).toBe(1)
		const token = Mandala.decode(LockingScript.fromHex(out.lockingScript))
		expect(token?.role).toBe('value')
		expect(token?.tokenId).toBe(`${TOKEN_TXID}_0`)
		expect(token?.amount).toBe(60n)
		// Token inputs were unlocked by the pipeline (caller-signed spends).
		expect(rec.signArgs[0].spends[0].unlockingScript.length).toBeGreaterThan(0)
		expect(rec.signArgs[1].spends[0].unlockingScript.length).toBeGreaterThan(0)
	})

	test('an output of exactly amount: no split, expiry override', async () => {
		const { wallet, rec } = await fakeWallet([40n, 100n])
		const res = await withResolver(() =>
			sendMandala.execute(createContext(wallet), {
				tokenId: TOKEN_ID,
				amount: '100',
				destination: { handle: HANDLE },
				expirySeconds: 86400,
			}),
		)
		expect(res.error).toBeUndefined()
		expect(rec.createArgs).toHaveLength(1)
		const args = rec.createArgs[0]
		expect(args.options?.noSend).toBe(true)
		expect(args.labels).toContain('p nosend expiry seconds 86400')
		expect(args.inputs?.map((i) => i.outpoint)).toEqual([
			`${rec.holdingTxid}.1`,
		])
		expect(args.outputs).toHaveLength(1)
	})

	test('outputs summing exactly to amount are merged first (no remainder output)', async () => {
		const { wallet, rec } = await fakeWallet([30n, 30n])
		const res = await withResolver(() =>
			sendMandala.execute(createContext(wallet), {
				tokenId: TOKEN_ID,
				amount: '60',
				destination: { handle: HANDLE },
			}),
		)
		expect(res.error).toBeUndefined()
		expect(rec.createArgs).toHaveLength(2)
		expect(rec.createArgs[0].inputs).toHaveLength(2)
		expect(rec.createArgs[0].outputs).toHaveLength(1)
		expect(rec.createArgs[1].inputs).toHaveLength(1)
	})

	test('delivery: signed envelope to the resolved mandala_inbox, payment null, BRC-232 MIME content', async () => {
		const { wallet } = await fakeWallet()
		const res = await withResolver(() =>
			sendMandala.execute(createContext(wallet), {
				tokenId: TOKEN_ID,
				amount: '60',
				destination: { handle: HANDLE },
				memo: 'for the conference',
			}),
		)
		expect(res.error).toBeUndefined()

		expect(relayed).toHaveLength(1)
		expect(relayed[0].messagebox).toBe(RESOLVED_BOX)
		expect(relayed[0].recipient).toBe(RECIPIENT_ID)
		expect(relayed[0].messageBox).toBe('mandala_inbox')

		const { env, plaintext, entity, body } = openLast()
		expect(env.metanetHandles).toBe('1.0')
		expect(env.recipient).toEqual({
			handle: 'deggen',
			tag: 'conf',
			domain: 'lkup.net',
		})
		expect(env.payment).toBeNull()
		const senderHex = Utils.toHex(Array.from(env.sender.identityKey))
		expect(senderHex).toBe(SENDER_ID)

		// content: a MIME entity of the BRC-232 type; contentHash over the MIME bytes.
		expect(
			Utils.toUTF8(plaintext.slice(0, 60)).startsWith(
				'Content-Type: application/vnd.metanet.transaction+cbor\r\n\r\n',
			),
		).toBe(true)
		expect(entity.contentType).toBe(TRANSACTION_CBOR_CONTENT_TYPE)
		expect(Array.from(env.contentHash)).toEqual(Hash.sha256(plaintext))

		// body: txid, beef, one basket-insertion entry with our identity as counterparty.
		expect(body.memo).toBe('for the conference')
		expect(Utils.toHex(Array.from(body.txid))).toBe(res.txid!)
		expect(Array.from(body.beef)).toEqual(res.tx!)
		expect(body.outputs).toHaveLength(1)
		const entry = body.outputs[0]
		expect(entry.outputIndex).toBe(0)
		expect(entry.protocol).toBe('basket insertion')
		expect(entry.protocolID).toEqual([2, `mandala ${TOKEN_TXID} 0`])
		expect(entry.keyID).toMatch(/^[A-Za-z0-9+/=]+ [A-Za-z0-9+/=]+$/)
		expect(Utils.toHex(Array.from(entry.counterparty))).toBe(SENDER_ID)

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

		// The recipient derives the token output's key from the entry alone.
		const { publicKey } = await new ProtoWallet(RECIPIENT).getPublicKey({
			protocolID: entry.protocolID as [2, string],
			keyID: entry.keyID,
			counterparty: senderHex,
			forSelf: true,
		})
		const tx = Transaction.fromAtomicBEEF(Array.from(body.beef))
		expect(Mandala.decode(tx.outputs[0].lockingScript)?.lock.toHex()).toBe(
			new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(),
		)
	})

	test('a txid_vout token is accepted and normalized to BRC-36 txid.vout', async () => {
		const { wallet, rec } = await fakeWallet()
		const res = await withResolver(() =>
			sendMandala.execute(createContext(wallet), {
				tokenId: `${TOKEN_TXID.toUpperCase()}_0`,
				amount: '100',
				destination: { handle: HANDLE },
			}),
		)
		expect(res.error).toBeUndefined()
		expect(rec.listBaskets).toEqual([`mandala ${TOKEN_TXID} 0`])
	})

	test('the token is named by its deploy outpoint', async () => {
		const { wallet, rec } = await fakeWallet()
		const res = await sendMandala.execute(createContext(wallet), {
			tokenId: TOKEN_TXID,
			amount: '1',
			destination: { handle: HANDLE },
		})
		expect(res.error).toBe('invalid-token: expected <txid>.<vout>')
		expect(rec.listBaskets).toEqual([])
	})

	test('insufficient balance', async () => {
		const { wallet, rec } = await fakeWallet()
		const res = await withResolver(() =>
			sendMandala.execute(createContext(wallet), {
				tokenId: TOKEN_ID,
				amount: '101',
				destination: { handle: HANDLE },
			}),
		)
		expect(res.error).toBe('insufficient-tokens')
		expect(rec.createArgs).toHaveLength(0)
		expect(relayed).toHaveLength(0)
	})
})

describe('syncMandalaInbox', () => {
	test('round trip: a sent delivery is verified, decrypted and internalized, then acknowledged', async () => {
		const { wallet: senderWallet } = await fakeWallet()
		const sent = await withResolver(() =>
			sendMandala.execute(createContext(senderWallet), {
				tokenId: TOKEN_ID,
				amount: '60',
				destination: { handle: HANDLE },
			}),
		)
		expect(sent.error).toBeUndefined()
		const { body } = openLast()

		const { wallet, internalized } = recipientWallet()
		const res = await syncMandalaInbox.execute(createContext(wallet), {
			messageboxUrl: 'https://messagebox.example/',
		})
		expect(res.error).toBeUndefined()
		expect(listed).toEqual([
			{ messagebox: 'https://messagebox.example', messageBox: 'mandala_inbox' },
		])
		expect(res.skipped).toEqual([])
		expect(res.received).toEqual([
			{ messageId: 'env-1', txid: sent.txid!, tokenIds: [TOKEN_ID] },
		])

		expect(internalized).toHaveLength(1)
		const args = internalized[0]
		expect(Transaction.fromAtomicBEEF(args.tx).id('hex')).toBe(sent.txid!)
		expect(args.labels).toEqual(['mandala', `mandala ${TOKEN_TXID} 0`])
		expect(args.outputs).toHaveLength(1)
		const out = args.outputs[0]
		expect(out.outputIndex).toBe(0)
		expect(out.protocol).toBe('basket insertion')
		expect(out.insertionRemittance?.basket).toBe(`mandala ${TOKEN_TXID} 0`)
		expect(
			JSON.parse(out.insertionRemittance?.customInstructions ?? ''),
		).toEqual({
			protocolID: [2, `mandala ${TOKEN_TXID} 0`],
			keyID: body.outputs[0].keyID,
			counterparty: SENDER_ID,
		})
		expect(acknowledged).toEqual([['env-1']])
	})

	test('an unknown content type is left unacknowledged and reported', async () => {
		const id = await postEnvelope(
			encodeMimeEntity(
				'text/plain; charset=utf-8',
				Utils.toArray('hello', 'utf8'),
			),
		)
		const { wallet, internalized } = recipientWallet()
		const res = await syncMandalaInbox.execute(createContext(wallet), {})
		expect(res.received).toEqual([])
		expect(res.skipped).toEqual([
			{
				messageId: id,
				reason: 'unsupported content type text/plain; charset=utf-8',
			},
		])
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	})

	test('a protocolID naming a different token than the script is skipped', async () => {
		const { wallet: senderWallet } = await fakeWallet()
		await withResolver(() =>
			sendMandala.execute(createContext(senderWallet), {
				tokenId: TOKEN_ID,
				amount: '100',
				destination: { handle: HANDLE },
			}),
		)
		const { body } = openLast()
		relayed.length = 0
		const other = `${'cd'.repeat(32)}.0`
		body.outputs[0].protocolID = [2, `mandala ${'cd'.repeat(32)} 0`]
		const id = await postEnvelope(
			encodeMimeEntity(TRANSACTION_CBOR_CONTENT_TYPE, dagCborEncode(body)),
		)

		const { wallet, internalized } = recipientWallet()
		const res = await syncMandalaInbox.execute(createContext(wallet), {})
		expect(res.received).toEqual([])
		expect(res.skipped).toEqual([
			{
				messageId: id,
				reason: `output 0: token mismatch (protocolID ${other}, script ${TOKEN_ID})`,
			},
		])
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	})

	test('an unknown protocolID is left unacknowledged', async () => {
		const { wallet: senderWallet } = await fakeWallet()
		await withResolver(() =>
			sendMandala.execute(createContext(senderWallet), {
				tokenId: TOKEN_ID,
				amount: '100',
				destination: { handle: HANDLE },
			}),
		)
		const { body } = openLast()
		relayed.length = 0
		body.outputs[0].protocolID = [2, 'some other protocol']
		await postEnvelope(
			encodeMimeEntity(TRANSACTION_CBOR_CONTENT_TYPE, dagCborEncode(body)),
		)
		const { wallet, internalized } = recipientWallet()
		const res = await syncMandalaInbox.execute(createContext(wallet), {})
		expect(res.skipped[0].reason).toStartWith('output 0: unknown protocolID')
		expect(internalized).toHaveLength(0)
		expect(acknowledged).toEqual([])
	})

	test('a failed internalize is not acknowledged', async () => {
		const { wallet: senderWallet } = await fakeWallet()
		await withResolver(() =>
			sendMandala.execute(createContext(senderWallet), {
				tokenId: TOKEN_ID,
				amount: '100',
				destination: { handle: HANDLE },
			}),
		)
		const { wallet } = recipientWallet(true)
		const res = await syncMandalaInbox.execute(createContext(wallet), {})
		expect(res.skipped).toEqual([
			{ messageId: 'env-1', reason: 'internalize refused' },
		])
		expect(acknowledged).toEqual([])
	})

	test('a tampered envelope fails signature verification', async () => {
		const { wallet: senderWallet } = await fakeWallet()
		await withResolver(() =>
			sendMandala.execute(createContext(senderWallet), {
				tokenId: TOKEN_ID,
				amount: '100',
				destination: { handle: HANDLE },
			}),
		)
		const env = dagCborDecode(relayed[0].body) as Record<string, unknown>
		env.created = '2000-01-01T00:00:00Z'
		relayed[0].body = dagCborEncode(env)
		const { wallet, internalized } = recipientWallet()
		const res = await syncMandalaInbox.execute(createContext(wallet), {})
		expect(res.skipped).toEqual([
			{ messageId: 'env-1', reason: 'envelope signature does not verify' },
		])
		expect(internalized).toHaveLength(0)
	})
})
