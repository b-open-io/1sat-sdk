import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { OneColor } from '@1sat/templates'
import {
	COLOR_KEY_ID,
	ColorPlan,
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
	type WalletOutput,
} from '@bsv/sdk'
import {
	decodeTransactionDelivery,
	transactionDeliveryBody,
} from '../metanet/delivery.js'
import { messageRelay } from '../metanet/relay.js'
import { createContext } from '../types.js'
import { authorities1Color } from './authorities.js'
import { endAuthority1Color, transferAuthority1Color } from './authority.js'
import { parseColorReceipt } from './receipt.js'

const SENDER = PrivateKey.fromHex('11'.repeat(32))
const SENDER_ID = SENDER.toPublicKey().toString()
const RECIPIENT = PrivateKey.fromHex('22'.repeat(32))
const RECIPIENT_ID = RECIPIENT.toPublicKey().toString()
const RESOLVED_BOX = 'https://messagebox.lkup.net'
const HANDLE = '@deggen+conf@lkup.net'
/** What the held outputs are locked to; the fake never checks custody. */
const OWN_LOCK = SENDER.toPublicKey().toHash() as number[]

/** The asset, deployed as an authority: its output 0 is the token's authority. */
const DEPLOY = new Transaction()
DEPLOY.addOutput({
	lockingScript: OneColor.deployAuthority({ lock: OWN_LOCK }).lock(),
	satoshis: 1,
})
DEPLOY.merklePath = new MerklePath(1, [
	[{ offset: 0, hash: DEPLOY.id('hex'), txid: true }],
])
const ASSET_TXID = DEPLOY.id('hex')
const ASSET_ID = `${ASSET_TXID}_0`
const VALUE_BASKET = assetBasket(ASSET_ID, 'value')
const AUTHORITY_BASKET = assetBasket(ASSET_ID, 'authority')

const suffixTag = (n: number): string =>
	`p color ${n.toString(16).padStart(64, '0')}`

interface Held {
	/** An authority output; otherwise a value output of this amount. */
	authority?: boolean
	/** The asset's deploy output: no token id, its outpoint is the asset id. */
	deploy?: boolean
	amount?: bigint
	untagged?: boolean
	reserved?: boolean
}

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

let resolved = 0
const realFetch = globalThis.fetch
beforeEach(() => {
	relayed.length = 0
	relayDown = false
	resolved = 0
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
			resolved += 1
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
})
afterEach(() => {
	globalThis.fetch = realFetch
})

/**
 * A wallet holding `value` units and `authorities` authority outputs in the
 * asset's two baskets, each a proven output of its own transaction, plus a
 * `createAction` stand-in that records what the action asked for.
 */
