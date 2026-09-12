import { describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
import {
	ORD_LOCK_PREFIX,
	ORD_LOCK_SUFFIX,
	ORD_LOCK_V2_ARTIFACT,
	ORD_LOCK_V2_CANCEL_MARKER,
	ORD_LOCK_V2_PREFIX,
	P1SAT_PROTOCOL,
} from '@1sat/types'
import {
	Hash,
	type LockingScript,
	OP,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	Script,
	Transaction,
	type TransactionOutput,
	TransactionSignature,
	Utils,
} from '@bsv/sdk'
import BSV21 from '../bsv21/bsv21.js'
import OrdLockV2 from './ordlockV2.js'

// Canonical v2 listing produced by the Go harness (ordlock-v2/harness
// gen_vector_test.go, checked in as runar/artifacts/v2_listing_vector.hex):
// seller PKH = 0x11 x20, payout = 1000 sats to P2PKH 0x22 x20. Byte-for-byte
// oracle for lock().
const VECTOR_HEX =
	'76009c637576ab76aa517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e8100011f80517e9321414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff007d97785296789f527952798d9495937776927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e827c7e23022079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798027c7e827c7e01307c7e01c37e2102b405d7f0322a89d0f9f3a98e6f938fdc1c969a8d1382a2bf66a71ae74a1e83b0ad6922e8030000000000001976a914222222222222222222222222222222222222222288acaa7c820128947f7701207f758767519d7b0a6f6c323a63616e63656c8876a914111111111111111111111111111111111111111188ac68'
const SELLER_PKH = new Array(20).fill(0x11)
const PAY_PKH = new Array(20).fill(0x22)
const sellerAddr = Utils.toBase58Check(SELLER_PKH, [0])
const payAddr = Utils.toBase58Check(PAY_PKH, [0])

const buyerKey = new PrivateKey(1001)
const buyerAddr = buyerKey.toAddress()
const buyerLock = new P2PKH().lock(buyerAddr)

type Source = { txid: string; vout: number; satoshis: number; script: string }
type Vector = {
	name: string
	sources: Source[]
	tx: string
	/** listing input index → expected receive output index */
	deliveries: Record<string, number>
}
const vectors: Vector[] = []

function sourcesOf(tx: Transaction): Source[] {
	return tx.inputs.map((i) => {
		const src = i.sourceTransaction as Transaction
		const out = src.outputs[i.sourceOutputIndex]
		return {
			txid: src.id('hex'),
			vout: i.sourceOutputIndex,
			satoshis: out.satoshis as number,
			script: out.lockingScript.toHex(),
		}
	})
}

function record(
	name: string,
	tx: Transaction,
	deliveries: Record<string, number>,
) {
	vectors.push({ name, sources: sourcesOf(tx), tx: tx.toHex(), deliveries })
}

/**
 * A tx holding the buyer's front funding output(s), the given listings, and
 * one fee funding output:
 *   0 … f-1 front funding · f … f+n-1 listings · f+n fee funding
 */
function listingTx(
	locks: Script[],
	front: number[] = [100_000],
	fee = 5_000,
): Transaction {
	const tx = new Transaction()
	for (const sats of front) {
		tx.addOutput({ satoshis: sats, lockingScript: buyerLock })
	}
	for (const lock of locks) {
		tx.addOutput({ satoshis: 1, lockingScript: lock as LockingScript })
	}
	tx.addOutput({ satoshis: fee, lockingScript: buyerLock })
	return tx
}

/** Appends raw bytes to a script by re-parsing the concatenation. */
function appendBytes(script: Script, extra: Script): Script {
	return Script.fromBinary([...script.toBinary(), ...extra.toBinary()])
}

function p2pkhOut(addr: string, satoshis: number): TransactionOutput {
	return { satoshis, lockingScript: new P2PKH().lock(addr) }
}

const p2pkhUnlock = () => new P2PKH().unlock(buyerKey)

/**
 * Canonical batch purchase of `locks` (all in one listing tx):
 *   inputs  0…f-1 front · f…f+n-1 listings · f+n fee
 *   outputs planPurchase(...) · change
 */
async function buildPurchase(
	locks: Script[],
	receives: TransactionOutput[],
	front: number[] = [100_000],
	opts: { deliveries?: OrdLockV2DeliveryTargetLike[]; change?: number } = {},
) {
	const listing = listingTx(locks, front)
	const f = front.length
	const n = locks.length
	const tx = new Transaction()
	for (let i = 0; i < f; i++) {
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: i,
			unlockingScriptTemplate: p2pkhUnlock(),
		})
	}
	const plan = OrdLockV2.planPurchase({
		frontSatoshis: front,
		listings: locks,
		receives,
		cushionScript: buyerLock,
	})
	const deliveries =
		opts.deliveries ??
		plan.receiveVouts.map((vout, k) => ({
			vout,
			lockingScript: receives[k].lockingScript,
		}))
	for (let i = 0; i < n; i++) {
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: f + i,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(undefined, undefined, {
				deliveries,
			}),
		})
	}
	tx.addInput({
		sourceTransaction: listing,
		sourceOutputIndex: f + n,
		unlockingScriptTemplate: p2pkhUnlock(),
	})
	for (const o of plan.outputs) tx.addOutput(o)
	tx.addOutput(p2pkhOut(buyerAddr, opts.change ?? 4_990))
	return { tx, plan, listing }
}
type OrdLockV2DeliveryTargetLike = { vout: number; lockingScript: Script }

