import { describe, expect, test } from 'bun:test'
import {
	type Beef,
	type CreateActionArgs,
	LockingScript,
	MerklePath,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	SatoshisPerKilobyte,
	Spend,
	Transaction,
	UnlockingScript,
	type WalletInterface,
} from '@bsv/sdk'
import type { OneSatContext } from '../types.js'
import { FUNDING_BASKET, createWalletFundingProvider } from './walletFunding.js'

const feeModel = new SatoshisPerKilobyte(100)
const proto = new ProtoWallet(PrivateKey.fromHex('01'.repeat(32)))
const lockA = new P2PKH().lock(
	PrivateKey.fromHex('02'.repeat(32)).toPublicKey().toAddress(),
)
const lockB = new P2PKH().lock(
	PrivateKey.fromHex('03'.repeat(32)).toPublicKey().toAddress(),
)

/** A mined parent so AtomicBEEF can terminate in a proof. */
function minedParent(): Transaction {
	const parent = new Transaction()
	parent.addInput({
		sourceTXID: '11'.repeat(32),
		sourceOutputIndex: 0,
		unlockingScript: new UnlockingScript(),
		sequence: 0xffffffff,
	})
	parent.addOutput({ lockingScript: lockA, satoshis: 1_000_000 })
	parent.merklePath = new MerklePath(100, [
		[{ offset: 0, hash: parent.id('hex'), txid: true }],
	])
	return parent
}

function fakeContext(opts: { broadcast?: 'success' | 'error' } = {}) {
	const created: CreateActionArgs[] = []
	const posted: { beef: Beef; txids: string[] }[] = []
	const wallet: Partial<WalletInterface> = {
		getPublicKey: (a) => proto.getPublicKey(a),
		createSignature: (a) => proto.createSignature(a),
		createAction: async (args) => {
			created.push(args)
			const parent = minedParent()
			const tx = new Transaction()
			tx.addInput({
				sourceTransaction: parent,
				sourceOutputIndex: 0,
				unlockingScript: new UnlockingScript(),
				sequence: 0xffffffff,
			})
			for (const o of args.outputs ?? []) {
				tx.addOutput({
					lockingScript: LockingScript.fromHex(o.lockingScript),
					satoshis: o.satoshis,
				})
			}
			return { txid: tx.id('hex'), tx: tx.toAtomicBEEF() }
		},
	}
	const ctx = {
		wallet: wallet as WalletInterface,
		chain: 'main',
		isBaseWallet: true,
		services: {
			postBeef: async (beef: Beef, txids: string[]) => {
				posted.push({ beef, txids })
				return [
					opts.broadcast === 'error'
						? {
								name: 'fake',
								status: 'error',
								error: new Error('REJECTED'),
								txidResults: [],
							}
						: {
								name: 'fake',
								status: 'success',
								txidResults: [{ txid: txids[0], status: 'success' }],
							},
				]
			},
		},
	} as unknown as OneSatContext
	return { ctx, created, posted }
}

const targetArgs = (): CreateActionArgs => ({
	description: 'Target transaction',
	outputs: [
		{ lockingScript: lockA.toHex(), satoshis: 1, outputDescription: 'a' },
		{ lockingScript: lockB.toHex(), satoshis: 546, outputDescription: 'b' },
	],
})

describe('createWalletFundingProvider', () => {
	test('funds, builds in caller order, signs, broadcasts, returns AtomicBEEF', async () => {
		const { ctx, created, posted } = fakeContext()
		const provider = createWalletFundingProvider(ctx, { feeModel })
		const args = targetArgs()

		const { txid, tx: beef } = await provider.fund(args)

		// (a) one funding UTXO, P2PKH to a wallet-derived key, filed with its derivation
		expect(created).toHaveLength(1)
		const fundOut = created[0].outputs?.[0]
		expect(created[0].outputs).toHaveLength(1)
		expect(fundOut?.basket).toBe(FUNDING_BASKET)
		const ci = JSON.parse(fundOut?.customInstructions ?? '{}')
		expect(ci.protocolID).toBeDefined()
		expect(ci.keyID).toStartWith('funding-')
		const { publicKey } = await proto.getPublicKey({
			protocolID: ci.protocolID,
			keyID: ci.keyID,
			counterparty: 'self',
			forSelf: true,
		})
		expect(fundOut?.lockingScript).toBe(
			new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(),
		)

		// (b) target: the funding UTXO in, caller outputs in caller order, no change
		const tx = Transaction.fromAtomicBEEF(beef)
		expect(tx.id('hex')).toBe(txid)
		expect(tx.inputs).toHaveLength(1)
		const fundingTx = tx.inputs[0].sourceTransaction as Transaction
		expect(fundingTx.outputs[0].lockingScript.toHex()).toBe(
			fundOut?.lockingScript as string,
		)
		expect(
			tx.outputs.map((o) => [o.lockingScript.toHex(), o.satoshis]),
		).toEqual((args.outputs ?? []).map((o) => [o.lockingScript, o.satoshis]))

		// fee: funding = outputs + the model's fee for this transaction
		const paid = (fundOut?.satoshis ?? 0) - 547
		expect(paid).toBeGreaterThan(0)
		expect(
			Math.abs(paid - (await feeModel.computeFee(tx))),
		).toBeLessThanOrEqual(1)

		// signed with the derived key
		const input = tx.inputs[0]
		const spend = new Spend({
			sourceTXID: fundingTx.id('hex'),
			sourceOutputIndex: 0,
			sourceSatoshis: fundingTx.outputs[0].satoshis as number,
			lockingScript: fundingTx.outputs[0].lockingScript,
			transactionVersion: tx.version,
			otherInputs: [],
			outputs: tx.outputs,
			inputIndex: 0,
			unlockingScript: input.unlockingScript as UnlockingScript,
			inputSequence: input.sequence as number,
			lockTime: tx.lockTime,
		})
		expect(spend.validate()).toBe(true)

		// (c) broadcast through services.postBeef
		expect(posted).toHaveLength(1)
		expect(posted[0].txids).toEqual([txid])
		expect(posted[0].beef.findTxid(txid)).toBeDefined()
	})

	test('throws when the broadcast is not accepted', async () => {
		const { ctx } = fakeContext({ broadcast: 'error' })
		const provider = createWalletFundingProvider(ctx, { feeModel })
		await expect(provider.fund(targetArgs())).rejects.toThrow(
			'funding-broadcast-failed: REJECTED',
		)
	})

	test('refuses caller inputs it could not sign', async () => {
		const { ctx, created } = fakeContext()
		const provider = createWalletFundingProvider(ctx, { feeModel })
		await expect(
			provider.fund({
				...targetArgs(),
				inputs: [{ outpoint: `${'ab'.repeat(32)}.0`, inputDescription: 'x' }],
			}),
		).rejects.toThrow('wallet-funding-inputs-unsupported')
		expect(created).toHaveLength(0)
	})
})
