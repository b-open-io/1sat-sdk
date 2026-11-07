import { describe, expect, test } from 'bun:test'
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
	type ListOutputsArgs,
	LockingScript,
	MerklePath,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	Transaction,
	UnlockingScript,
	type WalletInterface,
	type WalletOutput,
} from '@bsv/sdk'
import { createContext } from '../types.js'
import { burn1Color } from './burn.js'

const SENDER = PrivateKey.fromHex('11'.repeat(32))
const SENDER_ID = SENDER.toPublicKey().toString()
/** What the held outputs are locked to; the fake never checks custody. */
const OWN_LOCK = SENDER.toPublicKey().toHash() as number[]

/** The asset, deployed fixed: its output 0 holds the whole supply. */
const DEPLOY = new Transaction()
DEPLOY.addOutput({
	lockingScript: OneColor.deployValue(100n, { lock: OWN_LOCK }).lock(),
	satoshis: 1,
})
DEPLOY.merklePath = new MerklePath(1, [
	[{ offset: 0, hash: DEPLOY.id('hex'), txid: true }],
])
const ASSET_TXID = DEPLOY.id('hex')
const ASSET_ID = `${ASSET_TXID}_0`
const BASKET = assetBasket(ASSET_ID, 'value')

/** A derivation suffix tag, as the module files it: `p color <sha256 hex>`. */
const suffixTag = (n: number): string =>
	`p color ${n.toString(16).padStart(64, '0')}`

interface Held {
	amount: bigint
	/** The asset's deploy output: the supply, with no token id of its own. */
	deploy?: boolean
	/** Filed without its suffix tag: the module will not spend it. */
	untagged?: boolean
	/** Reserved as an input of a pending action. */
	reserved?: boolean
}

/**
 * A wallet holding `holds` in the asset's value basket — one proven output
 * each — and a `createAction` stand-in for the permissions manager, which
 * records the args and returns a transaction of the requested outputs.
 */
