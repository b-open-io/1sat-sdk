import { describe, expect, it } from 'bun:test'
import { OrdLockV2 } from '@1sat/templates'
import {
	DEPOSIT_BASKET,
	ORDINALS_BASKET,
	P1SAT_PROTOCOL,
	depositHoldTag,
	depositHoldUntil,
	isDepositHeld,
} from '@1sat/types'
import {
	Beef,
	type CreateActionArgs,
	type CreateActionResult,
	type ListOutputsResult,
	type LockingScript,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	Script,
	Transaction,
	type WalletInterface,
	type WalletOutput,
} from '@bsv/sdk'
import { PENDING_RESOLVED_SPENDS_KEY } from '../pipeline/spendTargets.js'
import {
	ORDLOCK_FUNDING_HOLD_MS,
	applyOrdLockV2Purchase,
	hasUnpreparedOrdLockV2Purchase,
	selectFrontFunding,
} from './ordlockPurchase.js'

const NOW = 1_800_000_000_000
const seller = new PrivateKey(9001).toAddress()
const buyerLock = new P2PKH().lock(new PrivateKey(9002).toAddress())

/** ProtoWallet plus just enough BRC-100 surface for the apply step. */
class StubWallet extends ProtoWallet {
	held: WalletOutput[] = []
	heldBeef = new Beef()
	created: CreateActionArgs[] = []
	constructor(private readonly fundingKey: PrivateKey) {
		super(new PrivateKey(9003))
	}
	async listOutputs(): Promise<ListOutputsResult> {
		return {
			totalOutputs: this.held.length,
			outputs: this.held,
			BEEF: this.heldBeef.toBinary(),
		}
	}
	async createAction(args: CreateActionArgs): Promise<CreateActionResult> {
		this.created.push(args)
		const tx = new Transaction()
		const fund = new Transaction()
		fund.addOutput({ satoshis: 1_000_000, lockingScript: buyerLock })
		tx.addInput({
			sourceTransaction: fund,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: new P2PKH().unlock(this.fundingKey),
		})
		for (const o of args.outputs ?? []) {
			tx.addOutput({
				satoshis: o.satoshis,
				lockingScript: Script.fromHex(o.lockingScript) as LockingScript,
			})
		}
		await tx.sign()
		return { txid: tx.id('hex'), tx: tx.toAtomicBEEF() }
	}
}

const asWallet = (w: StubWallet) => w as unknown as WalletInterface

function listingArgs(price: number, extra: CreateActionArgs['outputs'] = []) {
	const lock = OrdLockV2.lock(seller, seller, price)
	const listingTx = new Transaction()
	listingTx.addOutput({ satoshis: 1, lockingScript: lock as LockingScript })
	const beef = new Beef()
	beef.mergeTransaction(listingTx)
	const outpoint = `${listingTx.id('hex')}.0`
	const payout = OrdLockV2.payoutOutput(lock)
	const args: CreateActionArgs = {
		description: 'Purchase ordinal',
		inputBEEF: beef.toBinary(),
		inputs: [
			{
				outpoint,
				inputDescription: 'Listed ordinal',
				unlockingScriptLength: 1,
			},
		],
		outputs: [
			{
				lockingScript: buyerLock.toHex(),
				satoshis: 1,
				outputDescription: 'Purchased ordinal',
				basket: ORDINALS_BASKET,
				tags: [],
			},
			{
				lockingScript: payout.lockingScript.toHex(),
				satoshis: payout.satoshis ?? 0,
				outputDescription: 'Payment to seller',
				tags: [],
			},
			...(extra ?? []),
		],
		options: { randomizeOutputs: false },
	}
	return { args, lock, outpoint }
}

async function heldOutput(
	wallet: StubWallet,
	keyID: string,
	satoshis: number,
	tags: string[],
): Promise<void> {
	const { publicKey } = await wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: 'self',
		forSelf: true,
	})
	const lock = new P2PKH().lock(PublicKey.fromString(publicKey).toAddress())
	const tx = new Transaction()
	tx.addOutput({ satoshis, lockingScript: lock })
	wallet.heldBeef.mergeTransaction(tx)
	wallet.held.push({
		outpoint: `${tx.id('hex')}.0`,
		satoshis,
		spendable: true,
		tags,
		customInstructions: JSON.stringify({
			protocolID: P1SAT_PROTOCOL,
			keyID,
			counterparty: 'self',
		}),
	})
}

