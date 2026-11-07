import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { OneColor } from '@1sat/templates'
import {
	COLOR_KEY_ID,
	ColorPlan,
	type ColorRemittance,
	assetBasket,
	colorProtocolID,
} from '@bsv/color-permission-module'
import {
	Beef,
	type CreateActionArgs,
	EncryptedMessage,
	type ListOutputsArgs,
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
	decodeTransactionDelivery,
	transactionDeliveryBody,
} from '../metanet/delivery.js'
import { messageRelay } from '../metanet/relay.js'
import { createContext } from '../types.js'
import { mint1Color } from './mint.js'
import { parseColorReceipt } from './receipt.js'

const ASSET_TXID = 'ab'.repeat(32)
const ASSET_ID = `${ASSET_TXID}_0`
const VALUE_BASKET = assetBasket(ASSET_ID, 'value')
const SENDER = PrivateKey.fromHex('11'.repeat(32))
const SENDER_ID = SENDER.toPublicKey().toString()
const RECIPIENT = PrivateKey.fromHex('22'.repeat(32))
const RECIPIENT_ID = RECIPIENT.toPublicKey().toString()
const RESOLVED_BOX = 'https://messagebox.lkup.net'
const HANDLE = '@deggen+conf@lkup.net'

/** The BRC-231 relay fake: one in-memory messagebox. */
const relayed: Array<{
	messageBox: string
	recipient: string
	body: Uint8Array
}> = []
let relayDown = false
Object.assign(messageRelay, {
	sendCborMessage: async (
		_wallet: unknown,
		_messagebox: string,
		recipient: string,
		messageBox: string,
		body: Uint8Array,
	) => {
		if (relayDown) throw new Error('sendMessage 503')
		relayed.push({ messageBox, recipient, body })
		return { status: 'success', messageId: `env-${relayed.length}` }
	},
})

/** BRC-169 resolution for HANDLE; anything else is a test bug. */
function network(): void {
	const real = globalThis.fetch
	globalThis.fetch = (async (url: RequestInfo | URL) => {
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
		throw new Error(`unexpected fetch ${u}`)
	}) as typeof fetch
	afterEach(() => {
		globalThis.fetch = real
	})
}

/**
 * A wallet holding one authority for the asset, whose `createAction` stands in
 * for the permissions manager with the color module: it records the args and
 * returns the funded transaction, whose outputs are the requested ones.
 */