function walletHolding(holds: Held[]) {
	const created: CreateActionArgs[] = []
	const listed: ListOutputsArgs[] = []
	const sources = new Beef()
	const outputs: WalletOutput[] = holds.map((hold, i) => {
		const tx = new Transaction()
		tx.addOutput({
			lockingScript:
				hold.deploy === true
					? OneColor.deployValue(hold.amount, { lock: OWN_LOCK }).lock()
					: OneColor.value(ASSET_ID, hold.amount, {
							lock: OWN_LOCK,
						}).lock(),
			satoshis: 1,
		})
		tx.merklePath = new MerklePath(1, [
			[{ offset: 0, hash: tx.id('hex'), txid: true }],
		])
		sources.mergeTransaction(tx)
		return {
			// A deploy output is the asset's own output 0.
			outpoint: hold.deploy === true ? `${ASSET_TXID}.0` : `${tx.id('hex')}.0`,
			satoshis: 1,
			lockingScript: tx.outputs[0].lockingScript.toHex(),
			spendable: hold.reserved !== true,
			tags: hold.untagged === true ? [] : [suffixTag(i + 1)],
		}
	})
	const proto = new ProtoWallet(SENDER)
	const wallet = Object.assign(Object.create(proto), {
		listOutputs: async (args: ListOutputsArgs) => {
			listed.push(args)
			const offset = args.offset ?? 0
			return {
				totalOutputs: outputs.length,
				outputs: outputs.slice(offset, offset + (args.limit ?? 10)),
				...(args.include === 'entire transactions'
					? { BEEF: sources.toBinary() }
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
	return { wallet, created, listed, outputs }
}

/** The plan a burn carries, parsed back out of its labels. */
function planOf(args: CreateActionArgs) {
	return ColorPlan.fromLabels(args.labels ?? []) as unknown as {
		assets: string[]
		operations: Array<{ assetId: string; operation: string }>
		ownedOutputs: ColorRemittance[]
		inputPositions: unknown[]
	}
}

/** The public key hash a plan remittance names, as the module derives it. */
async function keyOf(remittance: ColorRemittance): Promise<string> {
	const { publicKey } = await new ProtoWallet(SENDER).getPublicKey({
		protocolID: colorProtocolID(
			remittance.assetId as string,
			remittance.derivationPrefix as string,
			remittance.derivationSuffix as string,
		),
		keyID: COLOR_KEY_ID,
		counterparty: remittance.senderIdentityKey as string,
		forSelf: true,
	})
	return new P2PKH()
		.lock(PublicKey.fromString(publicKey).toHash() as number[])
		.toHex()
}

describe('burn1Color', () => {
	test('one value input covering the amount, the rest back as one owned output', async () => {
		const { wallet, created, outputs } = walletHolding([{ amount: 100n }])
		const res = await burn1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '60',
		})
		expect(res.error).toBeUndefined()
		expect(res.txid).toBeDefined()
		expect(res.burned).toBe('60')
		expect(res.remainder).toBe('40')

		expect(created).toHaveLength(1)
		const args = created[0]
		expect(args.description).toBe('Burn 60 1Color tokens')
		expect(args.options).toEqual({ randomizeOutputs: false })

		// The input is named by the action, not selected by the module: a burn
		// gets no change, so the selection is the action's to make.
		expect(args.inputs).toEqual([
			{
				outpoint: outputs[0].outpoint,
				unlockingScriptLength: 108,
				inputDescription: '1Color tokens to burn',
			},
		])

		// One output: the remainder, under a fresh key the plan names.
		expect(args.outputs).toHaveLength(1)
		const out = args.outputs![0]
		expect(out.satoshis).toBe(1)
		expect(out.outputDescription).toBe('1Color token change')
		const token = OneColor.decode(LockingScript.fromHex(out.lockingScript))
		expect(token?.role).toBe('value')
		expect(token?.tokenId).toBe(ASSET_ID)
		expect(token?.amount).toBe(40n)

		const plan = planOf(args)
		expect(plan.assets).toEqual([ASSET_ID])
		expect(plan.inputPositions).toEqual([])
		// BRC-207 derives `transfer` (the remainder) and `burn` (the rest) from
		// one transaction, so the plan must name both.
		expect(plan.operations).toEqual([
			{ assetId: ASSET_ID, operation: 'transfer' },
			{ assetId: ASSET_ID, operation: 'burn' },
		])
		expect(plan.ownedOutputs).toHaveLength(1)
		expect(plan.ownedOutputs[0].outputIndex).toBe(0)
		expect(plan.ownedOutputs[0].assetId).toBe(ASSET_ID)
		expect(plan.ownedOutputs[0].senderIdentityKey).toBe(SENDER_ID)
		expect(token?.lock.toHex()).toBe(await keyOf(plan.ownedOutputs[0]))
	})

	test('exact coverage burns with no token output at all', async () => {
		const { wallet, created } = walletHolding([{ amount: 100n }])
		const res = await burn1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '100',
		})
		expect(res.error).toBeUndefined()
		expect(res.remainder).toBe('0')
		expect(created[0].outputs).toEqual([])
		const plan = planOf(created[0])
		expect(plan.operations).toEqual([{ assetId: ASSET_ID, operation: 'burn' }])
		expect(plan.ownedOutputs).toEqual([])
	})

	test('largest first: one big output is enough', async () => {
		const { wallet, created } = walletHolding([
			{ amount: 30n },
			{ amount: 100n },
			{ amount: 5n },
		])
		const res = await burn1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '100',
		})
		expect(res.error).toBeUndefined()
		expect(created[0].inputs).toHaveLength(1)
		expect(res.remainder).toBe('0')
	})

	test('several inputs when one does not cover the amount', async () => {
		const { wallet, created } = walletHolding([
			{ amount: 40n },
			{ amount: 40n },
		])
		const res = await burn1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '60',
		})
		expect(res.error).toBeUndefined()
		expect(created[0].inputs).toHaveLength(2)
		expect(res.remainder).toBe('20')
		expect(planOf(created[0]).operations).toEqual([
			{ assetId: ASSET_ID, operation: 'transfer' },
			{ assetId: ASSET_ID, operation: 'burn' },
		])
	})

	test('inputBEEF carries the source of every named input, and no other', async () => {
		const { wallet, created, outputs } = walletHolding([
			{ amount: 10n },
			{ amount: 200n },
		])
		const res = await burn1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '50',
		})
		expect(res.error).toBeUndefined()
		const args = created[0]
		const named = args.inputs!.map((i) => i.outpoint.split('.')[0] as string)
		expect(named).toEqual([outputs[1].outpoint.split('.')[0]])
		const beef = Beef.fromBinary(args.inputBEEF as number[])
		expect(beef.findTxid(named[0])?.hasProof).toBe(true)
		// The 10-unit output is held, not spent: it is not in the transaction.
		expect(
			beef.findTxid(outputs[0].outpoint.split('.')[0] as string),
		).toBeUndefined()
	})

	test("the asset's own deploy output holds the supply, and burns like value", async () => {
		const { wallet, created } = walletHolding([{ amount: 100n, deploy: true }])
		const res = await burn1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '60',
		})
		expect(res.error).toBeUndefined()
		expect(res.remainder).toBe('40')
		expect(created[0].inputs).toEqual([
			{
				outpoint: `${ASSET_TXID}.0`,
				unlockingScriptLength: 108,
				inputDescription: '1Color tokens to burn',
			},
		])
	})

	test('an output reserved by a pending action is not named', async () => {
		const { wallet, created } = walletHolding([
			{ amount: 100n, reserved: true },
			{ amount: 60n },
		])
		const res = await burn1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '60',
		})
		expect(res.error).toBeUndefined()
		expect(created[0].inputs).toHaveLength(1)
		expect(res.remainder).toBe('0')
	})

	test('an output filed without its suffix tag is not spendable', async () => {
		const { wallet, created } = walletHolding([
			{ amount: 100n, untagged: true },
			{ amount: 20n },
		])
		const res = await burn1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '60',
		})
		expect(created).toHaveLength(0)
		expect(res.error).toBe('insufficient-value-balance: 20 spendable of 60')
	})

	test('it reads the asset basket, with scripts, tags and sources', async () => {
		const { wallet, listed } = walletHolding([{ amount: 10n }])
		await burn1Color.execute(createContext(wallet), {
			assetId: ASSET_ID,
			amount: '5',
		})
		expect(listed[0].basket).toBe(BASKET)
		expect(listed[0].include).toBe('entire transactions')
		expect(listed[0].includeTags).toBe(true)
	})

	test('a bad asset id or a zero amount never reaches the wallet', async () => {
		const { wallet, created } = walletHolding([{ amount: 10n }])
		for (const [input, error] of [
			[{ assetId: `${ASSET_TXID}.0`, amount: '1' }, 'invalid-asset-id'],
			[{ assetId: 'ISSUE', amount: '1' }, 'invalid-asset-id'],
			[{ assetId: ASSET_ID, amount: '0' }, 'amount-must-be-positive'],
			[{ assetId: ASSET_ID, amount: '-5' }, 'amount-must-be-positive'],
		] as const) {
			const res = await burn1Color.execute(createContext(wallet), input)
			expect(res.error).toStartWith(error)
		}
		expect(created).toHaveLength(0)
	})
})
