import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WalletInterface } from '@bsv/sdk'
import { Utils } from '@bsv/sdk'
import { CLI_ADMIN_ORIGINATOR } from '../src/wallet-api/admin'
import {
	type WalletApiHandle,
	startWalletApi,
} from '../src/wallet-api/endpoint'
import { FilePermissionStore } from '../src/wallet-api/permission-store'

/**
 * Stand-in for the toolbox wallet: answers the calls the permissions
 * manager makes while looking for on-chain tokens (none) and records what
 * it was handed for the app-facing call.
 */
function mockWallet() {
	const originators: Array<string | undefined> = []
	const created: Array<Record<string, unknown>> = []
	const wallet = {
		async getPublicKey(_args: unknown, originator?: string) {
			originators.push(originator)
			return { publicKey: '02aa' }
		},
		async listOutputs() {
			return { totalOutputs: 0, outputs: [] }
		},
		async listActions() {
			return { totalActions: 0, actions: [] }
		},
		async getVersion() {
			return { version: 'mock' }
		},
		async encrypt(args: { plaintext: number[] }) {
			// Reversible stand-in for the metadata encryption key.
			return { ciphertext: args.plaintext.map((b) => b ^ 0x5a) }
		},
		async createAction(args: Record<string, unknown>, originator?: string) {
			originators.push(originator)
			created.push(args)
			return { txid: 'ab'.repeat(32), tx: [], noSendChange: [] }
		},
	} as unknown as WalletInterface
	return { wallet, originators, created }
}

function portOf(api: WalletApiHandle): number {
	const address = api.server.server.address()
	if (!address || typeof address === 'string') throw new Error('no port')
	return address.port
}

async function call(
	api: WalletApiHandle,
	method: string,
	body: unknown,
	origin: string,
) {
	const res = await fetch(`http://127.0.0.1:${portOf(api)}/${method}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: origin },
		body: JSON.stringify(body),
	})
	return {
		status: res.status,
		body: (await res.json()) as Record<string, unknown>,
	}
}

describe('startWalletApi', () => {
	let dir: string
	let storePath: string

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), '1sat-wallet-api-'))
		storePath = join(dir, 'permissions-test.json')
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
	})

	const start = (
		wallet: WalletInterface,
		grantCommandPrefix?: string,
	): Promise<WalletApiHandle> =>
		startWalletApi({
			wallet,
			storePath,
			host: '127.0.0.1',
			port: 0,
			grantCommandPrefix,
			// Manifest lookups would reach the network for the app's origin.
			managerConfig: { seekGroupedPermission: false },
			log: () => {},
		})

	test('an ungranted call is denied with the command that would allow it', async () => {
		const { wallet, originators } = mockWallet()
		const api = await start(wallet)
		try {
			const res = await call(
				api,
				'getPublicKey',
				{ identityKey: true },
				'http://gib',
			)
			expect(res.status).toBe(400)
			expect(res.body).toEqual({
				error:
					'permission denied for gib: run `1sat permissions grant gib --protocol "identity key retrieval" --level 1` and retry',
			})
			// Nothing reached the underlying wallet.
			expect(originators).toEqual([])
		} finally {
			await api.close()
		}
	})

	test('the denial carries the global flags the server was started with', async () => {
		const { wallet } = mockWallet()
		const api = await start(wallet, '1sat --chain test permissions grant')
		try {
			const res = await call(
				api,
				'getPublicKey',
				{ identityKey: true },
				'http://gib',
			)
			expect(String(res.body.error)).toBe(
				'permission denied for gib: run `1sat --chain test permissions grant gib --protocol "identity key retrieval" --level 1` and retry',
			)
		} finally {
			await api.close()
		}
	})

	test('a grant written while the server runs applies to the next call', async () => {
		const { wallet, originators } = mockWallet()
		const api = await start(wallet)
		try {
			const denied = await call(
				api,
				'getPublicKey',
				{ identityKey: true },
				'http://gib',
			)
			expect(denied.status).toBe(400)

			// Exactly what the denial told the caller to run, applied to the
			// same file `1sat permissions grant` writes. No restart.
			await new FilePermissionStore(storePath).putGrant({
				key: {
					type: 'protocol',
					originator: 'gib',
					privileged: false,
					protocolLevel: 1,
					protocolName: 'identity key retrieval',
					counterparty: '',
				},
				expiry: 0,
				grantedAt: Date.now(),
			})

			const allowed = await call(
				api,
				'getPublicKey',
				{ identityKey: true },
				'http://gib',
			)
			expect(allowed.status).toBe(200)
			expect(allowed.body).toEqual({ publicKey: '02aa' })
			expect(originators).toEqual(['gib'])

			// The grant is for one origin only.
			const other = await call(
				api,
				'getPublicKey',
				{ identityKey: true },
				'http://bitplan.dev',
			)
			expect(other.status).toBe(400)
			expect(String(other.body.error)).toContain(
				'1sat permissions grant bitplan.dev',
			)
		} finally {
			await api.close()
		}
	})

	test('rejects the admin originator on the wire', async () => {
		const { wallet, originators } = mockWallet()
		const api = await start(wallet)
		try {
			const res = await call(
				api,
				'getPublicKey',
				{ identityKey: true },
				`http://${CLI_ADMIN_ORIGINATOR}`,
			)
			expect(res.status).toBe(400)
			expect(res.body).toEqual({
				error: 'Origin is reserved for the wallet itself',
			})
			expect(originators).toEqual([])
		} finally {
			await api.close()
		}
	})

	test('the served manager encrypts transaction metadata', async () => {
		const { wallet, created } = mockWallet()
		const api = await start(wallet)
		try {
			const res = await call(
				api,
				'createAction',
				{ description: 'push refs/heads/main', outputs: [] },
				'http://gib',
			)
			expect(res.status).toBe(200)
			expect(created).toHaveLength(1)
			const description = created[0].description as string
			expect(description).not.toBe('push refs/heads/main')
			expect(
				Utils.toUTF8(Utils.toArray(description, 'base64').map((b) => b ^ 0x5a)),
			).toBe('push refs/heads/main')
		} finally {
			await api.close()
		}
	})
})
