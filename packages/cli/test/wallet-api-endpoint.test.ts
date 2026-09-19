import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { WalletInterface } from '@bsv/sdk'
import { CLI_ADMIN_ORIGINATOR } from '../src/wallet-api/admin'
import {
	type WalletApiHandle,
	startWalletApi,
} from '../src/wallet-api/endpoint'
import { FilePermissionStore } from '../src/wallet-api/permission-store'
import { NOT_INTERACTIVE_MESSAGE } from '../src/wallet-api/prompts'

/**
 * Stand-in for the toolbox wallet: answers the calls the permissions
 * manager makes while looking for on-chain tokens (none) and records the
 * originator it was handed for the app-facing call.
 */
function mockWallet() {
	const originators: Array<string | undefined> = []
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
	} as unknown as WalletInterface
	return { wallet, originators }
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

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), '1sat-wallet-api-'))
		storePath = join(dir, 'permissions-test.json')
	})

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true })
	})

	test('denies with the interactive hint when no TTY is attached', async () => {
		const { wallet, originators } = mockWallet()
		const api = await startWalletApi({
			wallet,
			storePath,
			host: '127.0.0.1',
			port: 0,
			prompts: { interactive: false },
			managerConfig: { seekGroupedPermission: false },
			log: () => {},
		})
		try {
			const res = await call(
				api,
				'getPublicKey',
				{ identityKey: true },
				'http://gib',
			)
			expect(res.status).toBe(400)
			expect(String(res.body.error)).toContain('Permission denied.')
			expect(String(res.body.error)).toContain(NOT_INTERACTIVE_MESSAGE)
			expect(originators).toEqual([])
		} finally {
			await api.close()
		}
	})

	test('rejects the admin originator on the wire', async () => {
		const { wallet, originators } = mockWallet()
		const api = await startWalletApi({
			wallet,
			storePath,
			host: '127.0.0.1',
			port: 0,
			prompts: { interactive: false },
			managerConfig: { seekGroupedPermission: false },
			log: () => {},
		})
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

	test('a y on the terminal grants, persists, and covers the next instance', async () => {
		const { wallet, originators } = mockWallet()
		const input = new PassThrough()
		const output = new PassThrough()
		let shown = ''
		output.on('data', (chunk) => {
			shown += chunk.toString()
			if (shown.includes('Approve? [y/N]')) {
				shown = ''
				input.write('y\n')
			}
		})
		const api = await startWalletApi({
			wallet,
			storePath,
			host: '127.0.0.1',
			port: 0,
			prompts: { interactive: true, input, output },
			managerConfig: { seekGroupedPermission: false },
			log: () => {},
		})
		try {
			const res = await call(
				api,
				'getPublicKey',
				{ identityKey: true },
				'http://gib',
			)
			expect(res.status).toBe(200)
			expect(res.body).toEqual({ publicKey: '02aa' })
			expect(originators).toEqual(['gib'])
		} finally {
			await api.close()
		}

		const grants = await new FilePermissionStore(storePath).listGrants({
			originator: 'gib',
		})
		expect(grants.length).toBeGreaterThan(0)
		expect(grants.every((g) => g.key.type === 'protocol')).toBe(true)

		// Fresh manager over the same store: no prompt is possible, yet the
		// remembered grant lets the call through.
		const again = mockWallet()
		const headless = await startWalletApi({
			wallet: again.wallet,
			storePath,
			host: '127.0.0.1',
			port: 0,
			prompts: { interactive: false },
			managerConfig: { seekGroupedPermission: false },
			log: () => {},
		})
		try {
			const res = await call(
				headless,
				'getPublicKey',
				{ identityKey: true },
				'http://gib',
			)
			expect(res.status).toBe(200)
			expect(again.originators).toEqual(['gib'])
			const other = await call(
				headless,
				'getPublicKey',
				{ identityKey: true },
				'http://bitplan.dev',
			)
			expect(other.status).toBe(400)
		} finally {
			await headless.close()
		}
	})
})
