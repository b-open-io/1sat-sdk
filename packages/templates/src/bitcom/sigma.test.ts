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

	it('signs and verifies a message correctly', () => {
		const tx = new Transaction(1, [], [txOut])
		const sigma = new Sigma(tx, 0, 0)
		sigma.sign(privateKey)
		expect(sigma.verify()).toBe(true)
	})

	it('generates a correct output script', () => {
		const tx = new Transaction(1, [], [txOut])
		const sigma = new Sigma(tx, 0, 0)
		const asm = tx.outputs[0]?.lockingScript.toASM()
		const { signedTx } = sigma.sign(privateKey)
		const asmAfter = signedTx.outputs[0]?.lockingScript.toASM()
		expect(asmAfter).not.toBe(asm)
	})

	it('signed tx is verified', () => {
		const tx = new Transaction(1, [], [txOut])
		const sigma = new Sigma(tx, 0, 0)
		const { signedTx } = sigma.sign(privateKey)

		const inputHash = toHex(sigma.getInputHash())
		const dataHash = toHex(sigma.getDataHash())
		const messageHash = toHex(sigma.getMessageHash())

		const sigma2 = new Sigma(signedTx)

		expect(toHex(sigma2.getInputHash())).toBe(inputHash)
		expect(toHex(sigma2.getDataHash())).toBe(dataHash)
		expect(toHex(sigma2.getMessageHash())).toBe(messageHash)
		expect(sigma2.getSigInstanceCount()).toBe(1)
		expect(sigma2.verify()).toBe(true)
	})

	it('replace a dummy signature with a real one', () => {
		const tx = new Transaction(1, [], [txOut])
		const sigma = new Sigma(tx, 0, 0)

		const inputHash = toHex(sigma.getInputHash())

		const txIn = {
			sourceTXID:
				'810755d937913d4228e1a4d192046d96c0642e2678d6a90e1cb794b0c2aeb78c',
			sourceOutputIndex: 0,
			sequence: 0xffffffff,
		} as TransactionInput

		tx.addInput(txIn)

		// input hash should change after adding inputs
		expect(toHex(sigma.getInputHash())).not.toBe(inputHash)

		// sign now that inputs have been added
		sigma.sign(privateKey)

		// verify the signature is valid with the real input
		expect(sigma.verify()).toBe(true)
		expect(sigma.getSigInstanceCount()).toBe(1)
	})

	it('specify an input to sign', () => {
		const tx = new Transaction(1, [], [txOut])
		const txIn = {
			sourceTXID:
				'810755d937913d4228e1a4d192046d96c0642e2678d6a90e1cb794b0c2aeb78b',
			sourceOutputIndex: 0,
			sequence: 0xffffffff,
		} as TransactionInput
		const txIn2 = {
			sourceTXID:
				'810755d937913d4228e1a4d192046d96c0642e2678d6a90e1cb794b0c2aeb78c',
			sourceOutputIndex: 0,
			sequence: 0xffffffff,
		} as TransactionInput

		tx.addInput(txIn)
		tx.addInput(txIn2)

		const sigma = new Sigma(tx, 0, 0, 1)
		sigma.sign(privateKey)
		expect(sigma.verify()).toBe(true)
	})

	it('create a user and platform signature on the same output', () => {
		const tx = new Transaction(1, [], [txOut])
		const sigma = new Sigma(tx, 0, 0)

		const { signedTx } = sigma.sign(privateKey)
		expect(sigma.verify()).toBe(true)

		const sigma2 = new Sigma(signedTx, 0, 1)
		sigma2.sign(privateKey2)
		expect(sigma2.verify()).toBe(true)
		expect(sigma2.getSigInstanceCount()).toBe(2)

		sigma2.setSigmaInstance(0)
		expect(sigma2.sig?.address).toBe('1ACLHVPVnB8AmLCyD5hPQtPCSCccjiUn7H')

		sigma2.setSigmaInstance(1)
		expect(sigma2.sig?.address).toBe('1Cz3gyTgV7QgMoU6j51pvHdzeeapXfXDtA')
	})

	it('validate sig from bundled 1sat lib', () => {
		const tx = Transaction.fromHex(
			'0100000001d70d11131d80dcee954926de96d793585c6bc0ed69619a6cc761a20cef1b1bd7010000006a4730440220466ca5d42bd7a8bd2b6ea5770970b03a0c39fa29847f31e0d949dd36bf523b910220379d1c2718ae3300e833201b227ed8159c93f85bcc6eaea4028dafed2559fee24121036232d22ae556320f5a6516e6e75eab89b33760ccf7b3eb5b791a23883da6b1f5ffffffff020100000000000000a776a914c8fcb96f2f16175d37d602c438eb2f64e59e217788ac0063036f7264510a746578742f706c61696e000774657374696e67686a055349474d410342534d22314535533931716e6f4743586d36314d5931617842435a436d4d50414d5a3675457a41206798f75d8b2bc6b6f2b536a9702dac3533528574d6f46acd8e2747ba63a0e70e146adba068c93e2979d010baf9aa47a1daf501381620adc59a09e10508aff46e013015e16005000000001976a9148d3164e5ed6f5ae76d7cb3860b31af4f369e775d88ac00000000',
		)
		const sigma = new Sigma(tx, 0, 0)
		expect(sigma.verify()).toBe(true)
	})

	it('signs and verifies with BRC-77 algorithm', () => {
		const tx = new Transaction(1, [], [txOut])
		const sigma = new Sigma(tx, 0, 0)

		sigma.sign(privateKey, SigmaAlgorithm.BRC77)
		expect(sigma.verify()).toBe(true)
		expect(sigma.sig?.algorithm).toBe(SigmaAlgorithm.BRC77)
	})

	it('BRC-77 signed tx is verified after parsing', () => {
		const tx = new Transaction(1, [], [txOut])
		const sigma = new Sigma(tx, 0, 0)

		const { signedTx } = sigma.sign(privateKey, SigmaAlgorithm.BRC77)

		const sigma2 = new Sigma(signedTx)
		expect(sigma2.sig?.algorithm).toBe(SigmaAlgorithm.BRC77)
		expect(sigma2.getSigInstanceCount()).toBe(1)
		expect(sigma2.verify()).toBe(true)
	})

	it('supports mixed BSM and BRC-77 signatures on same output', () => {
		const tx = new Transaction(1, [], [txOut])
		const sigma = new Sigma(tx, 0, 0)

		const { signedTx } = sigma.sign(privateKey, SigmaAlgorithm.BSM)
		expect(sigma.verify()).toBe(true)

		const sigma2 = new Sigma(signedTx, 0, 1)
		sigma2.sign(privateKey2, SigmaAlgorithm.BRC77)

		expect(sigma2.getSigInstanceCount()).toBe(2)

		sigma2.setSigmaInstance(0)
		expect(sigma2.sig?.algorithm).toBe(SigmaAlgorithm.BSM)
		expect(sigma2.verify()).toBe(true)

		sigma2.setSigmaInstance(1)
		expect(sigma2.sig?.algorithm).toBe(SigmaAlgorithm.BRC77)
		expect(sigma2.verify()).toBe(true)
	})

	// -- Backward compatibility: data-container mode --

	it('static decode from script works', () => {
		const tx = Transaction.fromHex(
			'0100000001d70d11131d80dcee954926de96d793585c6bc0ed69619a6cc761a20cef1b1bd7010000006a4730440220466ca5d42bd7a8bd2b6ea5770970b03a0c39fa29847f31e0d949dd36bf523b910220379d1c2718ae3300e833201b227ed8159c93f85bcc6eaea4028dafed2559fee24121036232d22ae556320f5a6516e6e75eab89b33760ccf7b3eb5b791a23883da6b1f5ffffffff020100000000000000a776a914c8fcb96f2f16175d37d602c438eb2f64e59e217788ac0063036f7264510a746578742f706c61696e000774657374696e67686a055349474d410342534d22314535533931716e6f4743586d36314d5931617842435a436d4d50414d5a3675457a41206798f75d8b2bc6b6f2b536a9702dac3533528574d6f46acd8e2747ba63a0e70e146adba068c93e2979d010baf9aa47a1daf501381620adc59a09e10508aff46e013015e16005000000001976a9148d3164e5ed6f5ae76d7cb3860b31af4f369e775d88ac00000000',
		)
		const sigmas = Sigma.decodeFromScript(tx.outputs[0].lockingScript)
		expect(sigmas.length).toBeGreaterThan(0)
		expect(sigmas[0].data.algorithm).toBe(SigmaAlgorithm.BSM)
		expect(sigmas[0].data.address).toBeTruthy()
	})

	it('data-container .data property access works', () => {
		const sigma = new Sigma({
			algorithm: SigmaAlgorithm.BSM,
			address: '1ACLHVPVnB8AmLCyD5hPQtPCSCccjiUn7H',
			signature: [1, 2, 3],
			vin: 0,
			valid: true,
		})
		expect(sigma.data.address).toBe('1ACLHVPVnB8AmLCyD5hPQtPCSCccjiUn7H')
		expect(sigma.data.algorithm).toBe(SigmaAlgorithm.BSM)
		expect(sigma.verify()).toBe(true)
	})
})
