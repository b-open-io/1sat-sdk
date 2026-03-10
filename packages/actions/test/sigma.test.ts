import { describe, expect, it } from 'bun:test'
import {
	BSM,
	BigNumber,
	ECDSA,
	P2PKH,
	PrivateKey,
	PublicKey,
	Script,
	Signature,
	Transaction,
	Utils,
} from '@bsv/sdk'
import { Sigma } from 'sigma-protocol'
import { applySigma } from '../src/signing/sigma'
import type { OneSatContext } from '../src/types'

const { toArray, toHex } = Utils

const testKey = PrivateKey.fromRandom()
const testPubKey = testKey.toPublicKey()
const testAddress = testPubKey.toAddress()

function createMockContext(): OneSatContext {
	return {
		wallet: {
			createSignature: async (args: {
				hashToDirectlySign: number[]
			}) => {
				const hash = new BigNumber(args.hashToDirectlySign)
				const sig = ECDSA.sign(hash, testKey, true)
				return { signature: sig.toDER() }
			},
			getPublicKey: async () => ({
				publicKey: testPubKey.toString(),
			}),
		} as unknown as OneSatContext['wallet'],
		chain: 'main' as const,
	}
}

const DUMMY_TXID =
	'a'.repeat(64)

describe('applySigma', () => {
	it('produces a signature verifiable by sigma-protocol (P2PKH output)', async () => {
		const ctx = createMockContext()
		const lockingScript = new P2PKH().lock(testAddress)

		const inputOutpoint = { txid: DUMMY_TXID, vout: 0 }
		const targetVout = 0
		const refVin = 0

		const signedScript = await applySigma(
			ctx,
			lockingScript,
			inputOutpoint,
			targetVout,
			refVin,
		)

		// Build a transaction that sigma-protocol can verify
		const tx = new Transaction()
		tx.addInput({
			sourceTXID: inputOutpoint.txid,
			sourceOutputIndex: inputOutpoint.vout,
			unlockingScript: new Script(),
		})
		tx.addOutput({
			satoshis: 1,
			lockingScript: signedScript,
		})

		const sigma = new Sigma(tx, targetVout, 0, refVin)
		expect(sigma.verify()).toBe(true)
	})

	it('uses pipe separator when script already contains OP_RETURN', async () => {
		const ctx = createMockContext()

		// Inscription-like script with OP_RETURN in it
		const inscriptionAsm = `OP_0 OP_RETURN ${toHex(toArray('ord'))} OP_1 ${toHex(toArray('text/plain'))} OP_0 ${toHex(toArray('hello world'))}`
		const lockingScript = Script.fromASM(inscriptionAsm)

		const inputOutpoint = { txid: DUMMY_TXID, vout: 0 }
		const signedScript = await applySigma(ctx, lockingScript, inputOutpoint)

		// The signed script ASM should use pipe (7c) separator, not a second OP_RETURN
		const asm = signedScript.toASM()
		const parts = asm.split(' ')

		// Count OP_RETURN occurrences — should still be exactly 1
		const opReturnCount = parts.filter((p) => p === 'OP_RETURN').length
		expect(opReturnCount).toBe(1)

		// Should contain a pipe separator before SIGMA
		const sigmaIdx = parts.indexOf('5349474d41')
		expect(sigmaIdx).toBeGreaterThan(0)
		expect(parts[sigmaIdx - 1]).toBe('7c')

		// Verify with sigma-protocol
		const tx = new Transaction()
		tx.addInput({
			sourceTXID: inputOutpoint.txid,
			sourceOutputIndex: inputOutpoint.vout,
			unlockingScript: new Script(),
		})
		tx.addOutput({ satoshis: 1, lockingScript: signedScript })

		const sigma = new Sigma(tx, 0, 0, 0)
		expect(sigma.verify()).toBe(true)
	})

	it('produces equivalent results to sigma-protocol direct signing', async () => {
		const ctx = createMockContext()
		const lockingScript = new P2PKH().lock(testAddress)
		const inputOutpoint = { txid: DUMMY_TXID, vout: 0 }

		// Sign with our applySigma
		const ourScript = await applySigma(ctx, lockingScript, inputOutpoint)

		// Sign with sigma-protocol directly using the same key
		const directTx = new Transaction()
		directTx.addInput({
			sourceTXID: inputOutpoint.txid,
			sourceOutputIndex: inputOutpoint.vout,
			unlockingScript: new Script(),
		})
		directTx.addOutput({ satoshis: 1, lockingScript })

		const directSigma = new Sigma(directTx, 0, 0, 0)
		const directResult = directSigma.sign(testKey)

		// Both should have the same address
		const ourTx = new Transaction()
		ourTx.addInput({
			sourceTXID: inputOutpoint.txid,
			sourceOutputIndex: inputOutpoint.vout,
			unlockingScript: new Script(),
		})
		ourTx.addOutput({ satoshis: 1, lockingScript: ourScript })

		const ourSigma = new Sigma(ourTx, 0, 0, 0)
		expect(ourSigma.sig?.address).toBe(directResult.address)
		expect(ourSigma.sig?.algorithm).toBe('BSM')
		expect(ourSigma.sig?.vin).toBe(0)

		// Both should verify
		expect(ourSigma.verify()).toBe(true)

		const directVerifySigma = new Sigma(directResult.signedTx, 0, 0, 0)
		expect(directVerifySigma.verify()).toBe(true)
	})

	it('handles refVin=-1 by using targetVout as vin', async () => {
		const ctx = createMockContext()
		const lockingScript = new P2PKH().lock(testAddress)
		const inputOutpoint = { txid: DUMMY_TXID, vout: 0 }
		const targetVout = 2

		const signedScript = await applySigma(
			ctx,
			lockingScript,
			inputOutpoint,
			targetVout,
			-1, // refVin = -1
		)

		// Build tx: input at index 2 must match the outpoint we signed over
		const tx = new Transaction()
		for (let i = 0; i <= targetVout; i++) {
			tx.addInput({
				sourceTXID: inputOutpoint.txid,
				sourceOutputIndex: inputOutpoint.vout,
				unlockingScript: new Script(),
			})
		}
		for (let i = 0; i < targetVout; i++) {
			tx.addOutput({ satoshis: 1, lockingScript: new P2PKH().lock(testAddress) })
		}
		tx.addOutput({ satoshis: 1, lockingScript: signedScript })

		// The vin in SIGMA should equal targetVout (2)
		const sigma = new Sigma(tx, targetVout, 0, -1)
		expect(sigma.sig?.vin).toBe(targetVout)
		expect(sigma.verify()).toBe(true)
	})
})