function walletMinting(holdsAuthority = true) {
	const created: CreateActionArgs[] = []
	const authorityTx = new Transaction()
	authorityTx.addOutput({
		lockingScript: OneColor.authority(ASSET_ID, {
			lock: SENDER.toPublicKey().toHash() as number[],
		}).lock(),
		satoshis: 1,
	})
	authorityTx.merklePath = new MerklePath(1, [
		[{ offset: 0, hash: authorityTx.id('hex'), txid: true }],
	])
	const proto = new ProtoWallet(SENDER)
	const wallet = Object.assign(Object.create(proto), {
		listOutputs: async (args: ListOutputsArgs) => {
			if (args.basket !== assetBasket(ASSET_ID, 'authority')) {
				throw new Error(`unexpected basket ${args.basket}`)
			}
			return {
				totalOutputs: holdsAuthority ? 1 : 0,
				outputs: holdsAuthority
					? [
							{
								outpoint: `${authorityTx.id('hex')}.0`,
								satoshis: 1,
								spendable: true,
								lockingScript: authorityTx.outputs[0].lockingScript.toHex(),
								tags: [`p color ${'cd'.repeat(32)}`],
							},
						]
					: [],
			}
		},
		createAction: async (args: CreateActionArgs) => {
			created.push(args)
			const funding = new Transaction()
			funding.addOutput({
				lockingScript: new LockingScript([]),
				satoshis: 1000,
			})
			funding.merklePath = new MerklePath(1, [
				[{ offset: 0, hash: funding.id('hex'), txid: true }],
			])
			const tx = new Transaction()
			tx.addInput({
				sourceTransaction: funding,
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
	return { wallet, created }
}

/** The P2PKH hash a plan remittance locks, as the module derives it. */
async function lockOf(remittance: {
	derivationPrefix: string
	derivationSuffix: string
	senderIdentityKey: string
}): Promise<string> {
	const { publicKey } = await new ProtoWallet(SENDER).getPublicKey({
		protocolID: colorProtocolID(
			ASSET_ID,
			remittance.derivationPrefix,
			remittance.derivationSuffix,
		),
		keyID: COLOR_KEY_ID,
		counterparty: remittance.senderIdentityKey,
		forSelf: true,
	})
	return new P2PKH()
		.lock(PublicKey.fromString(publicKey).toHash() as number[])
		.toHex()
}

function planOf(args: CreateActionArgs) {
	return ColorPlan.fromLabels(args.labels ?? []) as unknown as {
		assets: string[]
		operations: Array<{ assetId: string; operation: string }>
		ownedOutputs: ColorRemittance[]
	}
}

beforeEach(() => {
	relayed.length = 0
	relayDown = false
})

describe('mint1Color', () => {
	test('a mint to this wallet: the new supply and its own continuing authority', async () => {
		const { wallet, created } = walletMinting()
		const res = await mint1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '1000',
		})
		expect(res.error).toBeUndefined()
		expect(res.assetId).toBe(ASSET_ID)
		expect(relayed).toHaveLength(0)

		expect(created).toHaveLength(1)
		const args = created[0]
		expect(args.description).toBe('Mint 1000 1Color tokens')
		expect(args.options).toEqual({ randomizeOutputs: false })

		// A mint is a value output; there is no mint output in BRC-162.
		expect(args.outputs).toHaveLength(2)
		const minted = OneColor.decode(
			LockingScript.fromHex(args.outputs![0].lockingScript),
		)
		expect(minted?.role).toBe('value')
		expect(minted?.tokenId).toBe(ASSET_ID)
		expect(minted?.amount).toBe(1000n)
		// The authority is re-locked to a fresh key, so the token stays mintable.
		const authority = OneColor.decode(
			LockingScript.fromHex(args.outputs![1].lockingScript),
		)
		expect(authority?.role).toBe('authority')
		expect(authority?.tokenId).toBe(ASSET_ID)
		expect(args.outputs![1].outputDescription).toBe('1Color minting authority')

		const plan = planOf(args)
		expect(plan.assets).toEqual([ASSET_ID])
		// One authority in, one out: BRC-207 reads that as authority-transfer,
		// and the new units as a mint. The module picks the authority input.
		expect(plan.operations).toEqual([
			{ assetId: ASSET_ID, operation: 'mint' },
			{ assetId: ASSET_ID, operation: 'authority-transfer' },
		])
		expect(plan.ownedOutputs).toHaveLength(2)
		expect(plan.ownedOutputs.map((o) => o.outputIndex)).toEqual([0, 1])
		expect(args.inputs).toBeUndefined()
		expect(minted?.lock.toHex()).toBe(await lockOf(plan.ownedOutputs[0]))
		expect(authority?.lock.toHex()).toBe(await lockOf(plan.ownedOutputs[1]))
	})

	test('a mint to a handle: their key, an authority we keep, and the delivery', async () => {
		const { wallet, created } = walletMinting()
		network()
		const res = await mint1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '250',
			destination: { handle: HANDLE },
			memo: 'airdrop',
		})
		expect(res.error).toBeUndefined()
		expect(res.delivered).toBe('envelope')
		expect(res.messageId).toBe('env-1')

		const args = created[0]
		expect(args.description).toBe(`Mint 250 1Color tokens to ${HANDLE}`)
		const plan = planOf(args)
		// Only the authority is ours: the supply is theirs, so it is not filed
		// in our basket and the plan names no remittance for it.
		expect(plan.ownedOutputs.map((o) => o.outputIndex)).toEqual([1])

		// Their output is locked to the key they derive from the receipt.
		expect(relayed).toHaveLength(1)
		expect(relayed[0].messageBox).toBe('transaction-delivery')
		expect(relayed[0].recipient).toBe(RECIPIENT_ID)
		const env = (await import('@ipld/dag-cbor')).decode(relayed[0].body) as {
			content: Uint8Array
		}
		const plaintext = EncryptedMessage.decrypt(
			Array.from(env.content),
			RECIPIENT,
		)
		const body = decodeTransactionDelivery(transactionDeliveryBody(plaintext))
		expect(body.memo).toBe('airdrop')
		expect(Utils.toHex(Array.from(body.txid))).toBe(res.txid!)
		expect(Array.from(body.beef)).toEqual(Beef.fromBinary(res.tx!).toBinary())
		expect(body.outputs).toHaveLength(1)
		const entry = body.outputs[0]
		if (entry.protocol !== 'basket insertion') throw new Error('entry')
		expect(entry.outputIndex).toBe(0)
		expect(entry.insertionRemittance.basket).toBe(VALUE_BASKET)
		const receipt = parseColorReceipt(
			entry.insertionRemittance.customInstructions,
		)
		expect(receipt.assetId).toBe(ASSET_ID)
		expect(receipt.senderIdentityKey).toBe(SENDER_ID)

		// From the receipt alone, they derive the lock the output carries.
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
		expect(
			OneColor.decode(
				LockingScript.fromHex(args.outputs![0].lockingScript),
			)?.lock.toHex(),
		).toBe(
			new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(),
		)

		// A failed delivery can be retried from the action's own labels.
		const hex = (b64: string) => Utils.toHex(Utils.toArray(b64, 'base64'))
		expect(args.labels).toContain(
			`1color mint ${hex(receipt.derivationPrefix)} ${hex(receipt.derivationSuffix)}`,
		)
	})

	test('a wallet with no authority cannot mint, and signs nothing', async () => {
		const { wallet, created } = walletMinting(false)
		const res = await mint1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '10',
		})
		expect(res.error).toBe(
			`no-authority-for-asset: this wallet holds no spendable authority for ${ASSET_ID}`,
		)
		expect(created).toHaveLength(0)
	})

	test('a bad asset id, amount or memo never reaches the wallet', async () => {
		const { wallet, created } = walletMinting()
		network()
		for (const [input, error] of [
			[{ assetId: 'ISSUE', amount: '1' }, 'invalid-asset-id'],
			[{ assetId: ASSET_ID, amount: '0' }, 'amount-must-be-positive'],
		] as const) {
			const res = await mint1Color.execute(createContext(wallet), input)
			expect(res.error).toStartWith(error)
		}
		const memo = await mint1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '1',
			destination: { handle: HANDLE },
			memo: 'x'.repeat(2001),
		})
		expect(memo).toEqual({ error: 'BRC-232: memo exceeds 2000 UTF-8 bytes' })
		expect(created).toHaveLength(0)
		expect(relayed).toHaveLength(0)
	})

	test('a failed delivery still mints: the transaction and the error come back', async () => {
		const { wallet } = walletMinting()
		network()
		relayDown = true
		const res = await mint1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '10',
			destination: { handle: HANDLE },
		})
		expect(res.txid).toBeDefined()
		expect(res.tx).toBeDefined()
		expect(res.assetId).toBe(ASSET_ID)
		expect(res.delivered).toBeUndefined()
		expect(res.error).toBe('delivery-failed: sendMessage 503')
	})
})
