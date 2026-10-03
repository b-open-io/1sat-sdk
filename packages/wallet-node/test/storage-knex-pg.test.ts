/**
 * createNodeWallet on Postgres (StorageKnexPg). Runs only when
 * WALLET_NODE_PG_URL points at a Postgres server where the test may create
 * and drop a database, e.g. `postgres://postgres@127.0.0.1:55433/postgres`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
	MerklePath,
	P2PKH,
	PrivateKey,
	Random,
	Script,
	Transaction,
	Utils,
} from '@bsv/sdk'
import { ScriptTemplateBRC29 } from '@bsv/wallet-toolbox'
import pg from 'pg'
import { type StorageKnexPg, createNodeWallet } from '../src/index.js'

const serverUrl = process.env.WALLET_NODE_PG_URL
const database = `wallet_node_test_${Date.now()}`

function databaseUrl(name: string): string {
	const url = new URL(serverUrl as string)
	url.pathname = `/${name}`
	return url.toString()
}

async function admin(sql: string): Promise<void> {
	const client = new pg.Client({ connectionString: serverUrl })
	await client.connect()
	try {
		await client.query(sql)
	} finally {
		await client.end()
	}
}

describe.skipIf(!serverUrl)('createNodeWallet on Postgres', () => {
	beforeAll(async () => {
		await admin(`CREATE DATABASE ${database}`)
	})

	afterAll(async () => {
		await admin(`DROP DATABASE IF EXISTS ${database}`)
	})

	test('createAction and listOutputs round trip through StorageKnex', async () => {
		const rootKey = PrivateKey.fromRandom()
		const storageIdentityKey = PrivateKey.fromRandom().toPublicKey().toString()
		const node = await createNodeWallet({
			privateKey: rootKey,
			chain: 'test',
			storageIdentityKey,
			storage: { provider: 'pg', dbUrl: databaseUrl(database) },
			skipInitialMonitor: true,
		})
		try {
			const { wallet } = node
			const storage = node.getActiveStorage() as unknown as StorageKnexPg

			const settings = await storage.makeAvailable()
			expect(settings.dbtype).toBe('Postgres')
			expect(settings.storageIdentityKey).toBe(storageIdentityKey)
			expect(await storage.getCapabilities()).toHaveProperty('actionBatch')

			// Seed one proven change output the wallet can spend.
			const { user } = await storage.findOrInsertUser(wallet.identityKey)
			const basket = await storage.findOrInsertOutputBasket(
				user.userId,
				'default',
			)
			const derivationPrefix = Utils.toBase64(Random(8))
			const derivationSuffix = Utils.toBase64(Random(8))
			// The toolbox is CommonJS and builds its Script from the sdk's CJS
			// build; re-parse it so this ESM Transaction can serialize it.
			const lockingScript = Script.fromBinary(
				new ScriptTemplateBRC29({
					derivationPrefix,
					derivationSuffix,
					keyDeriver: wallet.keyDeriver,
				})
					.lock(rootKey.toString(), wallet.identityKey)
					.toBinary(),
			)
			const fundingTx = new Transaction()
			fundingTx.addInput({
				sourceTXID: '00'.repeat(32),
				sourceOutputIndex: 0,
				unlockingScript: new Script(),
				sequence: 0xffffffff,
			})
			fundingTx.addOutput({ lockingScript, satoshis: 10_000 })
			const txid = fundingTx.id('hex')
			const height = 1000
			const now = new Date()
			const provenTxId = await storage.insertProvenTx({
				provenTxId: 0,
				created_at: now,
				updated_at: now,
				txid,
				height,
				index: 0,
				merklePath: new MerklePath(height, [
					[{ offset: 0, hash: txid, txid: true }],
				]).toBinary(),
				rawTx: fundingTx.toBinary(),
				blockHash: '00'.repeat(32),
				merkleRoot: txid,
			})
			const transactionId = await storage.insertTransaction({
				transactionId: 0,
				created_at: now,
				updated_at: now,
				userId: user.userId,
				provenTxId,
				status: 'completed',
				reference: Utils.toBase64(Random(12)),
				isOutgoing: false,
				satoshis: 10_000,
				description: 'seed',
				version: 1,
				lockTime: 0,
				txid,
			})
			await storage.insertOutput({
				outputId: 0,
				created_at: now,
				updated_at: now,
				userId: user.userId,
				transactionId,
				basketId: basket.basketId,
				spendable: true,
				change: true,
				outputDescription: 'seed',
				vout: 0,
				satoshis: 10_000,
				providedBy: 'storage',
				purpose: 'change',
				type: 'P2PKH',
				txid,
				senderIdentityKey: wallet.identityKey,
				derivationPrefix,
				derivationSuffix,
				lockingScript: lockingScript.toBinary(),
				scriptLength: lockingScript.toBinary().length,
				scriptOffset: 0,
			})

			const created = await wallet.createAction({
				description: 'pg round trip',
				outputs: [
					{
						lockingScript: new P2PKH()
							.lock(PrivateKey.fromRandom().toAddress())
							.toHex(),
						satoshis: 1000,
						outputDescription: 'pg test output',
						basket: 'pgtest',
						tags: ['pg'],
					},
				],
				options: { noSend: true, randomizeOutputs: false },
			})
			expect(created.txid).toBeString()

			const listed = await wallet.listOutputs({
				basket: 'pgtest',
				tags: ['pg'],
			})
			expect(listed.totalOutputs).toBe(1)
			expect(listed.outputs[0].outpoint).toBe(`${created.txid}.0`)
			expect(listed.outputs[0].satoshis).toBe(1000)

			const change = await wallet.listOutputs({ basket: 'default' })
			expect(change.outputs.every((o) => o.outpoint.startsWith(txid))).toBe(
				false,
			)
			const changeSats = change.outputs.reduce((s, o) => s + o.satoshis, 0)
			expect(changeSats).toBeGreaterThan(0)
			expect(changeSats).toBeLessThan(9000)

			const usedBytes = await storage.measureUsedBytes(user.userId)
			expect(typeof usedBytes).toBe('number')
			expect(usedBytes).toBeGreaterThan(0)
		} finally {
			await node.destroy()
		}
	})
})
