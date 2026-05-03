import { describe, expect, it } from 'bun:test'
import {
	BigNumber,
	type CreateSignatureArgs,
	ECDSA,
	type GetPublicKeyArgs,
	PrivateKey,
	type PrivateKey as PrivateKeyType,
	Spend,
	Transaction,
	UnlockingScript,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import P2MS from './multisig'

function compressedPubKeyHex(priv: PrivateKeyType): string {
	return Utils.toHex(priv.toPublicKey().encode(true) as number[])
}

function buildSpendTx(lockingScript: ReturnType<typeof P2MS.lock>): {
	sourceTxid: string
	spendTx: Transaction
} {
	const sourceTx = new Transaction()
	sourceTx.addOutput({ lockingScript, satoshis: 1 })
	const sourceTxid = sourceTx.id('hex')

	const spendTx = new Transaction()
	spendTx.addInput({
		sourceTransaction: sourceTx,
		sourceTXID: sourceTxid,
		sourceOutputIndex: 0,
		unlockingScript: new UnlockingScript(),
		sequence: 0xffffffff,
	})
	spendTx.addOutput({ lockingScript: new UnlockingScript(), satoshis: 1 })
	return { sourceTxid, spendTx }
}

function evaluate(
	lockingScript: ReturnType<typeof P2MS.lock>,
	unlockingScript: UnlockingScript,
	sourceTxid: string,
	spendTx: Transaction,
): boolean {
	spendTx.inputs[0].unlockingScript = unlockingScript
	const spendCheck = new Spend({
		sourceTXID: sourceTxid,
		sourceOutputIndex: 0,
		lockingScript,
		sourceSatoshis: 1,
		transactionVersion: spendTx.version,
		otherInputs: [],
		unlockingScript,
		inputSequence: 0xffffffff,
		inputIndex: 0,
		outputs: spendTx.outputs,
		lockTime: spendTx.lockTime,
	})
	try {
		return spendCheck.validate()
	} catch {
		return false
	}
}

/**
 * Minimal WalletInterface mock that signs with a wrapped PrivateKey,
 * ignoring protocolID/keyID/counterparty (this test isn't exercising
 * derivation — that's the consumer's concern). Returns the same key for
 * any derivation parameters.
 */
function mockWallet(privateKey: PrivateKeyType): WalletInterface {
	return {
		createSignature: async (args: CreateSignatureArgs) => {
			if (!args.hashToDirectlySign) {
				throw new Error('mockWallet: only hashToDirectlySign is supported')
			}
			const sig = ECDSA.sign(
				new BigNumber(args.hashToDirectlySign),
				privateKey,
				true, // forceLowS — Bitcoin script requires low-S sigs
			)
			return { signature: sig.toDER() as number[] }
		},
		getPublicKey: async (_args: GetPublicKeyArgs) => {
			return { publicKey: compressedPubKeyHex(privateKey) }
		},
	} as unknown as WalletInterface
}

describe('P2MS template', () => {
	const keyA = PrivateKey.fromRandom()
	const keyB = PrivateKey.fromRandom()
	const keyC = PrivateKey.fromRandom()
	const pkA = compressedPubKeyHex(keyA)
	const pkB = compressedPubKeyHex(keyB)
	const pkC = compressedPubKeyHex(keyC)

	describe('lock + decode round-trip', () => {
		it('1-of-1 round-trips', () => {
			const lock = P2MS.lock([pkA], 1)
			const decoded = P2MS.decode(lock)
			expect(decoded).not.toBeNull()
			expect(decoded?.pubKeys).toEqual([pkA])
			expect(decoded?.threshold).toBe(1)
			expect(decoded?.total).toBe(1)
			expect(P2MS.isP2MS(lock)).toBe(true)
		})

		it('2-of-3 round-trips and preserves pubkey order', () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 2)
			const decoded = P2MS.decode(lock)
			expect(decoded?.pubKeys).toEqual([pkA, pkB, pkC])
			expect(decoded?.threshold).toBe(2)
			expect(decoded?.total).toBe(3)
		})

		it('3-of-5 round-trips', () => {
			const extra1 = compressedPubKeyHex(PrivateKey.fromRandom())
			const extra2 = compressedPubKeyHex(PrivateKey.fromRandom())
			const lock = P2MS.lock([pkA, pkB, pkC, extra1, extra2], 3)
			const decoded = P2MS.decode(lock)
			expect(decoded?.pubKeys).toEqual([pkA, pkB, pkC, extra1, extra2])
			expect(decoded?.threshold).toBe(3)
			expect(decoded?.total).toBe(5)
		})
	})

	describe('isP2MS rejects non-matches', () => {
		it('returns false for an empty script', () => {
			expect(P2MS.isP2MS(new UnlockingScript())).toBe(false)
		})

		it('returns false for a script without OP_CHECKMULTISIG', () => {
			const lock = P2MS.lock([pkA, pkB], 2)
			lock.chunks.pop()
			expect(P2MS.isP2MS(lock)).toBe(false)
		})
	})

	describe('lock validation', () => {
		it('rejects threshold > total', () => {
			expect(() => P2MS.lock([pkA, pkB], 3)).toThrow()
		})

		it('rejects threshold < 1', () => {
			expect(() => P2MS.lock([pkA], 0)).toThrow()
		})

		it('rejects total > 16', () => {
			const seventeen = Array.from({ length: 17 }, () =>
				compressedPubKeyHex(PrivateKey.fromRandom()),
			)
			expect(() => P2MS.lock(seventeen, 2)).toThrow()
		})

		it('rejects non-33-byte pubkey', () => {
			expect(() => P2MS.lock(['00'], 1)).toThrow()
			const uncompressed = Utils.toHex(
				keyA.toPublicKey().encode(false) as number[],
			)
			expect(() => P2MS.lock([uncompressed], 1)).toThrow()
		})
	})

	describe('end-to-end interpreter validation (raw key)', () => {
		it('2-of-3 with portions from keys[0] and keys[1] validates', async () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 2)
			const { sourceTxid, spendTx } = buildSpendTx(lock)

			const portionA = await P2MS.unlockSingle(spendTx, 0, keyA)
			const portionB = await P2MS.unlockSingle(spendTx, 0, keyB)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, portionA)
			portions.set(pkB, portionB)

			const unlocker = P2MS.unlock(portions)
			const fullUnlock = await unlocker.sign(spendTx, 0)

			expect(evaluate(lock, fullUnlock, sourceTxid, spendTx)).toBe(true)
		})

		it('2-of-3 with portions from keys[0] and keys[2] validates', async () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 2)
			const { sourceTxid, spendTx } = buildSpendTx(lock)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, await P2MS.unlockSingle(spendTx, 0, keyA))
			portions.set(pkC, await P2MS.unlockSingle(spendTx, 0, keyC))

			const fullUnlock = await P2MS.unlock(portions).sign(spendTx, 0)
			expect(evaluate(lock, fullUnlock, sourceTxid, spendTx)).toBe(true)
		})

		it('2-of-3 with portions from keys[1] and keys[2] validates', async () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 2)
			const { sourceTxid, spendTx } = buildSpendTx(lock)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkB, await P2MS.unlockSingle(spendTx, 0, keyB))
			portions.set(pkC, await P2MS.unlockSingle(spendTx, 0, keyC))

			const fullUnlock = await P2MS.unlock(portions).sign(spendTx, 0)
			expect(evaluate(lock, fullUnlock, sourceTxid, spendTx)).toBe(true)
		})

		it('3-of-3 validates', async () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 3)
			const { sourceTxid, spendTx } = buildSpendTx(lock)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, await P2MS.unlockSingle(spendTx, 0, keyA))
			portions.set(pkB, await P2MS.unlockSingle(spendTx, 0, keyB))
			portions.set(pkC, await P2MS.unlockSingle(spendTx, 0, keyC))

			const fullUnlock = await P2MS.unlock(portions).sign(spendTx, 0)
			expect(evaluate(lock, fullUnlock, sourceTxid, spendTx)).toBe(true)
		})

		it('1-of-1 validates', async () => {
			const lock = P2MS.lock([pkA], 1)
			const { sourceTxid, spendTx } = buildSpendTx(lock)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, await P2MS.unlockSingle(spendTx, 0, keyA))

			const fullUnlock = await P2MS.unlock(portions).sign(spendTx, 0)
			expect(evaluate(lock, fullUnlock, sourceTxid, spendTx)).toBe(true)
		})

		it('extra portions in the map are ignored — first M in lock order are used', async () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 2)
			const { sourceTxid, spendTx } = buildSpendTx(lock)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, await P2MS.unlockSingle(spendTx, 0, keyA))
			portions.set(pkB, await P2MS.unlockSingle(spendTx, 0, keyB))
			portions.set(pkC, await P2MS.unlockSingle(spendTx, 0, keyC))

			const fullUnlock = await P2MS.unlock(portions).sign(spendTx, 0)
			expect(evaluate(lock, fullUnlock, sourceTxid, spendTx)).toBe(true)
		})
	})

	describe('end-to-end interpreter validation (wallet)', () => {
		it('unlockSingleWithWallet produces a portion that validates', async () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 2)
			const { sourceTxid, spendTx } = buildSpendTx(lock)

			const walletA = mockWallet(keyA)
			const walletB = mockWallet(keyB)

			const portionA = await P2MS.unlockSingleWithWallet(
				spendTx,
				0,
				walletA,
				[2, 'p2ms test'],
				'1',
			)
			const portionB = await P2MS.unlockSingleWithWallet(
				spendTx,
				0,
				walletB,
				[2, 'p2ms test'],
				'1',
			)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, portionA)
			portions.set(pkB, portionB)

			const fullUnlock = await P2MS.unlock(portions).sign(spendTx, 0)
			expect(evaluate(lock, fullUnlock, sourceTxid, spendTx)).toBe(true)
		})
	})

	describe('coordinator unlock failure modes', () => {
		it('throws when fewer than threshold portions are available', async () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 2)
			const { spendTx } = buildSpendTx(lock)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, await P2MS.unlockSingle(spendTx, 0, keyA))

			await expect(P2MS.unlock(portions).sign(spendTx, 0)).rejects.toThrow()
		})

		it('throws when the input locking script is not P2MS', async () => {
			// Build a lock + spend where the input's source output is NOT P2MS
			const lock = P2MS.lock([pkA], 1)
			const { spendTx } = buildSpendTx(lock)
			// Replace the source output's locking script with something else
			const sourceTx = spendTx.inputs[0].sourceTransaction
			if (!sourceTx) throw new Error('test setup: missing sourceTransaction')
			sourceTx.outputs[0].lockingScript = new UnlockingScript()

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, await P2MS.unlockSingle(spendTx, 0, keyA))

			await expect(P2MS.unlock(portions).sign(spendTx, 0)).rejects.toThrow()
		})

		it('estimateLength returns OP_0 byte plus M portion bytes', async () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 2)
			const { spendTx } = buildSpendTx(lock)

			const portionA = await P2MS.unlockSingle(spendTx, 0, keyA)
			const portionB = await P2MS.unlockSingle(spendTx, 0, keyB)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, portionA)
			portions.set(pkB, portionB)

			const len = await P2MS.unlock(portions).estimateLength(spendTx, 0)
			const expected =
				1 + portionA.toBinary().length + portionB.toBinary().length
			expect(len).toBe(expected)
		})
	})

	describe('failure cases', () => {
		it('a portion signed by a key not in the lock fails interpreter', async () => {
			const lock = P2MS.lock([pkA, pkB, pkC], 2)
			const { sourceTxid, spendTx } = buildSpendTx(lock)

			const wrongKey = PrivateKey.fromRandom()
			const wrongPk = compressedPubKeyHex(wrongKey)

			// Coordinator gets portions from A and the wrong key, but the lock
			// has no slot for wrongPk so coordinator can't place it. Test that
			// providing an "imposter" portion under pkB's slot fails the interpreter.
			const imposterPortion = await P2MS.unlockSingle(spendTx, 0, wrongKey)

			const portions = new Map<string, UnlockingScript>()
			portions.set(pkA, await P2MS.unlockSingle(spendTx, 0, keyA))
			portions.set(pkB, imposterPortion) // claims to be B but signed by wrongKey
			void wrongPk

			const fullUnlock = await P2MS.unlock(portions).sign(spendTx, 0)
			expect(evaluate(lock, fullUnlock, sourceTxid, spendTx)).toBe(false)
		})
	})
})