describe('OrdLockV2 artifact', () => {
	it('is the frozen b3f08f2 build of the canonical OrdLockV2Batch', () => {
		// Any recompile must change this test on purpose.
		expect(ORD_LOCK_V2_ARTIFACT.contractName).toBe('OrdLockV2Batch')
		expect(ORD_LOCK_V2_ARTIFACT.parentClass).toBe('SmartContract')
		expect(ORD_LOCK_V2_ARTIFACT.script.length / 2).toBe(472)
		expect(
			Utils.toHex(
				Hash.sha256(Utils.toArray(ORD_LOCK_V2_ARTIFACT.script, 'hex')),
			),
		).toBe('629c4c60d1ab45d087cae67eefecdad91dc453b58f1ba757a0363194ff05a8b7')
		expect(ORD_LOCK_V2_ARTIFACT.abi.methods.map((m) => m.name)).toEqual([
			'purchase',
			'cancel',
		])
		expect(
			ORD_LOCK_V2_ARTIFACT.abi.methods[0].params.map((p) => p.name),
		).toEqual(['txPreimage'])
		expect(
			ORD_LOCK_V2_ARTIFACT.abi.constructor.params.map((p) => p.name),
		).toEqual(['seller', 'payOutput'])
		expect(ORD_LOCK_V2_ARTIFACT.constructorSlots).toEqual([
			{ paramIndex: 1, byteOffset: 436 },
			{ paramIndex: 0, byteOffset: 468 },
		])
		expect(ORD_LOCK_V2_ARTIFACT.codeSeparatorIndex).toBe(6)
		expect(ORD_LOCK_V2_PREFIX.length / 2).toBe(436)
	})
})

describe('OrdLockV2 lock / decode', () => {
	it('lock() matches the harness vector byte-for-byte', () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		expect(lock.toHex()).toBe(VECTOR_HEX)
		expect(lock.toBinary().length).toBe(526)
	})

	it('decode() is the inverse of lock()', () => {
		const data = OrdLockV2.decode(Script.fromHex(VECTOR_HEX))
		expect(data).not.toBeNull()
		expect(data?.seller).toBe(sellerAddr)
		expect(data?.price).toBe(1000n)
		expect(data?.offset).toBe(0)
		expect(data?.end).toBe(526)
		expect(Utils.toHex(data?.payout ?? [])).toBe(
			`e80300000000000019${new P2PKH().lock(PAY_PKH).toHex()}`,
		)
		const payout = OrdLockV2.payoutOutput(Script.fromHex(VECTOR_HEX))
		expect(payout.satoshis).toBe(1000)
		expect(payout.lockingScript.toHex()).toBe(new P2PKH().lock(PAY_PKH).toHex())
	})

	it('decode() tolerates trailing data (MAP) after the contract', () => {
		const withMap = appendBytes(
			Script.fromHex(VECTOR_HEX),
			new Script()
				.writeOpCode(OP.OP_RETURN)
				.writeBin(Utils.toArray('hello', 'utf8')),
		)
		const data = OrdLockV2.decode(withMap)
		expect(data?.price).toBe(1000n)
		expect(data?.end).toBe(526)
		expect(OrdLockV2.isOrdLockV2(withMap)).toBe(true)
	})

	it('does not recognize v1 listings or corrupted v2 scripts', () => {
		const v1 = Script.fromHex(
			`${ORD_LOCK_PREFIX}14${Utils.toHex(SELLER_PKH)}22e80300000000000019${new P2PKH().lock(PAY_PKH).toHex()}${ORD_LOCK_SUFFIX}`,
		)
		expect(OrdLockV2.isOrdLockV2(v1)).toBe(false)
		expect(OrdLockV2.decode(v1)).toBeNull()

		const bytes = Utils.toArray(VECTOR_HEX, 'hex')
		bytes[bytes.length - 1] ^= 0xff // tail after the seller slot
		expect(OrdLockV2.decode(Script.fromBinary(bytes))).toBeNull()
		bytes[bytes.length - 1] ^= 0xff
		bytes[100] ^= 0x01 // inside the invariant prefix
		expect(OrdLockV2.decode(Script.fromBinary(bytes))).toBeNull()
	})

	it('accepts a large payout script (PUSHDATA1 slot)', () => {
		const big = new Array(200).fill(0xab)
		const payout = OrdLockV2.buildOutput(5, big)
		const lock = OrdLockV2.lockRaw(SELLER_PKH, payout)
		const data = OrdLockV2.decode(lock)
		expect(data?.price).toBe(5n)
		expect(data?.payout).toEqual(payout)
	})
})

