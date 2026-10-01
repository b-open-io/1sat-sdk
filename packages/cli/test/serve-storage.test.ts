/**
 * `1sat serve storage`: the wallet-toolbox StorageServer built by
 * `createStorageServer` over the CLI's SQLite storage, driven by a
 * wallet-toolbox StorageClient. Needs dist/ in wallet-node and wallet-server.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type NodeWalletResult, createNodeWallet } from '@1sat/wallet-node'
import { createStorageServer } from '@1sat/wallet-server'
import {
	PrivateKey,
	ProtoWallet,
	Script,
	Transaction,
	type WalletInterface,
} from '@bsv/sdk'
import { StorageClient, StorageProvider } from '@bsv/wallet-toolbox'
import { RedisClient } from 'bun'

const REDIS_URL = 'redis://127.0.0.1:6379/15'

type StorageServer = ReturnType<typeof createStorageServer>

async function freePort(): Promise<number> {
	const probe = Bun.serve({ port: 0, fetch: () => new Response() })
	const { port } = probe
	probe.stop(true)
	return port as number
}

async function startServer(
	node: NodeWalletResult,
	sessionStore?: { redisUrl: string },
): Promise<{ server: StorageServer; url: string }> {
	const storage = node.getActiveStorage()
	if (!(storage instanceof StorageProvider)) throw new Error('not local')
	const port = await freePort()
	const server = createStorageServer({
		storage,
		wallet: node.wallet,
		listen: { port, host: '127.0.0.1' },
		sessionStore,
	})
	server.start()
	const url = `http://127.0.0.1:${port}`
	for (let i = 0; i < 50; i++) {
		try {
			await fetch(`${url}/healthz`)
			break
		} catch {
			await Bun.sleep(20)
		}
	}
	return { server, url }
}

function clientWallet(): WalletInterface {
	return new ProtoWallet(PrivateKey.fromRandom()) as unknown as WalletInterface
}

/** A transaction whose rawTx, sent as number[], exceeds the auth layer's 100,000-node cap. */
function largeTransaction(userId: number) {
	const tx = new Transaction()
	tx.addInput({
		sourceTXID: '00'.repeat(32),
		sourceOutputIndex: 0,
		unlockingScript: new Script(),
		sequence: 0xffffffff,
	})
	tx.addOutput({
		lockingScript: Script.fromBinary([
			0x6a,
			0x4e,
			0xf0,
			0x49,
			0x02,
			0x00,
			...new Array(150_000).fill(7),
		]),
		satoshis: 0,
	})
	const now = new Date()
	return {
		created_at: now,
		updated_at: now,
		transactionId: 1,
		userId,
		status: 'nosend' as const,
		reference: 'serve-storage-test',
		isOutgoing: false,
		satoshis: 0,
		description: 'binary sync test',
		version: 1,
		lockTime: 0,
		txid: tx.id('hex'),
		rawTx: tx.toBinary(),
	}
}

describe('serve storage', () => {
	let dir: string
	let node: NodeWalletResult
	let server: StorageServer
	let url: string

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'serve-storage-'))
		node = await createNodeWallet({
			privateKey: PrivateKey.fromRandom(),
			chain: 'test',
			storageIdentityKey: PrivateKey.fromRandom().toPublicKey().toString(),
			storage: { provider: 'bun-sqlite', filename: join(dir, 'wallet.db') },
			skipInitialMonitor: true,
		})
		;({ server, url } = await startServer(node))
	})

	afterAll(async () => {
		await server.close()
		await node.destroy()
		rmSync(dir, { recursive: true, force: true })
	})

	test('serves a StorageClient on SQLite with in-memory sessions', async () => {
		const wallet = clientWallet()
		const client = new StorageClient(wallet, url, { binaryRequests: true })

		const settings = await client.makeAvailable()
		expect(settings.dbtype).toBe('SQLite')
		expect(settings.storageIdentityKey).toBe(
			node.getActiveStorage().getSettings().storageIdentityKey,
		)

		const { publicKey: identityKey } = await wallet.getPublicKey({
			identityKey: true,
		})
		const { user } = await client.findOrInsertUser(identityKey)
		expect(user.identityKey).toBe(identityKey)

		await client.findOrInsertSyncStateAuth(
			{ identityKey, userId: user.userId },
			'local-storage',
			'local',
		)
		const transaction = largeTransaction(user.userId)
		const result = await client.processSyncChunk(
			{
				identityKey,
				fromStorageIdentityKey: 'local-storage',
				toStorageIdentityKey: settings.storageIdentityKey,
				maxRoughSize: 10_000_000,
				maxItems: 1000,
				offsets: [],
			},
			{
				fromStorageIdentityKey: 'local-storage',
				toStorageIdentityKey: settings.storageIdentityKey,
				userIdentityKey: identityKey,
				user,
				transactions: [transaction],
			},
		)
		expect(result.inserts).toBeGreaterThanOrEqual(1)

		const storage = node.getActiveStorage() as StorageProvider
		const [stored] = await storage.findTransactions({
			partial: { userId: user.userId, txid: transaction.txid },
		})
		expect(Array.from(stored.rawTx ?? [])).toEqual(transaction.rawTx)
	})
})

