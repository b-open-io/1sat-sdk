import { describe, expect, it } from 'bun:test'
import { Sigma } from '@1sat/templates'
import {
	BigNumber,
	ECDSA,
	Hash,
	P2PKH,
	PrivateKey,
	Script,
	Utils,
} from '@bsv/sdk'
import { applySigma } from '../src/signing/sigma'
import type { OneSatContext } from '../src/types'

const { toArray, toHex } = Utils

const testKey = PrivateKey.fromRandom()
const testPubKey = testKey.toPublicKey()
const testAddress = testPubKey.toAddress()

function createMockContext(): OneSatContext {
	return {
		wallet: {
			createSignature: async (args: { hashToDirectlySign: number[] }) => {
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

const DUMMY_TXID = 'a'.repeat(64)

/** Compute input hash: SHA256 of outpoint (txid bytes + vout LE) */
function getInputHash(txid: string, vout: number): number[] {
	const txidBytes: number[] = []
	for (let i = 0; i < txid.length; i += 2) {
		txidBytes.push(Number.parseInt(txid.substring(i, i + 2), 16))
	}
	const voutLE = [
		vout & 0xff,
		(vout >> 8) & 0xff,
		(vout >> 16) & 0xff,
		(vout >> 24) & 0xff,
	]
	return Hash.sha256([...txidBytes, ...voutLE])
}

/** Compute data hash: SHA256 of the original locking script binary */
function getDataHash(lockingScript: Script): number[] {
	return Hash.sha256(lockingScript.toBinary())
}

/**
 * Compute the combined message hash the way applySigma does:
 * SHA256(inputHash || dataHash)
 *
 * Note: applySigma applies an extra SHA256 over the concatenated hashes,
 * matching the sigma-protocol library behavior. The templates Sigma.verifyWithHashes
 * simply concatenates its two arguments, so we pass the combined hash as
 * inputHash with an empty dataHash.
 */
function getCombinedHash(inputHash: number[], dataHash: number[]): number[] {
	const combined = new Uint8Array(inputHash.length + dataHash.length)
	combined.set(inputHash, 0)
	combined.set(dataHash, inputHash.length)
	return Hash.sha256(Array.from(combined))
}

describe('applySigma', () => {
	it('produces a verifiable SIGMA signature (P2PKH output)', async () => {
		const ctx = createMockContext()
		const lockingScript = new P2PKH().lock(testAddress)

		const inputOutpoint = { txid: DUMMY_TXID, vout: 0 }

		const signedScript = await applySigma(
			ctx,
			lockingScript,
			inputOutpoint,
			0,
			0,
		)

		// Decode the sigma from the signed script
		const sigmas = Sigma.decodeFromScript(signedScript)
		expect(sigmas.length).toBe(1)

		const sigma = sigmas[0]
		expect(sigma.data.algorithm).toBe('BSM')
		expect(sigma.data.address).toBe(testAddress)
		expect(sigma.data.vin).toBe(0)

		// Verify the signature using the combined hash approach
		const inputHash = getInputHash(inputOutpoint.txid, inputOutpoint.vout)
		const dataHash = getDataHash(lockingScript)
		const combinedHash = getCombinedHash(inputHash, dataHash)
		expect(sigma.verifyWithHashes(combinedHash, [])).toBe(true)
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

		// Decode and verify
		const sigmas = Sigma.decodeFromScript(signedScript)
		expect(sigmas.length).toBe(1)

		const inputHash = getInputHash(inputOutpoint.txid, inputOutpoint.vout)
		const dataHash = getDataHash(lockingScript)
		const combinedHash = getCombinedHash(inputHash, dataHash)
		expect(sigmas[0].verifyWithHashes(combinedHash, [])).toBe(true)
	})

	it('produces consistent signing results', async () => {
		const ctx = createMockContext()
		const lockingScript = new P2PKH().lock(testAddress)
		const inputOutpoint = { txid: DUMMY_TXID, vout: 0 }

		// Sign with our applySigma
		const ourScript = await applySigma(ctx, lockingScript, inputOutpoint)

		// Decode the sigma from the signed script
		const sigmas = Sigma.decodeFromScript(ourScript)
		expect(sigmas.length).toBe(1)

		const sigma = sigmas[0]
		expect(sigma.data.address).toBe(testAddress)
		expect(sigma.data.algorithm).toBe('BSM')
		expect(sigma.data.vin).toBe(0)

		// Verify signature
		const inputHash = getInputHash(inputOutpoint.txid, inputOutpoint.vout)
		const dataHash = getDataHash(lockingScript)
		const combinedHash = getCombinedHash(inputHash, dataHash)
		expect(sigma.verifyWithHashes(combinedHash, [])).toBe(true)
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

		// Decode the sigma from the signed script
		const sigmas = Sigma.decodeFromScript(signedScript)
		expect(sigmas.length).toBe(1)

		// The vin in SIGMA should equal targetVout (2)
		expect(sigmas[0].data.vin).toBe(targetVout)

		// Verify signature
		const inputHash = getInputHash(inputOutpoint.txid, inputOutpoint.vout)
		const dataHash = getDataHash(lockingScript)
		const combinedHash = getCombinedHash(inputHash, dataHash)
		expect(sigmas[0].verifyWithHashes(combinedHash, [])).toBe(true)
	})
})