function walletHolding(opts: {
	value?: Held[]
	authorities?: Held[]
}) {
	const created: CreateActionArgs[] = []
	const listed: ListOutputsArgs[] = []
	const baskets: Record<string, { outputs: WalletOutput[]; beef: number[] }> = {
		[VALUE_BASKET]: { outputs: [], beef: [] },
		[AUTHORITY_BASKET]: { outputs: [], beef: [] },
	}
	let tag = 0
	for (const [role, holds] of [
		['value', opts.value ?? []],
		['authority', opts.authorities ?? []],
	] as const) {
		const basket = baskets[role === 'value' ? VALUE_BASKET : AUTHORITY_BASKET]
		const beef = new Beef()
		for (const hold of holds as Held[]) {
			// The deploy output is the asset's own output 0.
			const tx =
				hold.deploy === true
					? DEPLOY
					: (() => {
							const t = new Transaction()
							t.addOutput({
								lockingScript:
									role === 'authority'
										? OneColor.authority(ASSET_ID, { lock: OWN_LOCK }).lock()
										: OneColor.value(ASSET_ID, hold.amount ?? 0n, {
												lock: OWN_LOCK,
											}).lock(),
								satoshis: 1,
							})
							t.merklePath = new MerklePath(1, [
								[{ offset: 0, hash: t.id('hex'), txid: true }],
							])
							return t
						})()
			beef.mergeTransaction(tx)
			tag += 1
			basket.outputs.push({
				outpoint:
					hold.deploy === true ? `${ASSET_TXID}.0` : `${tx.id('hex')}.0`,
				satoshis: 1,
				lockingScript: tx.outputs[0].lockingScript.toHex(),
				spendable: hold.reserved !== true,
				tags: hold.untagged === true ? [] : [suffixTag(tag)],
			})
		}
		basket.beef = beef.toBinary()
	}
	const proto = new ProtoWallet(SENDER)
	const wallet = Object.assign(Object.create(proto), {
		listOutputs: async (args: ListOutputsArgs) => {
			listed.push(args)
			const basket = baskets[args.basket as string]
			if (basket === undefined)
				throw new Error(`unexpected basket ${args.basket}`)
			const offset = args.offset ?? 0
			return {
				totalOutputs: basket.outputs.length,
				outputs: basket.outputs.slice(offset, offset + (args.limit ?? 10)),
				...(args.include === 'entire transactions'
					? { BEEF: basket.beef }
					: {}),
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
	return { wallet, created, listed, baskets }
}

function planOf(args: CreateActionArgs) {
	return ColorPlan.fromLabels(args.labels ?? []) as unknown as {
		assets: string[]
		operations: Array<{ assetId: string; operation: string }>
		ownedOutputs: unknown[]
		inputPositions: unknown[]
	}
}

describe('endAuthority1Color', () => {
	test('the authority is spent with no authority output', async () => {
		const { wallet, created } = walletHolding({
			authorities: [{ authority: true }],
		})
		const res = await endAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
		})
		expect(res.error).toBeUndefined()
		expect(res.authorityOutputs).toBe(1)
		expect(res.authorityOutputsHeld).toBe(1)

		expect(created).toHaveLength(1)
		const args = created[0]
		expect(args.description).toBe(`End 1Color authority ${ASSET_ID}`)
		expect(args.outputs).toEqual([])
		// One authority: the module selects it from the authority basket.
		expect(args.inputs).toBeUndefined()
		expect(args.inputBEEF).toBeUndefined()
		expect(args.options).toEqual({ randomizeOutputs: false })
		const plan = planOf(args)
		expect(plan.assets).toEqual([ASSET_ID])
		expect(plan.operations).toEqual([
			{ assetId: ASSET_ID, operation: 'authority-end' },
		])
		expect(plan.ownedOutputs).toEqual([])
		expect(plan.inputPositions).toEqual([])
	})

	test('all: every authority this wallet holds goes in one transaction', async () => {
		const { wallet, created, baskets } = walletHolding({
			authorities: [{ authority: true }, { authority: true }],
		})
		const res = await endAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			all: true,
		})
		expect(res.error).toBeUndefined()
		expect(res.authorityOutputs).toBe(2)

		const args = created[0]
		expect(args.description).toBe('End 2 1Color authorities')
		expect(args.inputs).toEqual(
			baskets[AUTHORITY_BASKET].outputs.map((out) => ({
				outpoint: out.outpoint,
				unlockingScriptLength: 108,
				inputDescription: '1Color minting authority',
			})),
		)
		// Named inputs must be funded by the action, not by the module.
		const beef = Beef.fromBinary(args.inputBEEF as number[])
		expect(beef.findTxid('de'.repeat(32))).toBeUndefined()
		for (const out of baskets[AUTHORITY_BASKET].outputs) {
			expect(beef.findTxid(out.outpoint.split('.')[0])?.hasProof).toBe(true)
		}
		// Any number of authority inputs with no authority output is still one
		// authority-end.
		expect(planOf(args).operations).toEqual([
			{ assetId: ASSET_ID, operation: 'authority-end' },
		])
	})

	test("the asset's own deploy output is its authority", async () => {
		const { wallet, created } = walletHolding({
			authorities: [{ deploy: true }],
		})
		const res = await endAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			all: true,
		})
		expect(res.error).toBeUndefined()
		expect(res.authorityOutputs).toBe(1)
		expect(created[0].inputs).toHaveLength(1)
		expect(created[0].inputs?.[0].outpoint).toBe(`${ASSET_TXID}.0`)
	})

	test('no authority: the error comes before anything is signed', async () => {
		const { wallet, created, listed } = walletHolding({
			value: [{ amount: 5n }],
		})
		const res = await endAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
		})
		expect(res.error).toBe(
			`no-authority-for-asset: this wallet holds no spendable authority for ${ASSET_ID}`,
		)
		expect(created).toHaveLength(0)
		expect(listed).toHaveLength(1)
	})

	test('an authority the module cannot spend is refused rather than left behind', async () => {
		const { wallet, created } = walletHolding({
			authorities: [{ authority: true, untagged: true }, { authority: true }],
		})
		const res = await endAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			all: true,
		})
		expect(created).toHaveLength(0)
		expect(res.error).toStartWith('authority-without-suffix-tag: ')
	})

	test('a reserved authority is not named, so all does not claim it', async () => {
		const { wallet, created } = walletHolding({
			authorities: [{ authority: true, reserved: true }, { authority: true }],
		})
		const res = await endAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			all: true,
		})
		expect(res.error).toBeUndefined()
		expect(res.authorityOutputs).toBe(1)
		expect(res.authorityOutputsHeld).toBe(1)
		expect(created[0].inputs).toHaveLength(1)
	})
})

