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
	Utils,
} from '@bsv/sdk'
import OrdLockV2 from './ordlockV2.js'

// Canonical v2 listing produced by the Go harness (ordlock-v2/harness
// gen_vector_test.go): seller PKH = 0x11 x20, payout = 1000 sats to P2PKH
// 0x22 x20. Byte-for-byte oracle for lock().
const VECTOR_HEX =
	'76009c637576ab76aa517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e8100011f80517e9321414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff007d97785296789f527952798d9495937776927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f76927f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e827c7e23022079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798027c7e827c7e01307c7e01c17e2102b405d7f0322a89d0f9f3a98e6f938fdc1c969a8d1382a2bf66a71ae74a1e83b0ad690c000000000000000027006a247801447f7701247f757e537a22e8030000000000001976a914222222222222222222222222222222222222222288ac7e7c7e7b7eaa7c820128947f7701207f758767519d7b0a6f6c323a63616e63656c8876a914111111111111111111111111111111111111111188ac68'
const SELLER_PKH = new Array(20).fill(0x11)
const PAY_PKH = new Array(20).fill(0x22)
const sellerAddr = Utils.toBase58Check(SELLER_PKH, [0])
const payAddr = Utils.toBase58Check(PAY_PKH, [0])

const buyerKey = new PrivateKey(1001)
const buyerAddr = buyerKey.toAddress()

type Source = { txid: string; vout: number; satoshis: number; script: string }
type Vector = { name: string; sources: Source[]; tx: string }
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

function record(name: string, tx: Transaction) {
	vectors.push({ name, sources: sourcesOf(tx), tx: tx.toHex() })
}

/** A tx holding one funding output for the buyer plus the given listings. */
function listingTx(locks: Script[], fund = 100_000): Transaction {
	const tx = new Transaction()
	tx.addOutput({
		satoshis: fund,
		lockingScript: new P2PKH().lock(buyerAddr),
	})
	for (const lock of locks) {
		tx.addOutput({ satoshis: 1, lockingScript: lock as LockingScript })
	}
	return tx
}

/** Appends raw bytes to a script by re-parsing the concatenation. */
function appendBytes(script: Script, extra: Script): Script {
	return Script.fromBinary([...script.toBinary(), ...extra.toBinary()])
}

function p2pkhOut(addr: string, satoshis: number): TransactionOutput {
	return { satoshis, lockingScript: new P2PKH().lock(addr) }
}

describe('OrdLockV2 artifact', () => {
	it('is the frozen b3f08f2 build of OrdLockV2Batch', () => {
		// Any recompile must change this test on purpose.
		expect(ORD_LOCK_V2_ARTIFACT.contractName).toBe('OrdLockV2Batch')
		expect(ORD_LOCK_V2_ARTIFACT.parentClass).toBe('SmartContract')
		expect(ORD_LOCK_V2_ARTIFACT.script.length / 2).toBe(502)
		expect(
			Utils.toHex(
				Hash.sha256(Utils.toArray(ORD_LOCK_V2_ARTIFACT.script, 'hex')),
			),
		).toBe('0b9b70693e734fe6201d81dc6e36affe02303c89713c5172a16651da1db0da45')
		expect(ORD_LOCK_V2_ARTIFACT.abi.methods.map((m) => m.name)).toEqual([
			'purchase',
			'cancel',
		])
		expect(
			ORD_LOCK_V2_ARTIFACT.abi.constructor.params.map((p) => p.name),
		).toEqual(['seller', 'payOutput'])
		expect(ORD_LOCK_V2_ARTIFACT.constructorSlots).toEqual([
			{ paramIndex: 1, byteOffset: 461 },
			{ paramIndex: 0, byteOffset: 498 },
		])
		expect(ORD_LOCK_V2_ARTIFACT.codeSeparatorIndex).toBe(6)
		expect(ORD_LOCK_V2_PREFIX.length / 2).toBe(461)
	})
})

