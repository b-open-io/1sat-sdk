import { describe, expect, test } from 'bun:test'
import { dispatch } from '../src/dispatch'
import type { ResolvedIdentity, WalletStorageProvider } from '../src/types'

const IDENTITY: ResolvedIdentity = { identityKey: '02'.padEnd(66, 'a') }
const ADMIN_KEY = '03'.padEnd(66, 'a')

interface StorageCall {
	method: string
	args: unknown[]
}

function makeStorage(
	overrides: Record<string, (...args: unknown[]) => unknown> = {},
): {
	storage: WalletStorageProvider
	calls: StorageCall[]
} {
	const calls: StorageCall[] = []
	const findOrInsertUser = async (_identityKey: string) => ({
		user: {
			userId: 42,
			identityKey: _identityKey,
			created_at: new Date(),
			updated_at: new Date(),
		},
		isNew: false,
	})
	const base: Record<string, (...args: unknown[]) => unknown> = {
		findOrInsertUser: (...args) => {
			calls.push({ method: 'findOrInsertUser', args })
			return findOrInsertUser(args[0] as string)
		},
		getSettings: (...args) => {
			calls.push({ method: 'getSettings', args })
			return { chain: 'main' }
		},
		listOutputs: (...args) => {
			calls.push({ method: 'listOutputs', args })
			return { totalOutputs: 0, outputs: [] }
		},
		adminStats: (...args) => {
			calls.push({ method: 'adminStats', args })
			return { ok: true }
		},
		destroy: (...args) => {
			calls.push({ method: 'destroy', args })
			return 'should-not-be-called'
		},
		...overrides,
	}
	return { storage: base as unknown as WalletStorageProvider, calls }
}

describe('dispatch', () => {
	test('returns method-not-found for unknown methods', async () => {
		const { storage } = makeStorage()
		const res = await dispatch(
			{ storage },
			{ method: 'nope', params: [], id: 1, identity: IDENTITY },
		)
		expect(res).toEqual({
			jsonrpc: '2.0',
			error: { code: -32601, message: 'Method not found: nope' },
			id: 1,
		})
	})

	test('destroy is ignored and does not invoke storage', async () => {
		const { storage, calls } = makeStorage()
		const res = await dispatch(
			{ storage },
			{ method: 'destroy', params: [], id: 2, identity: IDENTITY },
		)
		expect(res).toEqual({ jsonrpc: '2.0', result: undefined, id: 2 })
		expect(calls.find((c) => c.method === 'destroy')).toBeUndefined()
	})

	test('getSettings passes through without auth injection', async () => {
		const { storage, calls } = makeStorage()
		const res = await dispatch(
			{ storage },
			{ method: 'getSettings', params: [], id: 3, identity: IDENTITY },
		)
		expect(res).toHaveProperty('result')
		expect(calls).toContainEqual({ method: 'getSettings', args: [] })
		expect(calls.find((c) => c.method === 'findOrInsertUser')).toBeUndefined()
	})

	test('findOrInsertUser requires params[0] to match identity', async () => {
		const { storage } = makeStorage()
		const res = await dispatch(
			{ storage },
			{
				method: 'findOrInsertUser',
				params: ['other-key'],
				id: 4,
				identity: IDENTITY,
			},
		)
		expect(res).toHaveProperty('error')
		expect((res as { error: { message: string } }).error.message).toMatch(
			/authenticated user/,
		)
	})

	test('findOrInsertUser passes when params[0] matches identity', async () => {
		const { storage } = makeStorage()
		const res = await dispatch(
			{ storage },
			{
				method: 'findOrInsertUser',
				params: [IDENTITY.identityKey],
				id: 5,
				identity: IDENTITY,
			},
		)
		expect(res).toHaveProperty('result')
	})

	test('default path injects reqAuthUserId and userId', async () => {
		const { storage, calls } = makeStorage()
		const res = await dispatch(
			{ storage },
			{
				method: 'listOutputs',
				params: [{ identityKey: IDENTITY.identityKey }, { basket: 'default' }],
				id: 6,
				identity: IDENTITY,
			},
		)
		expect(res).toHaveProperty('result')
		const listCall = calls.find((c) => c.method === 'listOutputs')
		expect(listCall?.args[0]).toMatchObject({
			identityKey: IDENTITY.identityKey,
			reqAuthUserId: 42,
			userId: 42,
		})
	})

	test('default path rejects mismatched identityKey in params[0]', async () => {
		const { storage } = makeStorage()
		const res = await dispatch(
			{ storage },
			{
				method: 'listOutputs',
				params: [{ identityKey: 'different-key' }, {}],
				id: 7,
				identity: IDENTITY,
			},
		)
		expect(res).toHaveProperty('error')
		expect((res as { error: { message: string } }).error.message).toMatch(
			/does not match/,
		)
	})

	test('default path injects reqAuthUserId when params[0] has no identityKey', async () => {
		const { storage, calls } = makeStorage()
		await dispatch(
			{ storage },
			{ method: 'listOutputs', params: [{}, {}], id: 8, identity: IDENTITY },
		)
		const listCall = calls.find((c) => c.method === 'listOutputs')
		expect(listCall).toBeDefined()
		expect(listCall?.args[0]).toMatchObject({ reqAuthUserId: 42 })
		expect(
			(listCall?.args[0] as { userId?: number } | undefined)?.userId,
		).toBeUndefined()
	})

	test('adminStats rejects non-admin caller', async () => {
		const { storage } = makeStorage()
		const res = await dispatch(
			{ storage, adminIdentityKeys: [ADMIN_KEY] },
			{
				method: 'adminStats',
				params: [{ identityKey: IDENTITY.identityKey }],
				id: 9,
				identity: IDENTITY,
			},
		)
		expect(res).toHaveProperty('error')
		expect((res as { error: { message: string } }).error.message).toMatch(
			/admin/,
		)
	})

	test('adminStats accepts admin caller', async () => {
		const adminIdentity: ResolvedIdentity = { identityKey: ADMIN_KEY }
		const { storage } = makeStorage()
		const res = await dispatch(
			{ storage, adminIdentityKeys: [ADMIN_KEY] },
			{
				method: 'adminStats',
				params: [{ identityKey: ADMIN_KEY }],
				id: 10,
				identity: adminIdentity,
			},
		)
		expect(res).toHaveProperty('result')
	})
})