describe('deposit hold tags', () => {
	it('round-trip and expiry', () => {
		const tag = depositHoldTag(NOW + 1000)
		expect(tag).toBe(`hold:${NOW + 1000}`)
		expect(depositHoldUntil([tag, 'x'])).toBe(NOW + 1000)
		expect(isDepositHeld([tag], NOW)).toBe(true)
		expect(isDepositHeld([tag], NOW + 1000)).toBe(false)
		expect(isDepositHeld(['ordlock-funding'], NOW)).toBe(false)
		expect(isDepositHeld(undefined, NOW)).toBe(false)
	})
})

describe('selectFrontFunding', () => {
	const c = (satoshis: number) => ({
		outpoint: `${satoshis}`,
		satoshis,
		customInstructions: '{}',
	})
	it('prefers the smallest single cover, else combines from the largest', () => {
		expect(
			selectFrontFunding([c(5000), c(1200), c(900)], 1000)?.map(
				(x) => x.satoshis,
			),
		).toEqual([1200])
		expect(
			selectFrontFunding([c(600), c(500), c(100)], 1000)?.map(
				(x) => x.satoshis,
			),
		).toEqual([600, 500])
		expect(selectFrontFunding([c(100), c(100)], 1000)).toBeNull()
	})
})

describe('applyOrdLockV2Purchase', () => {
	it('is a no-op for non-listing args and detects v2 listing inputs', async () => {
		const wallet = new StubWallet(new PrivateKey(9002))
		const plain: CreateActionArgs = { description: 'x', outputs: [] }
		expect(hasUnpreparedOrdLockV2Purchase(plain)).toBe(false)
		const { args } = listingArgs(1000)
		expect(hasUnpreparedOrdLockV2Purchase(args)).toBe(true)
		await applyOrdLockV2Purchase(asWallet(wallet), args, NOW)
		expect(hasUnpreparedOrdLockV2Purchase(args)).toBe(false)
	})

	it('prepares front funding when nothing held covers the payout', async () => {
		const wallet = new StubWallet(new PrivateKey(9002))
		const { args, lock, outpoint } = listingArgs(1000, [
			{
				lockingScript: buyerLock.toHex(),
				satoshis: 20,
				outputDescription: 'Marketplace fee',
				tags: [],
			},
		])
		await applyOrdLockV2Purchase(asWallet(wallet), args, NOW)

		// one preparation createAction, exactly the payout, held in the deposit basket
		expect(wallet.created.length).toBe(1)
		const prep = wallet.created[0].outputs?.[0]
		expect(wallet.created[0].options?.acceptDelayedBroadcast).toBe(false)
		expect(prep?.satoshis).toBe(1000)
		expect(prep?.basket).toBe(DEPOSIT_BASKET)
		expect(prep?.tags).toContain(depositHoldTag(NOW + ORDLOCK_FUNDING_HOLD_MS))

		// inputs: front funding, then the listing with its exact reservation
		expect(args.inputs?.length).toBe(2)
		expect(args.inputs?.[1].outpoint).toBe(outpoint)
		expect(args.inputs?.[1].unlockingScriptLength).toBe(
			OrdLockV2.estimatePurchaseUnlockLength(lock),
		)
		// outputs: filler (cushion 0), payout at 1, receive at 2, fee at 3
		const outs = args.outputs ?? []
		expect(outs.map((o) => o.satoshis)).toEqual([0, 1000, 1, 20])
		expect(outs[0].lockingScript).toBe('006a')
		expect(outs[1].lockingScript).toBe(
			OrdLockV2.payoutOutput(lock).lockingScript.toHex(),
		)
		expect(outs[2].basket).toBe(ORDINALS_BASKET)
		expect(outs[3].outputDescription).toBe('Marketplace fee')

		// front input signable from its CI; funding tx merged into inputBEEF
		const pending = (args as unknown as Record<string, unknown>)[
			PENDING_RESOLVED_SPENDS_KEY
		] as Array<{ outpoint: string; customInstructions?: string }>
		const frontOutpoint = String(args.inputs?.[0].outpoint)
		expect(pending.length).toBe(1)
		expect(pending[0].outpoint).toBe(frontOutpoint)
		expect(JSON.parse(pending[0].customInstructions ?? '{}').keyID).toMatch(
			/^ordlock-funding /,
		)
		const merged = Beef.fromBinary(Array.from(args.inputBEEF ?? []))
		expect(
			merged.findTxid(args.inputs?.[0].outpoint.split('.')[0] ?? ''),
		).not.toBeNull()
		expect(args.options?.trustSelf).toBe('known')
	})

	it('reuses a held output and returns the cushion to the deposit basket', async () => {
		const wallet = new StubWallet(new PrivateKey(9002))
		await heldOutput(wallet, 'ordlock-funding earlier', 5000, [
			'ordlock-funding',
			depositHoldTag(NOW + 60_000),
		])
		// an expired hold and an unrelated deposit must not be used
		await heldOutput(wallet, 'ordlock-funding stale', 9000, [
			depositHoldTag(NOW - 1),
		])
		await heldOutput(wallet, 'deposit 1', 9000, [])
		const { args } = listingArgs(1000)
		await applyOrdLockV2Purchase(asWallet(wallet), args, NOW)

		expect(wallet.created.length).toBe(0)
		expect(args.inputs?.[0].outpoint).toBe(wallet.held[0].outpoint)
		const outs = args.outputs ?? []
		expect(outs.map((o) => o.satoshis)).toEqual([4000, 1000, 1])
		expect(outs[0].basket).toBe(DEPOSIT_BASKET)
		expect(outs[0].tags).toContain(
			depositHoldTag(NOW + ORDLOCK_FUNDING_HOLD_MS),
		)
		expect(JSON.parse(outs[0].customInstructions ?? '{}').keyID).toMatch(
			/cushion/,
		)
	})

	it('leaves a cancel alone: listing input without a payout output', async () => {
		const wallet = new StubWallet(new PrivateKey(9002))
		const { args } = listingArgs(1000)
		// cancel draft: the listing input and the reclaimed ordinal, no payout
		args.outputs = args.outputs?.filter((o) => o.basket)
		const before = JSON.stringify(args)
		expect(hasUnpreparedOrdLockV2Purchase(args)).toBe(false)
		await applyOrdLockV2Purchase(asWallet(wallet), args, NOW)
		expect(wallet.created.length).toBe(0)
		expect(JSON.stringify(args)).toBe(before)
	})

	it('rejects a draft without one basketed 1-sat receive per listing', async () => {
		const wallet = new StubWallet(new PrivateKey(9002))
		const { args } = listingArgs(1000)
		args.outputs = args.outputs?.filter((o) => !o.basket)
		await expect(
			applyOrdLockV2Purchase(asWallet(wallet), args, NOW),
		).rejects.toThrow(/receive output/)
	})

	it('produces a transaction the template signs and routes correctly', async () => {
		// Build the final tx the way the wallet would (explicit inputs in order,
		// outputs in order, change appended) and run the purchase template.
		const fundingKey = new PrivateKey(9002)
		const wallet = new StubWallet(fundingKey)
		const { args, lock } = listingArgs(1000)
		await applyOrdLockV2Purchase(asWallet(wallet), args, NOW)
		const beef = Beef.fromBinary(Array.from(args.inputBEEF ?? []))
		const tx = new Transaction()
		for (const [i, input] of (args.inputs ?? []).entries()) {
			const [txid, vout] = input.outpoint.split('.')
			const src = beef.findTxid(txid)?.tx as Transaction
			tx.addInput({
				sourceTransaction: src,
				sourceOutputIndex: Number(vout),
				unlockingScriptTemplate:
					i === 0
						? new P2PKH().unlock(fundingKey) // stub: funding key stands in for the derived key
						: OrdLockV2.purchaseListing(),
			})
		}
		for (const o of args.outputs ?? []) {
			tx.addOutput({
				satoshis: o.satoshis,
				lockingScript: Script.fromHex(o.lockingScript) as LockingScript,
			})
		}
		tx.addOutput({ satoshis: 500, lockingScript: buyerLock })
		// only the listing input is signed by the template under test
		await OrdLockV2.purchaseListing().sign(tx, 1)
		expect(OrdLockV2.ordinalOutput(tx, 1)).toBe(2)
		expect(tx.outputs[1].lockingScript.toHex()).toBe(
			OrdLockV2.payoutOutput(lock).lockingScript.toHex(),
		)
	})
})
