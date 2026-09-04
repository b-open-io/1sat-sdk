import { describe, expect, test } from 'bun:test'
import { P1SAT_PROTOCOL } from '@1sat/types'
import { PrivateKey, type WalletInterface, type WalletOutput } from '@bsv/sdk'
import { sendOpns } from '../src/opns/index.js'
import type { OneSatContext } from '../src/types.js'

const sourceOutpoint = `${'a'.repeat(64)}.3`
const senderIdentityKey = PrivateKey.fromRandom().toPublicKey().toString()
const recipientIdentityKey = PrivateKey.fromRandom().toPublicKey().toString()
const recipientAddress = PrivateKey.fromRandom().toPublicKey().toAddress()

const source: WalletOutput = {
	outpoint: sourceOutpoint,
	satoshis: 1,
	spendable: true,
	tags: ['opns', 'name:alice', 'id:name-id'],
	customInstructions: JSON.stringify({
		protocolID: P1SAT_PROTOCOL,
		keyID: sourceOutpoint,
	}),
}

function makeContext() {
	const publicKeyRequests: Record<string, unknown>[] = []
	const wallet: Partial<WalletInterface> = {
		listOutputs: async () => ({
			outputs: [source],
			BEEF: [1],
			totalOutputs: 1,
		}),
		getPublicKey: async (args) => {
			publicKeyRequests.push(args as Record<string, unknown>)
			return {
				publicKey:
					args.identityKey === true ? senderIdentityKey : recipientIdentityKey,
			}
		},
		createAction: async () => ({ txid: 'mock-txid', tx: [1] }),
	}
	return {
		ctx: {
			wallet: wallet as WalletInterface,
			chain: 'main' as const,
			isBaseWallet: true,
		} satisfies OneSatContext,
		publicKeyRequests,
	}
}

describe('sendOpns counterparty delivery', () => {
	test('returns the shared packet and only requests identity for counterparties', async () => {
		const { ctx, publicKeyRequests } = makeContext()
		const result = await sendOpns.execute(ctx, {
			id: 'name-id',
			counterparty: recipientIdentityKey,
			usePermissionModule: true,
		})

		expect(result.deliveries).toEqual([
			{
				outputIndex: 0,
				keyID: sourceOutpoint,
				protocolID: P1SAT_PROTOCOL,
				senderIdentityKey,
				counterparty: senderIdentityKey,
				recipientIdentityKey,
			},
		])
		expect(
			publicKeyRequests.filter((args) => args.identityKey === true),
		).toHaveLength(1)
	})

	test('omits deliveries and identity lookup for address and self transfers', async () => {
		const addressPath = makeContext()
		const addressResult = await sendOpns.execute(addressPath.ctx, {
			id: 'name-id',
			address: recipientAddress,
			usePermissionModule: true,
		})
		expect(addressResult.deliveries).toBeUndefined()
		expect('deliveries' in addressResult).toBe(false)
		expect(addressPath.publicKeyRequests).toHaveLength(0)

		const selfPath = makeContext()
		const selfResult = await sendOpns.execute(selfPath.ctx, {
			id: 'name-id',
			counterparty: 'self',
			usePermissionModule: true,
		})
		expect(selfResult.deliveries).toBeUndefined()
		expect('deliveries' in selfResult).toBe(false)
		expect(
			selfPath.publicKeyRequests.filter((args) => args.identityKey === true),
		).toHaveLength(0)
	})
})