describe('OrdLockV2 purchase', () => {
	it('builds <preimage> OP_0 with the payout at the listing index', async () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const { tx, plan } = await buildPurchase([lock], [p2pkhOut(buyerAddr, 1)])
		await tx.sign()

		// layout: 0 cushion · 1 payout · 2 receive · 3 change
		expect(plan.cushionVout).toBe(0)
		expect(plan.cushion).toBe(99_000)
		expect(plan.payoutVouts).toEqual([1])
		expect(plan.receiveVouts).toEqual([2])
		expect(tx.outputs[1].satoshis).toBe(1000)
		expect(tx.outputs[1].lockingScript.toHex()).toBe(
			new P2PKH().lock(PAY_PKH).toHex(),
		)

		const unlock = tx.inputs[1].unlockingScript as Script
		expect(unlock.chunks.length).toBe(2)
		expect(unlock.chunks[0].data?.length).toBeGreaterThan(156)
		expect(unlock.chunks[1].op).toBe(OP.OP_0)
		expect(OrdLockV2.isPurchase(unlock)).toBe(true)
		expect(OrdLockV2.isCancel(unlock)).toBe(false)

		// sighash byte at the end of the preimage: SINGLE|ANYONECANPAY|FORKID
		const preimage = unlock.chunks[0].data as number[]
		expect(preimage[preimage.length - 4]).toBe(
			TransactionSignature.SIGHASH_SINGLE |
				TransactionSignature.SIGHASH_ANYONECANPAY |
				TransactionSignature.SIGHASH_FORKID,
		)

		// the reservation is exact, and independent of the other outputs
		expect(OrdLockV2.estimatePurchaseUnlockLength(lock)).toBe(
			unlock.toBinary().length,
		)
		expect(OrdLockV2.ordinalOutput(tx, 1)).toBe(2)
		record('purchase-single', tx, { '1': 2 })
	})

	it('buys two listings in one transaction, one payout per listing index', async () => {
		const sellerB = new PrivateKey(2002)
		const lockA = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const lockB = OrdLockV2.lock(sellerB.toAddress(), sellerB.toAddress(), 2500)
		const { tx, plan } = await buildPurchase(
			[lockA, lockB],
			[p2pkhOut(buyerAddr, 1), p2pkhOut(buyerAddr, 1)],
		)
		await tx.sign()

		// inputs 0 front · 1 A · 2 B · 3 fee; outputs 0 cushion · 1 payA · 2 payB · 3 recvA · 4 recvB · 5 change
		expect(plan.payoutVouts).toEqual([1, 2])
		expect(plan.receiveVouts).toEqual([3, 4])
		expect(plan.cushion).toBe(96_500)
		expect(tx.outputs[1].satoshis).toBe(1000)
		expect(tx.outputs[2].satoshis).toBe(2500)
		expect(OrdLockV2.isPurchase(tx.inputs[1].unlockingScript as Script)).toBe(
			true,
		)
		expect(OrdLockV2.isPurchase(tx.inputs[2].unlockingScript as Script)).toBe(
			true,
		)
		expect(OrdLockV2.ordinalOutput(tx, 1)).toBe(3)
		expect(OrdLockV2.ordinalOutput(tx, 2)).toBe(4)
		record('purchase-batch', tx, { '1': 3, '2': 4 })
	})

	it('balances several front funding inputs with one cushion and OP_RETURN fillers', async () => {
		const lockA = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const lockB = OrdLockV2.lock(sellerAddr, payAddr, 1500)
		const { tx, plan } = await buildPurchase(
			[lockA, lockB],
			[p2pkhOut(buyerAddr, 1), p2pkhOut(buyerAddr, 1)],
			[6_000, 4_000],
		)
		await tx.sign()

		// inputs 0,1 front · 2 A · 3 B · 4 fee
		// outputs 0 cushion 7500 · 1 filler · 2 payA · 3 payB · 4 recvA · 5 recvB · 6 change
		expect(plan.cushionVout).toBe(0)
		expect(plan.fillerVouts).toEqual([1])
		expect(plan.cushion).toBe(7_500)
		expect(tx.outputs[1].satoshis).toBe(0)
		expect(tx.outputs[1].lockingScript.toHex()).toBe('006a')
		expect(plan.payoutVouts).toEqual([2, 3])
		expect(plan.receiveVouts).toEqual([4, 5])
		expect(OrdLockV2.ordinalOutput(tx, 2)).toBe(4)
		expect(OrdLockV2.ordinalOutput(tx, 3)).toBe(5)
		record('purchase-multi-front', tx, { '2': 4, '3': 5 })
	})

	it('uses fillers for every leading slot when front funding matches the payouts exactly', () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const plan = OrdLockV2.planPurchase({
			frontSatoshis: [600, 400],
			listings: [lock],
			receives: [p2pkhOut(buyerAddr, 1)],
			cushionScript: buyerLock,
		})
		expect(plan.cushion).toBe(0)
		expect(plan.cushionVout).toBe(-1)
		expect(plan.fillerVouts).toEqual([0, 1])
		expect(plan.payoutVouts).toEqual([2])
		expect(plan.receiveVouts).toEqual([3])
	})

	it('delivers into an arbitrary receive script (BSV-21 transfer)', async () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const tokenId = `${'ab'.repeat(32)}_0`
		const receive: TransactionOutput = {
			satoshis: 1,
			lockingScript: BSV21.transfer(tokenId, 42n).lock(buyerLock),
		}
		const { tx, plan } = await buildPurchase([lock], [receive])
		await tx.sign()
		expect(plan.receiveVouts).toEqual([2])
		expect(OrdLockV2.ordinalOutput(tx, 1)).toBe(2)
		expect(tx.outputs[2].lockingScript.toHex()).toBe(
			receive.lockingScript.toHex(),
		)
		record('purchase-bsv21', tx, { '1': 2 })
	})

	it('signs a listing that carries trailing MAP data', async () => {
		const lock = appendBytes(
			OrdLockV2.lock(sellerAddr, payAddr, 1000),
			new Script()
				.writeOpCode(OP.OP_RETURN)
				.writeBin(Utils.toArray('1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5', 'utf8'))
				.writeBin(Utils.toArray('SET', 'utf8'))
				.writeBin(Utils.toArray('app', 'utf8'))
				.writeBin(Utils.toArray('test', 'utf8')),
		)
		const { tx } = await buildPurchase([lock], [p2pkhOut(buyerAddr, 1)])
		await tx.sign()
		const unlock = tx.inputs[1].unlockingScript as Script
		expect(unlock.chunks.length).toBe(2)
		expect(OrdLockV2.estimatePurchaseUnlockLength(lock)).toBe(
			unlock.toBinary().length,
		)
		record('purchase-with-map', tx, { '1': 2 })
	})

	it('refuses to sign when the payout is not at the listing index', async () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const listing = listingTx([lock])
		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: p2pkhUnlock(),
		})
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 1,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(),
		})
		// ordinal-first layout of the withdrawn draft: payout is at 0, not 1
		tx.addOutput(OrdLockV2.payoutOutput(lock))
		tx.addOutput(p2pkhOut(buyerAddr, 1))
		tx.addOutput(p2pkhOut(buyerAddr, 98_000))
		await expect(tx.sign()).rejects.toThrow(
			/output 1 must be the listing payout/,
		)
	})

	it('refuses to sign when the listed sat would land in the payout', async () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const listing = listingTx([lock])
		const tx = new Transaction()
		// listing first: SIGHASH_SINGLE wants the payout at 0, but first-sat
		// ordering then sends the listed satoshi into that very payout.
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 1,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(),
		})
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: p2pkhUnlock(),
		})
		tx.addOutput(OrdLockV2.payoutOutput(lock))
		tx.addOutput(p2pkhOut(buyerAddr, 1))
		tx.addOutput(p2pkhOut(buyerAddr, 98_000))
		await expect(tx.sign()).rejects.toThrow(/carrying 1000 sats/)
	})

	it('refuses to sign when the receive output is not an approved delivery', async () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const other = new PrivateKey(5005).toAddress()
		// approved script says buyerAddr, transaction delivers to `other`
		const { tx } = await buildPurchase(
			[lock],
			[p2pkhOut(other, 1)],
			[100_000],
			{
				deliveries: [{ vout: 2, lockingScript: buyerLock }],
			},
		)
		await expect(tx.sign()).rejects.toThrow(/not an approved receive output/)

		// approved vout mismatch
		const { tx: tx2 } = await buildPurchase(
			[lock],
			[p2pkhOut(buyerAddr, 1)],
			[100_000],
			{
				deliveries: [{ vout: 3, lockingScript: buyerLock }],
			},
		)
		await expect(tx2.sign()).rejects.toThrow(/not an approved receive output/)
	})

	it('refuses to sign when the listed sat would be burned as fee', async () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const listing = listingTx([lock])
		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: p2pkhUnlock(),
		})
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 1,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(),
		})
		tx.addOutput(p2pkhOut(buyerAddr, 99_000))
		tx.addOutput(OrdLockV2.payoutOutput(lock))
		// no output after the payout: the listed sat has nowhere to go
		await expect(tx.sign()).rejects.toThrow(/not mapped to any output/)
	})

	it('planPurchase rejects under-funded and non-1-sat layouts', () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		expect(() =>
			OrdLockV2.planPurchase({
				frontSatoshis: [999],
				listings: [lock],
				receives: [p2pkhOut(buyerAddr, 1)],
				cushionScript: buyerLock,
			}),
		).toThrow(/does not cover payouts/)
		expect(() =>
			OrdLockV2.planPurchase({
				frontSatoshis: [5000],
				listings: [lock],
				receives: [p2pkhOut(buyerAddr, 2)],
				cushionScript: buyerLock,
			}),
		).toThrow(/exactly 1 satoshi/)
	})
})

