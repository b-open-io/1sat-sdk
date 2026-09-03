import { describe, expect, test } from 'bun:test'
import { BSV21_AUTH_TAG, BSV21_BASKET } from '@1sat/types'
import {
	type CreateActionArgs,
	PrivateKey,
	type WalletInterface,
	type WalletOutput,
} from '@bsv/sdk'
import type { OneSatContext } from '../types.js'
import { type MintBsv21Input, mintBsv21 } from './index.js'

const TOKEN_TXID = 'a'.repeat(64)
const TOKEN_ID = `${TOKEN_TXID}_0`
const AUTH_OUTPOINT = `${TOKEN_TXID}.0`
const WRONG_TOKEN_ID = `${'b'.repeat(64)}_0`
const ACTION_TXID = 'c'.repeat(64)
const SELF_PUBLIC_KEY = PrivateKey.fromHex('01'.repeat(32))
	.toPublicKey()
	.toString()
const DESTINATION_ADDRESS = PrivateKey.fromHex('02'.repeat(32))
	.toPublicKey()
	.toAddress()
const FEE_ADDRESS = PrivateKey.fromHex('03'.repeat(32))
	.toPublicKey()
	.toAddress()

function authorityOutput(options?: {
	outpoint?: string
	tokenId?: string
	deploy?: boolean
}): WalletOutput {
	const deploy = options?.deploy ?? false
	const tokenId = options?.tokenId ?? TOKEN_ID
	return {
		outpoint: options?.outpoint ?? AUTH_OUTPOINT,
		satoshis: 1,
		spendable: true,
		tags: deploy
			? [BSV21_AUTH_TAG, 'bsv21:deploy']
			: [BSV21_AUTH_TAG, `bsv21:${tokenId}`],
		customInstructions: JSON.stringify({
			...(deploy ? {} : { id: tokenId }),
			amt: '0',
			op: deploy ? 'deploy+auth' : 'auth',
			protocolID: [0, 'p 1sat'],
			keyID: 'authority-key',
		}),
	}
}

function makeContext(
	authorities: WalletOutput[],
	options?: { isActive?: boolean; feePerOutput?: number },
) {
	let created: CreateActionArgs | undefined
	const listCalls: Parameters<WalletInterface['listOutputs']>[0][] = []
	const wallet: Partial<WalletInterface> = {
		listOutputs: async (args) => {
			listCalls.push(args)
			return {
				outputs: authorities,
				BEEF: [1, 2, 3],
				totalOutputs: authorities.length,
			}
		},
		getPublicKey: async () => ({ publicKey: SELF_PUBLIC_KEY }),
		createAction: async (args) => {
			created = args
			return { txid: ACTION_TXID, tx: [1, 2, 3] }
		},
	}
	const ctx = {
		wallet: wallet as WalletInterface,
		chain: 'main',
		isBaseWallet: true,
		services: {
			bsv21: {
				getTokenDetails: async () => ({
					token: { id: TOKEN_ID, sym: 'TEST', dec: 0 },
					status: {
						is_active: options?.isActive ?? true,
						fee_address: FEE_ADDRESS,
						fee_per_output: options?.feePerOutput ?? 1_000,
					},
				}),
			},
			overlay: {
				submitBsv21: async () => ({ acknowledged: true }),
			},
			getBeefForTxid: async () => ({ toBinary: () => [1, 2, 3] }),
		},
	} as unknown as OneSatContext
	return {
		ctx,
		created: () => created,
		listCalls,
	}
}

function feeOutput(args: CreateActionArgs | undefined) {
	return args?.outputs?.find(
		(output) => output.outputDescription === 'Overlay processing fee',
	)
}

describe('mintBsv21 authority selection', () => {
	test('selects the deploy+auth genesis authority by its outpoint-derived token id', async () => {
		const wrong = authorityOutput({
			outpoint: `${'b'.repeat(64)}.1`,
			tokenId: WRONG_TOKEN_ID,
		})
		const genesis = authorityOutput({ deploy: true })
		const harness = makeContext([wrong, genesis])

		const result = await mintBsv21.execute(harness.ctx, {
			tokenId: TOKEN_ID,
			mint: { amount: '1', destination: { address: DESTINATION_ADDRESS } },
		})

		expect(result.error).toBeUndefined()
		expect(harness.listCalls[0]).toMatchObject({
			basket: BSV21_BASKET,
			tags: [BSV21_AUTH_TAG],
			tagQueryMode: 'all',
		})
		expect(harness.created()?.inputs?.[0]?.outpoint).toBe(AUTH_OUTPOINT)
	})

	test('does not spend an authority belonging to another token', async () => {
		const harness = makeContext([
			authorityOutput({
				outpoint: `${'b'.repeat(64)}.1`,
				tokenId: WRONG_TOKEN_ID,
			}),
		])

		const result = await mintBsv21.execute(harness.ctx, {
			tokenId: TOKEN_ID,
			mint: { amount: '1', destination: { address: DESTINATION_ADDRESS } },
		})

		expect(result.error).toBe('no-auth-utxo-for-token')
		expect(harness.created()).toBeUndefined()
	})

	test('fails when no authority exists', async () => {
		const harness = makeContext([])

		const result = await mintBsv21.execute(harness.ctx, {
			tokenId: TOKEN_ID,
			endMinting: true,
		})

		expect(result.error).toBe('no-auth-utxo-for-token')
		expect(harness.created()).toBeUndefined()
	})

	test('fails when the matching authority has no spend instructions', async () => {
		const authority = authorityOutput({ deploy: true })
		authority.customInstructions = undefined
		const harness = makeContext([authority])

		const result = await mintBsv21.execute(harness.ctx, {
			tokenId: TOKEN_ID,
			endMinting: true,
		})

		expect(result.error).toBe('auth-utxo-missing-custom-instructions')
		expect(harness.created()).toBeUndefined()
	})

	test('fails closed when the token overlay is inactive', async () => {
		const harness = makeContext([authorityOutput({ deploy: true })], {
			isActive: false,
		})

		const result = await mintBsv21.execute(harness.ctx, {
			tokenId: TOKEN_ID,
			endMinting: true,
		})

		expect(result.error).toBe('token-not-active')
		expect(harness.listCalls).toHaveLength(0)
		expect(harness.created()).toBeUndefined()
	})
})

