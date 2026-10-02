import { describe, expect, it, mock } from 'bun:test'
import type { OneSatServices } from '@1sat/client'
import type { TokenDetailResponse } from '@1sat/types'
import { Beef, P2PKH, PrivateKey, type WalletInterface } from '@bsv/sdk'
import { sweepBsv21 } from './index.js'

describe('sweepBsv21 overlay handling', () => {
	it('spends the whole requested batch when validation is partial', async () => {
		const owner = PrivateKey.fromRandom()
		const outpointPrefix = 'a'.repeat(64)
		const inputs = [0, 1].map((vout) => ({
			outpoint: `${outpointPrefix}.${vout}`,
			satoshis: 1,
			lockingScript: new P2PKH().lock(owner.toAddress()).toHex(),
			tokenId: `${'b'.repeat(64)}_0`,
			amount: vout === 0 ? '40' : '2',
		}))
		let createdDescription = ''
		const createAction = mock(async (args: { description?: string }) => {
			createdDescription = args.description ?? ''
			return { txid: 'sweep-tx' }
		})
		const validateOutputs = mock(async () => [
			{ outpoint: inputs[0].outpoint, score: 0 },
		])
		const tokenDetails: TokenDetailResponse = {
			tokenId: inputs[0].tokenId,
			token: { id: inputs[0].tokenId, op: 'deploy', amt: '42', sym: 'TEST' },
			status: {
				token_id: inputs[0].tokenId,
				is_active: true,
				balance: 42,
				credits: 0,
				debits: 0,
				output_count: 2,
				fee_per_output: 0,
				fee_address: '',
				is_whitelisted: false,
				is_blacklisted: false,
			},
		}
		const services = {
			bsv21: {
				getTokenDetails: async () => tokenDetails,
				validateOutputs,
			},
			getBeefForTxid: async () => new Beef(),
			overlay: { submitBsv21: async () => ({}) },
		} as unknown as OneSatServices
		const wallet = {
			getPublicKey: async () => ({
				publicKey: owner.toPublicKey().toString(),
			}),
			createAction,
		} as unknown as WalletInterface

		const result = await sweepBsv21.execute(
			{ wallet, services, chain: 'main', isBaseWallet: false },
			{ inputs, keys: [owner, owner] },
		)

		expect(result.txid).toBe('sweep-tx')
		expect(createAction).toHaveBeenCalledTimes(1)
		expect(createdDescription).toContain('2 token UTXOs')
		expect(validateOutputs).not.toHaveBeenCalled()
	})
})
