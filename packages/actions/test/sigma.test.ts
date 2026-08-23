import { describe, expect, it } from 'bun:test'
import { Sigma } from '@1sat/templates'
import { BigNumber, ECDSA, OP, P2PKH, PrivateKey, Script } from '@bsv/sdk'
import {
	SIGMA_COMPACT_SIG_LEN,
	appendSigmaPlaceholder,
	sealSigma,
} from '../src/signing/sigma'
import type { OneSatContext } from '../src/types'

const testKey = PrivateKey.fromRandom()
const testPubKey = testKey.toPublicKey()
const testAddress = testPubKey.toAddress()
const dummyTxid = 'a'.repeat(64)

function createMockContext(): OneSatContext {
	return {
		wallet: {
			createSignature: async (args: { hashToDirectlySign: number[] }) => {
				const hash = new BigNumber(args.hashToDirectlySign)
				return { signature: ECDSA.sign(hash, testKey, true).toDER() }
			},
			getPublicKey: async () => ({ publicKey: testPubKey.toString() }),
			listOutputs: async () => ({ outputs: [{ tags: ['type:id', 'seq:1'] }] }),
		} as unknown as OneSatContext['wallet'],
		chain: 'main',
	}
}

function expectValidSigma(script: Script, inputVout = 0): void {
	const sigmas = Sigma.decodeFromScript(script)
	expect(sigmas).toHaveLength(1)
	expect(sigmas[0].data.address).toBe(testAddress)
	const inputHash = Sigma.computeInputHash(dummyTxid, 0, inputVout)
	const dataHash = Sigma.computeDataHash(script, 0)
	const messageHash = Sigma.computeMessageHash(inputHash, dataHash)
	expect(sigmas[0].verifyWithHashes(messageHash, [])).toBe(true)
}

describe('SIGMA placeholder and seal', () => {
	it('keeps the output size stable and produces a verifiable signature', async () => {
		const ctx = createMockContext()
		const base = new P2PKH().lock(testAddress)
		const placeholder = await appendSigmaPlaceholder(ctx, base)
		const before = Sigma.decodeFromScript(placeholder)[0]
		expect(before.data.signature).toEqual(
			new Array(SIGMA_COMPACT_SIG_LEN).fill(0),
		)

		const sealed = await sealSigma(
			ctx,
			placeholder,
			{ txid: dummyTxid, vout: 0 },
			0,
			0,
		)
		expect(sealed.toBinary()).toHaveLength(placeholder.toBinary().length)
		expectValidSigma(sealed)
	})

	it('uses a pipe separator when the base already contains OP_RETURN', async () => {
		const ctx = createMockContext()
		const base = new Script().writeOpCode(OP.OP_RETURN).writeBin([1, 2, 3])
		const sealed = await sealSigma(
			ctx,
			await appendSigmaPlaceholder(ctx, base),
			{ txid: dummyTxid, vout: 0 },
		)
		expect(
			sealed.chunks.filter((chunk) => chunk.op === OP.OP_RETURN),
		).toHaveLength(1)
		expectValidSigma(sealed)
	})

	it('uses targetVout as vin when refVin is -1', async () => {
		const ctx = createMockContext()
		const targetVout = 2
		const base = new P2PKH().lock(testAddress)
		const placeholder = await appendSigmaPlaceholder(ctx, base, targetVout)
		const sealed = await sealSigma(
			ctx,
			placeholder,
			{ txid: dummyTxid, vout: 0 },
			targetVout,
			-1,
		)
		expect(Sigma.decodeFromScript(sealed)[0].data.vin).toBe(targetVout)
		expectValidSigma(sealed)
	})
})