describe('transferAuthority1Color', () => {
	test('one authority output to the recipient, delivered for them to receive', async () => {
		const { wallet, created } = walletHolding({
			authorities: [{ authority: true }],
		})
		const res = await transferAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			destination: { handle: HANDLE },
		})
		expect(res.error).toBeUndefined()
		expect(res.delivered).toBe('envelope')
		expect(res.messageId).toBe('env-1')

		expect(created).toHaveLength(1)
		const args = created[0]
		expect(args.description).toBe(
			`Transfer 1Color authority ${ASSET_ID} to ${HANDLE}`,
		)
		expect(args.options).toEqual({ randomizeOutputs: false })
		expect(args.outputs).toHaveLength(1)
		expect(args.outputs![0].outputDescription).toBe('1Color minting authority')
		const authority = OneColor.decode(
			LockingScript.fromHex(args.outputs![0].lockingScript),
		)
		expect(authority?.role).toBe('authority')
		expect(authority?.tokenId).toBe(ASSET_ID)

		const plan = planOf(args)
		expect(plan.operations).toEqual([
			{ assetId: ASSET_ID, operation: 'authority-transfer' },
		])
		// Nothing is kept: the authority leaves the wallet, so the plan names
		// no owned output and the module selects exactly one authority input.
		expect(plan.ownedOutputs).toEqual([])
		expect(args.inputs).toBeUndefined()

		expect(relayed).toHaveLength(1)
		expect(relayed[0].messageBox).toBe('transaction-delivery')
		expect(relayed[0].recipient).toBe(RECIPIENT_ID)
		const { decode } = await import('@ipld/dag-cbor')
		const env = decode(relayed[0].body) as { content: Uint8Array }
		const plaintext = EncryptedMessage.decrypt(
			Array.from(env.content),
			RECIPIENT,
		)
		const body = decodeTransactionDelivery(transactionDeliveryBody(plaintext))
		const entry = body.outputs[0]
		if (entry.protocol !== 'basket insertion') throw new Error('entry')
		expect(entry.outputIndex).toBe(0)
		// The authority basket, not the value basket: it holds no units.
		expect(entry.insertionRemittance.basket).toBe(AUTHORITY_BASKET)
		const receipt = parseColorReceipt(
			entry.insertionRemittance.customInstructions,
		)
		expect(receipt.assetId).toBe(ASSET_ID)

		// They derive the authority's lock from the receipt alone.
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
		expect(authority?.lock.toHex()).toBe(
			new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(),
		)

		const hex = (b64: string) => Utils.toHex(Utils.toArray(b64, 'base64'))
		expect(args.labels).toContain(
			`1color authority ${hex(receipt.derivationPrefix)} ${hex(receipt.derivationSuffix)}`,
		)
	})

	test('no authority: nothing is resolved, delivered or signed', async () => {
		const { wallet, created } = walletHolding({ value: [{ amount: 1n }] })
		const res = await transferAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			destination: { handle: HANDLE },
		})
		expect(res.error).toBe(
			`no-authority-for-asset: this wallet holds no spendable authority for ${ASSET_ID}`,
		)
		expect(created).toHaveLength(0)
		expect(relayed).toHaveLength(0)
		expect(resolved).toBe(0)
	})

	test('a memo over 2000 bytes transfers nothing', async () => {
		const { wallet, created } = walletHolding({
			authorities: [{ authority: true }],
		})
		const res = await transferAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			destination: { handle: HANDLE },
			memo: 'x'.repeat(2001),
		})
		expect(res).toEqual({ error: 'BRC-232: memo exceeds 2000 UTF-8 bytes' })
		expect(created).toHaveLength(0)
	})

	test('a failed delivery moves the authority anyway: the transaction comes back', async () => {
		const { wallet } = walletHolding({ authorities: [{ authority: true }] })
		relayDown = true
		const res = await transferAuthority1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			destination: { handle: HANDLE },
		})
		expect(res.txid).toBeDefined()
		expect(res.tx).toBeDefined()
		expect(res.delivered).toBeUndefined()
		expect(res.error).toBe('delivery-failed: sendMessage 503')
	})
})

describe('authorities1Color', () => {
	test('what a Token Manager needs to know before it shows itself', async () => {
		const { wallet } = walletHolding({
			value: [{ amount: 40n }, { amount: 5n, reserved: true }],
			authorities: [
				{ deploy: true },
				{ authority: true },
				{ authority: true, untagged: true },
			],
		})
		const res = await authorities1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
		})
		expect(res.error).toBeUndefined()
		expect(res.count).toBe(3)
		expect(res.outputs?.map((o) => o.spendable)).toEqual([true, true, true])
		expect(res.outputs?.map((o) => o.spendableThroughModule)).toEqual([
			true,
			true,
			false,
		])
		// Reserved by a pending action or not, the units are held.
		expect(res.valueBalance).toBe('45')
	})

	test('a bad asset id is not read at all', async () => {
		const { wallet } = walletHolding({ authorities: [{ authority: true }] })
		const listed: ListOutputsArgs[] = []
		const res = await authorities1Color.execute(
			createContext({
				...wallet,
				listOutputs: async (args: ListOutputsArgs) => {
					listed.push(args)
					return wallet.listOutputs(args)
				},
			} as WalletInterface),
			{ assetId: 'ISSUE' },
		)
		expect(res.error).toBe('invalid-asset-id: expected <txid>_<vout>')
		expect(listed).toHaveLength(0)
	})
})