describe('OrdLockV2 cancel', () => {
	it('cancelListing() pushes <marker> <sig> <pubkey> OP_1', async () => {
		const sellerKey = new PrivateKey(3003)
		const lock = OrdLockV2.lock(sellerKey.toAddress(), payAddr, 1000)
		const listing = listingTx([lock])
		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 1,
			unlockingScriptTemplate: OrdLockV2.cancelListing(sellerKey),
		})
		tx.addOutput(p2pkhOut(sellerKey.toAddress(), 1))
		await tx.sign()
		const unlock = tx.inputs[0].unlockingScript as Script
		expect(unlock.chunks.length).toBe(4)
		expect(Utils.toHex(unlock.chunks[0].data ?? [])).toBe(
			ORD_LOCK_V2_CANCEL_MARKER,
		)
		expect(unlock.chunks[2].data).toEqual(
			sellerKey.toPublicKey().encode(true) as number[],
		)
		expect(unlock.chunks[3].op).toBe(OP.OP_1)
		expect(OrdLockV2.isCancel(unlock)).toBe(true)
		expect(OrdLockV2.isPurchase(unlock)).toBe(false)
		expect(unlock.toBinary().length).toBeLessThanOrEqual(
			await OrdLockV2.cancelListing(sellerKey).estimateLength(tx, 0),
		)
		record('cancel-key', tx, {})
	})

	it('cancelWithWallet() signs with a BRC-100 derived key', async () => {
		const wallet = new ProtoWallet(new PrivateKey(4004))
		const protocolID = P1SAT_PROTOCOL
		const keyID = 'abc_0'
		const { publicKey } = await wallet.getPublicKey({
			protocolID,
			keyID,
			counterparty: 'self',
			forSelf: true,
		})
		const cancelAddr = PublicKey.fromString(publicKey).toAddress()
		const lock = OrdLockV2.lock(cancelAddr, payAddr, 1000)
		const listing = listingTx([lock])
		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 1,
			unlockingScriptTemplate: OrdLockV2.cancelWithWallet(
				wallet,
				protocolID,
				keyID,
			),
		})
		tx.addOutput(p2pkhOut(buyerAddr, 1))
		await tx.sign()
		const unlock = tx.inputs[0].unlockingScript as Script
		expect(OrdLockV2.isCancel(unlock)).toBe(true)
		expect(Utils.toHex(unlock.chunks[2].data ?? [])).toBe(publicKey)
		record('cancel-wallet', tx, {})
	})

	it('writes interpreter vectors when ORDLOCK_V2_VECTORS_OUT is set', () => {
		const out = process.env.ORDLOCK_V2_VECTORS_OUT
		if (!out) return
		writeFileSync(out, JSON.stringify(vectors, null, 1))
	})
})
