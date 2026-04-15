import { describe, expect, it } from 'bun:test'
import {
	PrivateKey,
	Script,
	Transaction,
	type TransactionInput,
	type TransactionOutput,
	Utils,
} from '@bsv/sdk'
import Sigma, { SigmaAlgorithm } from './sigma'

const { toHex, toArray } = Utils

describe('Sigma Protocol', () => {
	const privateKey = PrivateKey.fromWif(
		'KzmFJcMXHufPNHixgHNwXBt3mHpErEUG6WFbmuQdy525DezYAi82',
	)
	const privateKey2 = PrivateKey.fromWif(
		'L1U5FS1PzJwCiFA43hahBUSLytqVoGjSymKSz5WJ92v8YQBBsGZ1',
	)

	const outputScriptAsm = `OP_0 OP_RETURN ${toHex(toArray('pushdata1'))} ${toHex(toArray('pushdata2'))}`
	const script = Script.fromASM(outputScriptAsm)
	const txOut = { satoshis: 0, lockingScript: script } as TransactionOutput

	it('signs and verifies a transaction', () => {
		const tx = new Transaction(1, [], [txOut])
		const { signedTx } = Sigma.signTransaction(tx, privateKey)
		expect(Sigma.verifyTransaction(signedTx)).toBe(true)
	})

	it('mutates the output script', () => {
		const tx = new Transaction(1, [], [txOut])
		const asmBefore = tx.outputs[0].lockingScript.toASM()
		const { signedTx } = Sigma.signTransaction(tx, privateKey)
		expect(signedTx.outputs[0].lockingScript.toASM()).not.toBe(asmBefore)
	})

	it('hashes are stable after signing', () => {
		const tx = new Transaction(1, [], [txOut])
		const inputHash = toHex(Sigma.computeInputHash(tx, 0))
		const dataHash = toHex(Sigma.computeDataHash(tx.outputs[0].lockingScript))

		const { signedTx } = Sigma.signTransaction(tx, privateKey)

		const inputHash2 = toHex(Sigma.computeInputHash(signedTx, 0))
		const dataHash2 = toHex(
			Sigma.computeDataHash(signedTx.outputs[0].lockingScript),
		)

		expect(inputHash2).toBe(inputHash)
		expect(dataHash2).toBe(dataHash)
		expect(Sigma.countInstances(signedTx.outputs[0].lockingScript)).toBe(1)
	})

	it('input hash changes when inputs are added', () => {
		const tx = new Transaction(1, [], [txOut])
		const hashBefore = toHex(Sigma.computeInputHash(tx, 0))

		tx.addInput({
			sourceTXID:
				'810755d937913d4228e1a4d192046d96c0642e2678d6a90e1cb794b0c2aeb78c',
			sourceOutputIndex: 0,
			sequence: 0xffffffff,
		} as TransactionInput)

		const hashAfter = toHex(Sigma.computeInputHash(tx, 0))
		expect(hashAfter).not.toBe(hashBefore)

		const { signedTx } = Sigma.signTransaction(tx, privateKey)
		expect(Sigma.verifyTransaction(signedTx)).toBe(true)
	})

	it('targets a specific input via refVin', () => {
		const tx = new Transaction(1, [], [txOut])
		tx.addInput({
			sourceTXID:
				'810755d937913d4228e1a4d192046d96c0642e2678d6a90e1cb794b0c2aeb78b',
			sourceOutputIndex: 0,
			sequence: 0xffffffff,
		} as TransactionInput)
		tx.addInput({
			sourceTXID:
				'810755d937913d4228e1a4d192046d96c0642e2678d6a90e1cb794b0c2aeb78c',
			sourceOutputIndex: 0,
			sequence: 0xffffffff,
		} as TransactionInput)

		const { signedTx } = Sigma.signTransaction(tx, privateKey, { refVin: 1 })
		expect(Sigma.verifyTransaction(signedTx)).toBe(true)
	})

	it('supports user + platform signatures on the same output', () => {
		const tx = new Transaction(1, [], [txOut])

		const { signedTx } = Sigma.signTransaction(tx, privateKey)
		expect(Sigma.verifyTransaction(signedTx)).toBe(true)

		const { signedTx: signedTx2 } = Sigma.signTransaction(
			signedTx,
			privateKey2,
			{ sigmaInstance: 1 },
		)
		expect(Sigma.countInstances(signedTx2.outputs[0].lockingScript)).toBe(2)

		expect(Sigma.verifyTransaction(signedTx2, 0, 0)).toBe(true)
		expect(Sigma.verifyTransaction(signedTx2, 0, 1)).toBe(true)

		const sigs = Sigma.parseFromScript(signedTx2.outputs[0].lockingScript)
		expect(sigs[0].address).toBe('1ACLHVPVnB8AmLCyD5hPQtPCSCccjiUn7H')
		expect(sigs[1].address).toBe('1Cz3gyTgV7QgMoU6j51pvHdzeeapXfXDtA')
	})

	it('verifies a real transaction from js-1sat-ord', () => {
		const tx = Transaction.fromHex(
			'0100000001d70d11131d80dcee954926de96d793585c6bc0ed69619a6cc761a20cef1b1bd7010000006a4730440220466ca5d42bd7a8bd2b6ea5770970b03a0c39fa29847f31e0d949dd36bf523b910220379d1c2718ae3300e833201b227ed8159c93f85bcc6eaea4028dafed2559fee24121036232d22ae556320f5a6516e6e75eab89b33760ccf7b3eb5b791a23883da6b1f5ffffffff020100000000000000a776a914c8fcb96f2f16175d37d602c438eb2f64e59e217788ac0063036f7264510a746578742f706c61696e000774657374696e67686a055349474d410342534d22314535533931716e6f4743586d36314d5931617842435a436d4d50414d5a3675457a41206798f75d8b2bc6b6f2b536a9702dac3533528574d6f46acd8e2747ba63a0e70e146adba068c93e2979d010baf9aa47a1daf501381620adc59a09e10508aff46e013015e16005000000001976a9148d3164e5ed6f5ae76d7cb3860b31af4f369e775d88ac00000000',
		)
		expect(Sigma.verifyTransaction(tx)).toBe(true)
	})

	it('signs and verifies with BRC-77', () => {
		const tx = new Transaction(1, [], [txOut])
		const { signedTx } = Sigma.signTransaction(tx, privateKey, {
			algorithm: SigmaAlgorithm.BRC77,
		})
		expect(Sigma.verifyTransaction(signedTx)).toBe(true)

		const sigs = Sigma.parseFromScript(signedTx.outputs[0].lockingScript)
		expect(sigs[0].algorithm).toBe(SigmaAlgorithm.BRC77)
	})

	it('BRC-77 survives parse roundtrip', () => {
		const tx = new Transaction(1, [], [txOut])
		const { signedTx } = Sigma.signTransaction(tx, privateKey, {
			algorithm: SigmaAlgorithm.BRC77,
		})

		const sigs = Sigma.parseFromScript(signedTx.outputs[0].lockingScript)
		expect(sigs[0].algorithm).toBe(SigmaAlgorithm.BRC77)
		expect(Sigma.countInstances(signedTx.outputs[0].lockingScript)).toBe(1)
		expect(Sigma.verifyTransaction(signedTx)).toBe(true)
	})

	it('supports mixed BSM + BRC-77 on same output', () => {
		const tx = new Transaction(1, [], [txOut])

		const { signedTx } = Sigma.signTransaction(tx, privateKey, {
			algorithm: SigmaAlgorithm.BSM,
		})
		expect(Sigma.verifyTransaction(signedTx)).toBe(true)

		const { signedTx: signedTx2 } = Sigma.signTransaction(
			signedTx,
			privateKey2,
			{
				sigmaInstance: 1,
				algorithm: SigmaAlgorithm.BRC77,
			},
		)

		expect(Sigma.countInstances(signedTx2.outputs[0].lockingScript)).toBe(2)

		const sigs = Sigma.parseFromScript(signedTx2.outputs[0].lockingScript)
		expect(sigs[0].algorithm).toBe(SigmaAlgorithm.BSM)
		expect(sigs[1].algorithm).toBe(SigmaAlgorithm.BRC77)

		expect(Sigma.verifyTransaction(signedTx2, 0, 0)).toBe(true)
		expect(Sigma.verifyTransaction(signedTx2, 0, 1)).toBe(true)
	})

	it('decodes from script (BitCom integration)', () => {
		const tx = Transaction.fromHex(
			'0100000001d70d11131d80dcee954926de96d793585c6bc0ed69619a6cc761a20cef1b1bd7010000006a4730440220466ca5d42bd7a8bd2b6ea5770970b03a0c39fa29847f31e0d949dd36bf523b910220379d1c2718ae3300e833201b227ed8159c93f85bcc6eaea4028dafed2559fee24121036232d22ae556320f5a6516e6e75eab89b33760ccf7b3eb5b791a23883da6b1f5ffffffff020100000000000000a776a914c8fcb96f2f16175d37d602c438eb2f64e59e217788ac0063036f7264510a746578742f706c61696e000774657374696e67686a055349474d410342534d22314535533931716e6f4743586d36314d5931617842435a436d4d50414d5a3675457a41206798f75d8b2bc6b6f2b536a9702dac3533528574d6f46acd8e2747ba63a0e70e146adba068c93e2979d010baf9aa47a1daf501381620adc59a09e10508aff46e013015e16005000000001976a9148d3164e5ed6f5ae76d7cb3860b31af4f369e775d88ac00000000',
		)
		const sigmas = Sigma.decodeFromScript(tx.outputs[0].lockingScript)
		expect(sigmas.length).toBeGreaterThan(0)
		expect(sigmas[0].data.algorithm).toBe(SigmaAlgorithm.BSM)
		expect(sigmas[0].data.address).toBeTruthy()
	})

	it('data-container mode works', () => {
		const sigma = new Sigma({
			algorithm: SigmaAlgorithm.BSM,
			address: '1ACLHVPVnB8AmLCyD5hPQtPCSCccjiUn7H',
			signature: [1, 2, 3],
			vin: 0,
			valid: true,
		})
		expect(sigma.data.address).toBe('1ACLHVPVnB8AmLCyD5hPQtPCSCccjiUn7H')
		expect(sigma.verify()).toBe(true)
	})
})