async function redisReachable(): Promise<boolean> {
	const redis = new RedisClient(REDIS_URL, { connectionTimeout: 500 })
	try {
		await redis.send('PING', [])
		return true
	} catch {
		return false
	} finally {
		redis.close()
	}
}

const hasRedis = await redisReachable()
if (!hasRedis)
	console.warn(`skipping shared-session test: no Redis at ${REDIS_URL}`)

describe.skipIf(!hasRedis)('serve storage with a Redis session store', () => {
	let dir: string
	let node: NodeWalletResult
	let servers: StorageServer[]
	let proxy: ReturnType<typeof Bun.serve>
	const handled: string[] = []
	const handshakes: string[] = []

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'serve-storage-redis-'))
		node = await createNodeWallet({
			privateKey: PrivateKey.fromRandom(),
			chain: 'test',
			storageIdentityKey: PrivateKey.fromRandom().toPublicKey().toString(),
			storage: { provider: 'bun-sqlite', filename: join(dir, 'wallet.db') },
			skipInitialMonitor: true,
		})
		const a = await startServer(node, { redisUrl: REDIS_URL })
		const b = await startServer(node, { redisUrl: REDIS_URL })
		servers = [a.server, b.server]
		const backends = [a.url, b.url]
		let next = 0
		// Round-robin load balancer: consecutive requests go to different instances.
		proxy = Bun.serve({
			port: 0,
			async fetch(req) {
				const backend = backends[next++ % backends.length]
				const { pathname, search } = new URL(req.url)
				handled.push(backend)
				if (pathname === '/.well-known/auth') handshakes.push(backend)
				const res = await fetch(`${backend}${pathname}${search}`, {
					method: req.method,
					headers: req.headers,
					body: req.method === 'GET' ? undefined : await req.arrayBuffer(),
				})
				const headers = new Headers(res.headers)
				headers.delete('content-encoding')
				headers.delete('content-length')
				return new Response(await res.arrayBuffer(), {
					status: res.status,
					headers,
				})
			},
		})
	})

	afterAll(async () => {
		proxy.stop(true)
		for (const server of servers) await server.close()
		await node.destroy()
		rmSync(dir, { recursive: true, force: true })
		const redis = new RedisClient(REDIS_URL)
		const keys = (await redis.send('KEYS', ['authsess:*'])) as string[]
		if (keys.length > 0) await redis.send('DEL', keys)
		redis.close()
	})

	test('one handshake authenticates the client on both instances', async () => {
		const wallet = clientWallet()
		const client = new StorageClient(wallet, `http://127.0.0.1:${proxy.port}`)
		const { publicKey: identityKey } = await wallet.getPublicKey({
			identityKey: true,
		})

		await client.makeAvailable()
		for (let i = 0; i < 4; i++) {
			const { user } = await client.findOrInsertUser(identityKey)
			expect(user.identityKey).toBe(identityKey)
		}

		expect(handshakes).toHaveLength(1)
		expect(new Set(handled).size).toBe(2)
	})
})
