import { describe, expect, it } from 'bun:test'
import { Inscription, MAP, Sigma } from '@1sat/templates'
import {
	Beef,
	BigNumber,
	type CreateActionArgs,
	type CreateActionResult,
	ECDSA,
	LockingScript,
	PrivateKey,
	Script,
	type SignActionArgs,
	type SignActionResult,
	Transaction,
	UnlockingScript,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import type { OneSatContext } from '../types'
import { mintCollection, mintCollectionItem } from './index'

interface MockState {
	actions: CreateActionArgs[]
	pending: Map<string, Transaction>
}

function createMockContext(): { ctx: OneSatContext; state: MockState } {
	const key = PrivateKey.fromRandom()
	const publicKey = key.toPublicKey().toString()
	const state: MockState = { actions: [], pending: new Map() }
	let nextReference = 0

	const wallet: Partial<WalletInterface> = {
		getPublicKey: async () => ({ publicKey }),
		listOutputs: async () => ({
			totalOutputs: 1,
			outputs: [
				{
					satoshis: 1,
					spendable: true,
					outpoint: `${'f'.repeat(64)}.0`,
					tags: ['type:id', 'seq:1'],
				},
			],
		}),
		createSignature: async (args: { hashToDirectlySign?: number[] }) => ({
			signature: Array.from(
				ECDSA.sign(
					new BigNumber(args.hashToDirectlySign as number[]),
					key,
					true,
				).toDER() as number[],
			),
		}),
		createAction: async (
			args: CreateActionArgs,
		): Promise<CreateActionResult> => {
			state.actions.push(args)
			const tx = new Transaction()

			for (const input of args.inputs ?? []) {
				const [txid, vout] = input.outpoint.split('.')
				tx.addInput({
					sourceTXID: txid,
					sourceOutputIndex: Number(vout),
					unlockingScript: new UnlockingScript(),
					sequence: 0xffffffff,
				})
			}

			for (const output of args.outputs ?? []) {
				tx.addOutput({
					lockingScript: LockingScript.fromHex(output.lockingScript),
					satoshis: output.satoshis,
				})
			}

			if (args.inputBEEF) {
				const inputBeef = Beef.fromBinary(Array.from(args.inputBEEF))
				for (const input of tx.inputs) {
					const source = input.sourceTXID
						? inputBeef.findTxid(input.sourceTXID)
						: undefined
					if (source?.tx) input.sourceTransaction = source.tx
				}
			}

			const beef = new Beef()
			for (const input of tx.inputs) {
				if (input.sourceTransaction) {
					beef.mergeTransaction(input.sourceTransaction)
				}
			}
			beef.mergeTransaction(tx)
			const reference = `ref-${nextReference++}`
			state.pending.set(reference, tx)

			return {
				signableTransaction: {
					reference,
					tx: beef.toBinaryAtomic(tx.id('hex')),
				},
			}
		},
		signAction: async (args: SignActionArgs): Promise<SignActionResult> => {
			const tx = state.pending.get(args.reference)
			if (!tx) throw new Error(`unknown reference: ${args.reference}`)
			for (const [index, spend] of Object.entries(args.spends ?? {})) {
				tx.inputs[Number(index)].unlockingScript = Script.fromHex(
					spend.unlockingScript ?? '',
				) as UnlockingScript
			}
			const beef = new Beef()
			for (const input of tx.inputs) {
				if (input.sourceTransaction)
					beef.mergeTransaction(input.sourceTransaction)
			}
			beef.mergeTransaction(tx)
			const txid = tx.id('hex')
			state.pending.delete(args.reference)
			return { txid, tx: beef.toBinaryAtomic(txid) }
		},
		abortAction: async () => ({ aborted: true }),
	}

	return {
		ctx: {
			wallet: wallet as WalletInterface,
			chain: 'main',
			isBaseWallet: true,
		},
		state,
	}
}

function expectValidSigma(script: Script, outpoint: string): string {
	const sigmas = Sigma.decodeFromScript(script)
	expect(sigmas).toHaveLength(1)
	const [txid, vout] = outpoint.split('.')
	const inputHash = Sigma.computeInputHash(txid, 0, Number(vout))
	const dataHash = Sigma.computeDataHash(script, 0)
	const messageHash = Sigma.computeMessageHash(inputHash, dataHash)
	expect(sigmas[0].verifyWithHashes(messageHash, [])).toBe(true)
	return sigmas[0].data.address
}

describe('collection references and SIGMA authorship', () => {
	it('creates overlay-compatible roots, embedded items, and referenced items', async () => {
		const { ctx, state } = createMockContext()
		const collection = await mintCollection.execute(ctx, {
			base64Content: 'cm9vdA==',
			contentType: 'text/plain',
			name: 'Root',
			description: 'Collection root',
			quantity: 2,
		})
		expect(collection.error).toBeUndefined()

		const metadata = {
			name: 'Item',
			collectionId: `${'b'.repeat(64)}_1`,
			mintNumber: 1,
			rank: 2,
			rarityLabel: 'rare',
			traits: [{ name: 'Color', value: 'Blue' }],
		}
		const embedded = await mintCollectionItem.execute(ctx, {
			...metadata,
			base64Content: 'aW1hZ2U=',
			contentType: 'image/png',
		})
		const ref = `${'c'.repeat(64)}_3:-1`
		const referenced = await mintCollectionItem.execute(ctx, {
			...metadata,
			ref,
		})
		expect(embedded.error).toBeUndefined()
		expect(referenced.error).toBeUndefined()

		const publishActions = state.actions.filter((action) =>
			action.description.startsWith('Create collection'),
		)
		expect(publishActions).toHaveLength(3)
		const scripts = publishActions.map((action) =>
			Script.fromHex(action.outputs?.[0].lockingScript as string),
		)

		const embeddedMap = MAP.decode(scripts[1])
		const referencedMap = MAP.decode(scripts[2])
		expect(referencedMap?.data.subType).toBe('collectionItem')
		expect(referencedMap?.data.subTypeData).toBe(embeddedMap?.data.subTypeData)

		const inscription = Inscription.decode(scripts[2])
		expect(inscription?.file.type).toBe('ord-fs/json')
		expect(
			JSON.parse(Utils.toUTF8(Array.from(inscription?.file.content ?? []))),
		).toEqual({ '.': ref })

		const signerAddresses = publishActions.map((action, index) =>
			expectValidSigma(scripts[index], action.inputs?.[0].outpoint as string),
		)
		expect(new Set(signerAddresses).size).toBe(1)
	})

	it('requires exactly one content source and validates ORDFS references', async () => {
		const ctx = { wallet: {}, chain: 'main' } as unknown as OneSatContext
		const common = { name: 'Item', collectionId: `${'d'.repeat(64)}_0` }

		expect((await mintCollectionItem.execute(ctx, common)).error).toBe(
			'exactly-one-of-base64Content-or-ref-required',
		)
		expect(
			(
				await mintCollectionItem.execute(ctx, {
					...common,
					base64Content: 'eA==',
					contentType: 'text/plain',
					ref: '_0',
				})
			).error,
		).toBe('exactly-one-of-base64Content-or-ref-required')
		expect(
			(await mintCollectionItem.execute(ctx, { ...common, ref: 'not-a-ref' }))
				.error,
		).toBe('invalid-ref: not-a-ref')
	})
})
