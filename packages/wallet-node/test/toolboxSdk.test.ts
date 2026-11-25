/**
 * The CommonJS @bsv/wallet-toolbox validates proofs against its own
 * @bsv/sdk MerklePath class. OneSatServices must build proofs from the SDK
 * build the toolbox loads (toolboxSdk), or the monitor rejects every proof.
 */
import { describe, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OneSatServices, type OneSatServicesSdk } from '@1sat/client'
import { MerklePath, PrivateKey, Script, Transaction } from '@bsv/sdk'
import type { getCanonicalMerklePath as GetCanonicalMerklePath } from '@bsv/wallet-toolbox/out/src/services/getCanonicalMerklePath'
import { createNodeWallet } from '../src/index.js'
import type { StorageBunSqlite } from '../src/storage-bun-sqlite.js'
import { toolboxSdk } from '../src/toolboxSdk.js'

// getCanonicalMerklePath is internal to the toolbox (not a root export); its
// deep paths resolve only through `require`.
const { getCanonicalMerklePath } = createRequire(import.meta.url)(
	'@bsv/wallet-toolbox/out/src/services/getCanonicalMerklePath.js',
) as { getCanonicalMerklePath: typeof GetCanonicalMerklePath }

const txid = '11'.repeat(32)
const height = 800000
const proof = new MerklePath(height, [
	[
		{ offset: 0, hash: txid, txid: true },
		{ offset: 1, hash: '22'.repeat(32) },
	],
])
const merkleRoot = proof.computeRoot(txid)

function servicesBuildingWith(sdk?: OneSatServicesSdk): OneSatServices {
	return stubProofs(new OneSatServices('main', undefined, undefined, sdk))
}

function stubProofs(services: OneSatServices): OneSatServices {
	Object.assign(services.beef, { getProof: async () => proof.toBinary() })
	Object.assign(services.chaintracks, {
		findHeaderForHeight: async () => ({
			version: 1,
			previousHash: '00'.repeat(32),
			merkleRoot,
			time: 0,
			bits: 0,
			nonce: 0,
			height,
			hash: '33'.repeat(32),
		}),
	})
	return services
}

const tracker = {
	isValidRootForHeight: async (root: string, h: number) =>
		root === merkleRoot && h === height,
}

describe('OneSatServices proofs through the CommonJS wallet-toolbox', () => {
	test('a proof built from toolboxSdk passes the toolbox validation', async () => {
		const result = await getCanonicalMerklePath(
			servicesBuildingWith(toolboxSdk) as never,
			tracker,
			txid,
		)
		expect(result.error).toBeUndefined()
		expect(result.merklePath?.blockHeight).toBe(height)
	})

	test('a proof built from the ESM SDK build is rejected', async () => {
		const result = await getCanonicalMerklePath(
			servicesBuildingWith() as never,
			tracker,
			txid,
		)
		expect(result.merklePath).toBeUndefined()
		expect(result.error).toBeDefined()
	})

	test('toolboxSdk is the SDK module the toolbox loads', () => {
		expect(toolboxSdk.MerklePath).not.toBe(MerklePath)
	})

	test('createNodeWallet hands the toolbox objects from toolboxSdk', async () => {
		const node = await createNodeWallet({
			privateKey: PrivateKey.fromRandom(),
			chain: 'main',
			storageIdentityKey: PrivateKey.fromRandom().toPublicKey().toString(),
			storage: {
				provider: 'bun-sqlite',
				filename: join(tmpdir(), `toolbox-sdk-${Date.now()}.db`),
			},
			skipInitialMonitor: true,
		})
		try {
			expect(node.wallet.keyDeriver).toBeInstanceOf(toolboxSdk.KeyDeriver)
			const result = await getCanonicalMerklePath(
				stubProofs(node.services) as never,
				tracker,
				txid,
			)
			expect(result.error).toBeUndefined()
		} finally {
			await node.destroy()
		}
	})

	test('StorageBunSqlite purges spent data with a toolbox Beef', async () => {
		const rootKey = PrivateKey.fromRandom()
		const node = await createNodeWallet({
			privateKey: rootKey,
			chain: 'main',
			storageIdentityKey: PrivateKey.fromRandom().toPublicKey().toString(),
			storage: {
				provider: 'bun-sqlite',
				filename: join(tmpdir(), `toolbox-sdk-beef-${Date.now()}.db`),
			},
			skipInitialMonitor: true,
		})
		try {
			const storage = node.getActiveStorage() as unknown as StorageBunSqlite
			const { user } = await storage.findOrInsertUser(node.wallet.identityKey)
			const basket = await storage.findOrInsertOutputBasket(
				user.userId,
				'default',
			)
			const tx = new Transaction()
			tx.addInput({
				sourceTXID: '00'.repeat(32),
				sourceOutputIndex: 0,
				unlockingScript: new Script(),
				sequence: 0xffffffff,
			})
			tx.addOutput({ lockingScript: Script.fromHex('51'), satoshis: 1000 })
			const seedTxid = tx.id('hex')
			const now = new Date()
			const provenTxId = await storage.insertProvenTx({
				provenTxId: 0,
				created_at: now,
				updated_at: now,
				txid: seedTxid,
				height,
				index: 0,
				merklePath: new MerklePath(height, [
					[{ offset: 0, hash: seedTxid, txid: true }],
				]).toBinary(),
				rawTx: tx.toBinary(),
				blockHash: '00'.repeat(32),
				merkleRoot: seedTxid,
			})
			const transactionId = await storage.insertTransaction({
				transactionId: 0,
				created_at: now,
				updated_at: now,
				userId: user.userId,
				provenTxId,
				status: 'completed',
				reference: 'seed-reference',
				isOutgoing: false,
				satoshis: 1000,
				description: 'seed',
				version: 1,
				lockTime: 0,
				txid: seedTxid,
			})
			await storage.insertOutput({
				outputId: 0,
				created_at: now,
				updated_at: now,
				userId: user.userId,
				transactionId,
				basketId: basket.basketId,
				spendable: true,
				change: false,
				outputDescription: 'seed',
				vout: 0,
				satoshis: 1000,
				providedBy: 'you',
				purpose: '',
				type: 'custom',
				txid: seedTxid,
				lockingScript: [0x51],
				scriptLength: 1,
				scriptOffset: 0,
			})

			// purgeSpent gathers the proofs of spendable outputs into a Beef it
			// passes as mergeToBeef; the toolbox rejects a Beef from the ESM build.
			const purged = await storage.purgeData({
				purgeCompleted: false,
				purgeFailed: false,
				purgeSpent: true,
				purgeSpentAge: 1,
			})

			expect(purged.log).toBeString()
		} finally {
			await node.destroy()
		}
	})
})