describe('OrdLockV2 lock / decode', () => {
	it('lock() matches the harness vector byte-for-byte', () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		expect(lock.toHex()).toBe(VECTOR_HEX)
		expect(lock.toBinary().length).toBe(556)
	})

	it('decode() is the inverse of lock()', () => {
		const data = OrdLockV2.decode(Script.fromHex(VECTOR_HEX))
		expect(data).not.toBeNull()
		expect(data?.seller).toBe(sellerAddr)
		expect(data?.price).toBe(1000n)
		expect(data?.offset).toBe(0)
		expect(data?.end).toBe(556)
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
		expect(data?.end).toBe(556)
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
	it('builds <prefix> <suffix> <preimage> OP_0 for a single listing', async () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const listing = listingTx([lock])
		const listingId = listing.id('hex')

		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 1,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(),
		})
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: new P2PKH().unlock(buyerKey),
		})
		tx.addOutput(p2pkhOut(buyerAddr, 1))
		tx.addOutput(OrdLockV2.payoutOutput(lock))
		tx.addOutput(OrdLockV2.tagOutput(listingId, 1))
		tx.addOutput(p2pkhOut(buyerAddr, 98_000))
		await tx.sign()

		const unlock = tx.inputs[0].unlockingScript as Script
		expect(unlock.chunks.length).toBe(4)
		expect(Utils.toHex(unlock.chunks[0].data ?? [])).toBe(
			Utils.toHex(
				OrdLockV2.buildOutput(1, new P2PKH().lock(buyerAddr).toBinary()),
			),
		)
		expect(Utils.toHex(unlock.chunks[1].data ?? [])).toBe(
			Utils.toHex(
				OrdLockV2.buildOutput(98_000, new P2PKH().lock(buyerAddr).toBinary()),
			),
		)
		expect(unlock.chunks[2].data?.length).toBeGreaterThan(156)
		expect(unlock.chunks[3].op).toBe(OP.OP_0)
		expect(OrdLockV2.isPurchase(unlock)).toBe(true)
		expect(OrdLockV2.isCancel(unlock)).toBe(false)

		// tag output shape: 0 sats, OP_FALSE OP_RETURN <36-byte outpoint>
		const tag = tx.outputs[2]
		expect(tag.satoshis).toBe(0)
		expect(tag.lockingScript.toHex()).toBe(
			`006a24${Utils.toHex(Utils.toArray(listingId, 'hex').reverse())}01000000`,
		)
		record('purchase-single', tx)

		// Reservation made before change is known must bound the real script.
		const known = [tx.outputs[0], tx.outputs[3]]
			.map(
				(o) =>
					OrdLockV2.buildOutput(o.satoshis ?? 0, o.lockingScript.toBinary())
						.length,
			)
			.reduce((a, b) => a + b, 0)
		const estimate = OrdLockV2.estimatePurchaseUnlockLength(lock, known)
		expect(estimate).toBeGreaterThanOrEqual(unlock.toBinary().length)
		expect(estimate).toBeLessThan(unlock.toBinary().length + 700)
	})

	it('finds its own payout+tag pair anywhere in a batch purchase', async () => {
		const sellerB = new PrivateKey(2002)
		const lockA = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const lockB = OrdLockV2.lock(sellerB.toAddress(), sellerB.toAddress(), 2500)
		const listing = listingTx([lockA, lockB])
		const id = listing.id('hex')

		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 1,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(),
		})
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 2,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(),
		})
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: new P2PKH().unlock(buyerKey),
		})
		// ordinals first, then the two pairs, then change
		tx.addOutput(p2pkhOut(buyerAddr, 1))
		tx.addOutput(p2pkhOut(buyerAddr, 1))
		tx.addOutput(OrdLockV2.payoutOutput(lockA))
		tx.addOutput(OrdLockV2.tagOutput(id, 1))
		tx.addOutput(OrdLockV2.payoutOutput(lockB))
		tx.addOutput(OrdLockV2.tagOutput(id, 2))
		tx.addOutput(p2pkhOut(buyerAddr, 90_000))
		await tx.sign()

		const ua = tx.inputs[0].unlockingScript as Script
		const ub = tx.inputs[1].unlockingScript as Script
		const ser = tx.outputs.map((o) =>
			OrdLockV2.buildOutput(o.satoshis ?? 0, o.lockingScript.toBinary()),
		)
		expect(ua.chunks[0].data).toEqual([...ser[0], ...ser[1]])
		expect(ua.chunks[1].data).toEqual([...ser[4], ...ser[5], ...ser[6]])
		expect(ub.chunks[0].data).toEqual([
			...ser[0],
			...ser[1],
			...ser[2],
			...ser[3],
		])
		expect(ub.chunks[1].data).toEqual(ser[6])
		record('purchase-batch', tx)
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
		const listing = listingTx([lock])
		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 1,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(),
		})
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: new P2PKH().unlock(buyerKey),
		})
		tx.addOutput(p2pkhOut(buyerAddr, 1))
		tx.addOutput(OrdLockV2.payoutOutput(lock))
		tx.addOutput(OrdLockV2.tagOutput(listing.id('hex'), 1))
		tx.addOutput(p2pkhOut(buyerAddr, 98_000))
		await tx.sign()
		expect((tx.inputs[0].unlockingScript as Script).chunks.length).toBe(4)
		record('purchase-with-map', tx)
	})

	it('refuses to sign when the payout+tag pair is missing', async () => {
		const lock = OrdLockV2.lock(sellerAddr, payAddr, 1000)
		const listing = listingTx([lock])
		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 1,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(),
		})
		tx.addOutput(p2pkhOut(buyerAddr, 1))
		tx.addOutput(OrdLockV2.payoutOutput(lock))
		// wrong vout in the tag
		tx.addOutput(OrdLockV2.tagOutput(listing.id('hex'), 0))
		await expect(tx.sign()).rejects.toThrow(/payout immediately followed/)
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
		record('cancel-key', tx)
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
		record('cancel-wallet', tx)
	})

	it('writes interpreter vectors when ORDLOCK_V2_VECTORS_OUT is set', () => {
		const out = process.env.ORDLOCK_V2_VECTORS_OUT
		if (!out) return
		writeFileSync(out, JSON.stringify(vectors, null, 1))
	})
})
