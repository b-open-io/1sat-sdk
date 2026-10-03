import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Mandala } from '@1sat/templates'
import { MANDALA_BASKET, MANDALA_PROTOCOL } from '@1sat/types'
import {
	Beef,
	type CreateActionArgs,
	LockingScript,
	MerklePath,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	type SignActionArgs,
	Transaction,
	UnlockingScript,
	type WalletInterface,
} from '@bsv/sdk'

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

const { sendMandala } = await import('./send.js')
const { createContext } = await import('../types.js')

const TOKEN_ID = 'ab'.repeat(32)
const TAG = `mandala:${TOKEN_ID}`
const SENDER = PrivateKey.fromHex('11'.repeat(32))
const RECIPIENT = PrivateKey.fromHex('22'.repeat(32))
const RECIPIENT_ID = RECIPIENT.toPublicKey().toString()
const MESSAGEBOX = 'https://messagebox.example'
const HOLD_KEY_ID = 'hold-1'

/** A mined parent, then a tx holding one 100-unit Mandala output for the sender. */
async function walletHolding(proto: ProtoWallet) {
	const parent = new Transaction()
	parent.addOutput({ lockingScript: new LockingScript([]), satoshis: 1000 })
	parent.merklePath = new MerklePath(1, [
		[{ offset: 0, hash: parent.id('hex'), txid: true }],
	])

	const { publicKey } = await proto.getPublicKey({
		protocolID: MANDALA_PROTOCOL,
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
}

/** BRC-100 fake over a ProtoWallet: lists the holding, builds signable txs, applies spends. */
async function fakeWallet(): Promise<{
	wallet: WalletInterface
	rec: Recorded
}> {
	const proto = new ProtoWallet(SENDER)
	const holding = await walletHolding(proto)
	const rec: Recorded = { createArgs: [], signArgs: [] }
	let pending: Transaction | undefined

	const wallet = Object.assign(Object.create(proto), {
		listOutputs: async () => ({
			totalOutputs: 1,
			outputs: [
				{
					outpoint: `${holding.id('hex')}.0`,
					satoshis: 1,
					spendable: true,
					tags: [TAG],
					customInstructions: JSON.stringify({
						protocolID: MANDALA_PROTOCOL,
						keyID: HOLD_KEY_ID,
					}),
				},
			],
			BEEF: holding.toBEEF(),
		}),
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

		const args = rec.createArgs[0]
		expect(args.options?.noSend).toBe(true)
		expect(args.options?.randomizeOutputs).toBe(false)
		expect(args.labels).toContain('p nosend expiry seconds 604800')
		// Every output is a 1-sat Mandala output: no satoshi change.
		const outputs = args.outputs ?? []
		expect(outputs).toHaveLength(2)
		const decoded = outputs.map((o) =>
			Mandala.decode(LockingScript.fromHex(o.lockingScript)),
		)
		for (const [i, o] of outputs.entries()) {
			expect(o.satoshis).toBe(1)
			expect(decoded[i]?.role).toBe('value')
			expect(decoded[i]?.tokenId).toBe(`${TOKEN_ID}_0`)
		}
		expect(decoded.map((d) => d?.amount)).toEqual([60n, 40n])
		expect(outputs[1].basket).toBe(MANDALA_BASKET)
		expect(outputs[1].tags).toContain(TAG)

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
		expect(body.customInstructions.protocol).toBe('mandala')
		expect(body.outputIndex).toBe(0)
		expect(body.amount).toBe(1)
		expect(body.senderIdentityKey).toBe(SENDER.toPublicKey().toString())
		expect(body.transaction).toEqual(res.tx!)

		// The recipient derives the token output's key from the message alone.
		const { publicKey } = await new ProtoWallet(RECIPIENT).getPublicKey({
			protocolID: MANDALA_PROTOCOL,
			keyID: `${body.customInstructions.derivationPrefix} ${body.customInstructions.derivationSuffix}`,
			counterparty: body.senderIdentityKey,
			forSelf: true,
		})
		const tx = Transaction.fromAtomicBEEF(body.transaction)
		const token = Mandala.decode(tx.outputs[body.outputIndex].lockingScript)
		expect(token?.lock.toHex()).toBe(
			new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(),
		)
		// The token input was unlocked by the pipeline (P2PKH under the prefix).
		expect(rec.signArgs[0].spends[0].unlockingScript.length).toBeGreaterThan(0)
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
		expect(args.labels ?? []).not.toContain('p nosend expiry seconds 604800')
		expect(args.outputs).toHaveLength(1)
		const token = Mandala.decode(
			LockingScript.fromHex(args.outputs![0].lockingScript),
		)
		expect(token?.amount).toBe(100n)
		expect(token?.lock.toHex()).toBe(new P2PKH().lock(address).toHex())
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