describe('mintBsv21 authority termination contract', () => {
	test('rejects an auth destination combined with permanent termination', async () => {
		const harness = makeContext([authorityOutput({ deploy: true })])

		const result = await mintBsv21.execute(harness.ctx, {
			tokenId: TOKEN_ID,
			auth: { destination: { address: DESTINATION_ADDRESS } },
			endMinting: true,
		})

		expect(result.error).toBe('auth-and-end-minting-are-mutually-exclusive')
		expect(harness.listCalls).toHaveLength(0)
		expect(harness.created()).toBeUndefined()
	})
})

describe('mintBsv21 overlay output fees', () => {
	const cases: Array<{
		name: string
		input: Omit<MintBsv21Input, 'tokenId'>
		expectedFee: number
		expectedTokenOutputs: number
	}> = [
		{
			name: 'mint with the implicit continuing-self authority',
			input: {
				mint: { amount: '1', destination: { address: DESTINATION_ADDRESS } },
			},
			expectedFee: 2_000,
			expectedTokenOutputs: 2,
		},
		{
			name: 'mint with an explicit transferred authority',
			input: {
				mint: { amount: '1', destination: { address: DESTINATION_ADDRESS } },
				auth: { destination: { address: DESTINATION_ADDRESS } },
			},
			expectedFee: 2_000,
			expectedTokenOutputs: 2,
		},
		{
			name: 'authority-only transfer',
			input: {
				auth: { destination: { address: DESTINATION_ADDRESS } },
			},
			expectedFee: 1_000,
			expectedTokenOutputs: 1,
		},
		{
			name: 'mint that permanently ends authority',
			input: {
				mint: { amount: '1', destination: { address: DESTINATION_ADDRESS } },
				endMinting: true,
			},
			expectedFee: 1_000,
			expectedTokenOutputs: 1,
		},
		{
			name: 'authority-only termination',
			input: {
				endMinting: true,
			},
			expectedFee: 0,
			expectedTokenOutputs: 0,
		},
	]

	for (const scenario of cases) {
		test(scenario.name, async () => {
			const harness = makeContext([authorityOutput({ deploy: true })])
			const result = await mintBsv21.execute(harness.ctx, {
				tokenId: TOKEN_ID,
				...scenario.input,
			})

			expect(result.error).toBeUndefined()
			if (scenario.expectedFee === 0) {
				expect(feeOutput(harness.created())).toBeUndefined()
			} else {
				expect(feeOutput(harness.created())?.satoshis).toBe(
					scenario.expectedFee,
				)
			}
			const tokenOutputs =
				harness
					.created()
					?.outputs?.filter(
						(output) => output.outputDescription !== 'Overlay processing fee',
					) ?? []
			expect(tokenOutputs).toHaveLength(scenario.expectedTokenOutputs)
			if (scenario.name === 'authority-only termination') {
				expect(harness.created()?.description).toBe('End TEST mint authority')
				expect(harness.created()?.inputs?.[0]?.outpoint).toBe(AUTH_OUTPOINT)
				expect(result.authOutpoint).toBeUndefined()
			}
		})
	}

	test('does not emit a zero-satoshi fee output when the fee rate is zero', async () => {
		const harness = makeContext([authorityOutput({ deploy: true })], {
			feePerOutput: 0,
		})
		const result = await mintBsv21.execute(harness.ctx, {
			tokenId: TOKEN_ID,
			mint: { amount: '1', destination: { address: DESTINATION_ADDRESS } },
			endMinting: true,
		})

		expect(result.error).toBeUndefined()
		expect(feeOutput(harness.created())).toBeUndefined()
		expect(harness.created()?.outputs).toHaveLength(1)
	})
})
