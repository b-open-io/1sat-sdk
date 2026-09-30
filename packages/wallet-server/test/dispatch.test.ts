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
		expect(res).toEqual({ jsonrpc: '2.0', result: null, id: 2 })
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

	test('AuthId methods bind the authenticated user when params[0] is empty', async () => {
		const { storage, calls } = makeStorage()
		await dispatch(
			{ storage },
			{ method: 'listOutputs', params: [{}, {}], id: 8, identity: IDENTITY },
		)
		const listCall = calls.find((c) => c.method === 'listOutputs')
		expect(listCall?.args[0]).toMatchObject({
			identityKey: IDENTITY.identityKey,
			userId: 42,
			reqAuthUserId: 42,
		})
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

	test.each([
		'dropAllData',
		'findUsers',
		'updateUser',
		'findOutputs',
		'findTransactions',
		'insertOutput',
	])('%s is not callable over RPC', async (method) => {
		const invoked: string[] = []
		const { storage } = makeStorage({
			[method]: () => {
				invoked.push(method)
				return 'should-not-be-called'
			},
		})
		const res = await dispatch(
			{ storage },
			{ method, params: [{}], id: 11, identity: IDENTITY },
		)
		expect(res).toHaveProperty('error')
		expect((res as { error: { code: number } }).error.code).toBe(-32601)
		expect(invoked).toEqual([])
	})

	test('migrate is ignored and does not invoke storage', async () => {
		const invoked: string[] = []
		const { storage } = makeStorage({
			migrate: () => {
				invoked.push('migrate')
			},
		})
		const res = await dispatch(
			{ storage },
			{
				method: 'migrate',
				params: ['name', 'key'],
				id: 12,
				identity: IDENTITY,
			},
		)
		expect(res).toEqual({ jsonrpc: '2.0', result: null, id: 12 })
		expect(invoked).toEqual([])
	})

	test('AuthId methods replace a spoofed userId and isActive', async () => {
		const { storage, calls } = makeStorage()
		await dispatch(
			{ storage },
			{
				method: 'listOutputs',
				params: [{ userId: 7, isActive: true }, {}],
				id: 13,
				identity: IDENTITY,
			},
		)
		const listCall = calls.find((c) => c.method === 'listOutputs')
		expect(listCall?.args[0]).toMatchObject({ userId: 42, isActive: false })
	})

	test('non-AuthId methods replace a spoofed userId', async () => {
		const { storage, calls } = makeStorage({
			getSyncChunk: (...args) => {
				calls.push({ method: 'getSyncChunk', args })
				return {}
			},
		})
		await dispatch(
			{ storage },
			{
				method: 'getSyncChunk',
				params: [{ userId: 7 }],
				id: 14,
				identity: IDENTITY,
			},
		)
		const call = calls.find((c) => c.method === 'getSyncChunk')
		expect(call?.args[0]).toMatchObject({ userId: 42, reqAuthUserId: 42 })
	})

	test('findProvenTxReqs is served by findProvenTxReqsAuth for the authenticated user', async () => {
		const unscoped: unknown[] = []
		const { storage, calls } = makeStorage({
			findProvenTxReqs: (...args) => {
				unscoped.push(args)
				return []
			},
			findProvenTxReqsAuth: (...args) => {
				calls.push({ method: 'findProvenTxReqsAuth', args })
				return []
			},
		})
		await dispatch(
			{ storage },
			{
				method: 'findProvenTxReqs',
				params: [{ partial: {} }],
				id: 15,
				identity: IDENTITY,
			},
		)
		expect(unscoped).toEqual([])
		const call = calls.find((c) => c.method === 'findProvenTxReqsAuth')
		expect(call?.args).toEqual([
			{ identityKey: IDENTITY.identityKey, userId: 42, isActive: false },
			{ partial: {}, paged: { limit: 1000, offset: 0 } },
		])
	})

	test('active-storage methods require this store to be active for the user', async () => {
		const invoked: string[] = []
		const { storage } = makeStorage({
			beginActionBatch: () => {
				invoked.push('beginActionBatch')
				return {}
			},
		})
		const res = await dispatch(
			{ storage },
			{
				method: 'beginActionBatch',
				params: [{}, {}],
				id: 16,
				identity: IDENTITY,
			},
		)
		expect((res as { error: { name?: string } }).error.name).toBe(
			'WERR_NOT_ACTIVE',
		)
		expect(invoked).toEqual([])
	})

	test('settings omit a dbtype the toolbox client rejects and advertise the sync checkpoint', async () => {
		const { storage } = makeStorage({
			makeAvailable: () => ({
				storageIdentityKey: 'k',
				dbtype: 'Postgres',
				chain: 'main',
			}),
			getSyncCheckpoint: () => ({}),
		})
		const res = await dispatch(
			{ storage },
			{ method: 'makeAvailable', params: [], id: 17, identity: IDENTITY },
		)
		expect((res as { result: unknown }).result).toEqual({
			storageIdentityKey: 'k',
			chain: 'main',
			syncCheckpointVersion: 1,
		})
	})

	test('settings keep a dbtype the toolbox client accepts', async () => {
		const { storage } = makeStorage({
			getSettings: () => ({ storageIdentityKey: 'k', dbtype: 'SQLite' }),
		})
		const res = await dispatch(
			{ storage },
			{ method: 'getSettings', params: [], id: 18, identity: IDENTITY },
		)
		expect((res as { result: { dbtype?: string } }).result.dbtype).toBe(
			'SQLite',
		)
	})

	test('internal errors reach onError but clients only see WERR_INTERNAL', async () => {
		const seen: unknown[] = []
		const { storage } = makeStorage({
			listOutputs: () => {
				throw new Error('relation "outputs" does not exist')
			},
		})
		const res = await dispatch(
			{ storage, onError: (err) => seen.push(err) },
			{ method: 'listOutputs', params: [{}, {}], id: 19, identity: IDENTITY },
		)
		const error = (res as { error: { name: string; message: string } }).error
		expect(error.name).toBe('WERR_INTERNAL')
		expect(error.message).not.toContain('outputs')
		expect((seen[0] as Error).message).toContain('does not exist')
	})

	test('list limits above the BRC-100 maximum are refused', async () => {
		const { storage } = makeStorage()
		const res = await dispatch(
			{ storage },
			{
				method: 'listOutputs',
				params: [{}, { limit: 10_001 }],
				id: 20,
				identity: IDENTITY,
			},
		)
		expect((res as { error: { name: string } }).error.name).toBe(
			'WERR_INVALID_PARAMETER',
		)
	})
})
