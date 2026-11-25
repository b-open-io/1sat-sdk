/**
 * Moving a wallet's active storage: the wallet that moves it copies its data
 * to the new store and every store's user row then names the new store.
 * A wallet opened later with the old store configured follows the move
 * instead of reclaiming the old store (which would leave two writable
 * stores). Two `createStorageServer` instances stand in for two storage
 * providers. Needs dist/ in wallet, wallet-node and wallet-server.
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type NodeWalletResult, createNodeWallet } from '@1sat/wallet-node'
import { createStorageServer } from '@1sat/wallet-server'
import { PrivateKey } from '@bsv/sdk'
import { StorageProvider } from '@bsv/wallet-toolbox'

// Each test opens wallets against several local storage servers.
setDefaultTimeout(30_000)

async function freePort(): Promise<number> {
	const probe = Bun.serve({ port: 0, fetch: () => new Response() })
	const { port } = probe
	probe.stop(true)
	return port as number
}

async function provider(dir: string, name: string) {
	const node = await createNodeWallet({
		privateKey: PrivateKey.fromRandom(),
		chain: 'test',
		storageIdentityKey: PrivateKey.fromRandom().toPublicKey().toString(),
		storage: { provider: 'bun-sqlite', filename: join(dir, `${name}.db`) },
		skipInitialMonitor: true,
	})
	const storage = node.getActiveStorage()
	if (!(storage instanceof StorageProvider)) throw new Error('not local')
	const port = await freePort()
	const server = createStorageServer({
		storage,
		wallet: node.wallet,
		listen: { port, host: '127.0.0.1' },
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
	return {
		node,
		server,
		url,
		key: storage.getSettings().storageIdentityKey,
		storage,
	}
}

describe('active storage moves are followed, not reclaimed', () => {
	let dir: string
	let a: Awaited<ReturnType<typeof provider>>
	let b: Awaited<ReturnType<typeof provider>>
	let c: Awaited<ReturnType<typeof provider>>
	let d: Awaited<ReturnType<typeof provider>>
	let e: Awaited<ReturnType<typeof provider>>
	const userKey = PrivateKey.fromRandom()
	const opened: NodeWalletResult[] = []
	let n = 0

	const userWallet = async (activeRemote: string, backups?: string[]) => {
		const w = await createNodeWallet({
			privateKey: userKey,
			chain: 'test',
			storageIdentityKey: PrivateKey.fromRandom().toPublicKey().toString(),
			storage: {
				provider: 'bun-sqlite',
				filename: join(dir, `user-${n++}.db`),
			},
			activeRemote,
			backups,
			skipInitialMonitor: true,
			connectionTimeout: 15000,
		})
		opened.push(w)
		return w
	}

	const activeStorageIn = async (p: typeof a) => {
		const identityKey = userKey.toPublicKey().toString()
		const [user] = await p.storage.findUsers({ partial: { identityKey } })
		return user?.activeStorage
	}

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'storage-follow-'))
		a = await provider(dir, 'provider-a')
		b = await provider(dir, 'provider-b')
		c = await provider(dir, 'provider-c')
		d = await provider(dir, 'provider-d')
		e = await provider(dir, 'provider-e')
	})

	afterAll(async () => {
		for (const w of opened) await w.destroy().catch(() => {})
		for (const p of [a, b, c, d, e]) {
			await p.server.close()
			await p.node.destroy()
		}
		rmSync(dir, { recursive: true, force: true })
	})

	test('a switch moves every store to the new provider', async () => {
		const first = await userWallet(a.url)
		expect(first.getStorageStatus()).toMatchObject({
			activeRemoteUrl: a.url,
			activeStorageKey: a.key,
			writable: true,
			movedTo: undefined,
		})
		await first.setActiveStorage(b.url)
		expect(first.getStorageStatus()).toMatchObject({
			activeRemoteUrl: b.url,
			activeStorageKey: b.key,
			writable: true,
		})
		expect(await activeStorageIn(a)).toBe(b.key)
		expect(await activeStorageIn(b)).toBe(b.key)
	})

	test('a wallet that knows the new provider follows the move', async () => {
		const second = await userWallet(a.url, [b.url])
		expect(second.getStorageStatus()).toMatchObject({
			activeRemoteUrl: b.url,
			activeStorageKey: b.key,
			writable: true,
			movedTo: undefined,
		})
		expect(await activeStorageIn(a)).toBe(b.key)
	})

	test('a wallet that does not know it opens read-only and leaves the move alone', async () => {
		const third = await userWallet(a.url)
		const status = third.getStorageStatus()
		expect(status.movedTo).toBe(b.key)
		expect(status.writable).toBe(false)
		// Not reclaimed: the old provider still names the new one.
		expect(await activeStorageIn(a)).toBe(b.key)

		await third.addRemote(b.url)
		expect(third.getStorageStatus()).toMatchObject({
			activeRemoteUrl: b.url,
			activeStorageKey: b.key,
			writable: true,
			movedTo: undefined,
		})
	})

	test('a move that moved on again is followed to the end', async () => {
		// A device that only knows B moves the wallet on to C: A names B, B names C.
		const onB = await userWallet(b.url)
		await onB.setActiveStorage(c.url)
		expect(await activeStorageIn(a)).toBe(b.key)
		expect(await activeStorageIn(b)).toBe(c.key)

		const knowsAll = await userWallet(a.url, [b.url, c.url])
		expect(knowsAll.getStorageStatus()).toMatchObject({
			activeRemoteUrl: c.url,
			writable: true,
			movedTo: undefined,
		})
		expect(await activeStorageIn(b)).toBe(c.key)

		const knowsB = await userWallet(a.url, [b.url])
		expect(knowsB.getStorageStatus()).toMatchObject({
			writable: false,
			movedTo: c.key,
		})
		// B was not re-enabled.
		expect(await activeStorageIn(b)).toBe(c.key)
		expect(await activeStorageIn(c)).toBe(c.key)
	})

	test('a switch from a stale session is refused, not forked', async () => {
		// Both devices open on C; one moves the wallet to D.
		const stale = await userWallet(c.url)
		const other = await userWallet(c.url)
		await other.setActiveStorage(d.url)
		expect(await activeStorageIn(c)).toBe(d.key)

		// The other one, still open from before, tries to move it to A.
		await expect(stale.setActiveStorage(a.url)).rejects.toThrow(
			/moved to storage/,
		)
		expect(stale.getStorageStatus().movedTo).toBe(d.key)
		expect(await activeStorageIn(c)).toBe(d.key)
		expect(await activeStorageIn(d)).toBe(d.key)

		// The wrong address is refused and not kept as a backup.
		await expect(stale.addRemote(e.url)).rejects.toThrow(/not the one/)
		expect(stale.getStorageStatus().movedTo).toBe(d.key)
		expect(stale.storage.getAllStores()).not.toContain(e.key)

		// Once it knows D it follows, and can switch from there.
		await stale.addRemote(d.url)
		expect(stale.getStorageStatus()).toMatchObject({
			activeStorageKey: d.key,
			writable: true,
			movedTo: undefined,
		})
	})

	test('a switch whose copy fails leaves the previous store active', async () => {
		const onD = await userWallet(d.url)
		const manager = onD.storage as unknown as {
			syncToWriter: (...args: unknown[]) => Promise<unknown>
		}
		const real = manager.syncToWriter.bind(manager)
		let failures = 0
		manager.syncToWriter = async (...args: unknown[]) => {
			const writer = args[1] as {
				getSettings?: () => { storageIdentityKey: string }
			}
			if (writer?.getSettings?.().storageIdentityKey === e.key) {
				failures++
				throw new Error('provider E refused the copy')
			}
			return real(...args)
		}
		await expect(onD.setActiveStorage(e.url)).rejects.toThrow(
			/refused the copy/,
		)
		expect(failures).toBeGreaterThan(0)
		expect(onD.storage.getAllStores()).not.toContain(e.key)
		expect(await activeStorageIn(d)).toBe(d.key)
		expect(onD.getStorageStatus()).toMatchObject({
			activeStorageKey: d.key,
			writable: true,
			movedTo: undefined,
		})

		manager.syncToWriter = real
		await onD.setActiveStorage(e.url)
		expect(onD.getStorageStatus()).toMatchObject({
			activeStorageKey: e.key,
			writable: true,
		})
		expect(await activeStorageIn(d)).toBe(e.key)
	})
})
