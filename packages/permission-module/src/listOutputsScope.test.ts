import { describe, expect, test } from 'bun:test'
import type { ListOutputsArgs } from '@bsv/sdk'
import { handleListOutputsRequest } from './basketAccess'
import type { BasketAccessDeps } from './basketAccess'
import type { PromptHandler } from './types'
import { CommitmentCache } from './commitmentCache'

function mockStore() {
	const map = new Map<string, { expiry: number }>()
	const keyOf = (k: { type: string; originator: string; basket?: string }) =>
		`${k.type}|${k.originator}|${k.basket ?? ''}`
	return {
		async findGrant(key: {
			type: string
			originator: string
			basket?: string
		}) {
			const g = map.get(keyOf(key))
			return g
				? {
						key,
						expiry: g.expiry,
						grantedAt: 0,
					}
				: null
		},
		async putGrant(grant: {
			key: { type: string; originator: string; basket?: string }
			expiry: number
		}) {
			map.set(keyOf(grant.key), { expiry: grant.expiry })
		},
	} as BasketAccessDeps['permissionStore']
}

function deps(opts: {
	promptHandler?: PromptHandler
	adminOriginator?: string
	permissionStore?: BasketAccessDeps['permissionStore']
}) {
	return {
		wallet: {} as never,
		promptHandler: opts.promptHandler ?? (async () => true),
		cache: new CommitmentCache(60),
		schemeId: '1sat' as const,
		ownedBaskets: new Set(['1sat']),
		adminOriginator: opts.adminOriginator,
		permissionStore: opts.permissionStore,
	}
}

const COLL =
	'collection:a1b2c3d4e5f6070890abcdef1234567890abcdef1234567890abcdef12345678_0'

describe('handleListOutputsRequest scopes', () => {
	test('rejects bare p 1sat', async () => {
		await expect(
			handleListOutputsRequest(
				deps({}),
				{ basket: 'p 1sat' } as ListOutputsArgs,
				'app.example',
			),
		).rejects.toThrow(/requires a scope/)
	})

	test('rejects collection scope without axis tag', async () => {
		await expect(
			handleListOutputsRequest(
				deps({}),
				{ basket: 'p 1sat collection' } as ListOutputsArgs,
				'app.example',
			),
		).rejects.toThrow(/requires at least one collection:/)
	})

	test('normalizes collection scope; keeps tags; forces all', async () => {
		const next = await handleListOutputsRequest(
			deps({ promptHandler: async () => true }),
			{
				basket: 'p 1sat collection',
				tags: [COLL, 'type:image/png'],
				tagQueryMode: 'any',
			} as ListOutputsArgs,
			'app.example',
		)
		expect(next.basket).toBe('1sat')
		expect(next.tags).toEqual([COLL, 'type:image/png'])
		expect(next.tagQueryMode).toBe('all')
	})

	test('p 1sat all does not require axis tags', async () => {
		const next = await handleListOutputsRequest(
			deps({ promptHandler: async () => true }),
			{
				basket: 'p 1sat all',
				tags: ['type:image/png'],
				tagQueryMode: 'any',
			} as ListOutputsArgs,
			'app.example',
		)
		expect(next.basket).toBe('1sat')
		expect(next.tags).toEqual(['type:image/png'])
		expect(next.tagQueryMode).toBe('any')
	})

	test('admin skips prompt', async () => {
		let prompted = false
		await handleListOutputsRequest(
			deps({
				adminOriginator: 'admin.local',
				promptHandler: async () => {
					prompted = true
					return true
				},
			}),
			{ basket: 'p 1sat all' } as ListOutputsArgs,
			'admin.local',
		)
		expect(prompted).toBe(false)
	})

	test('p 1sat id auto-allows without view grant prompt', async () => {
		let prompted = false
		const next = await handleListOutputsRequest(
			deps({
				promptHandler: async () => {
					prompted = true
					return true
				},
			}),
			{
				basket: 'p 1sat id',
				tags: ['id:abc123'],
			} as ListOutputsArgs,
			'app.example',
		)
		expect(prompted).toBe(false)
		expect(next.basket).toBe('1sat')
		expect(next.tags).toEqual(['id:abc123'])
		expect(next.tagQueryMode).toBe('all')
	})

	test('p 1sat id requires id: tag', async () => {
		await expect(
			handleListOutputsRequest(
				deps({}),
				{ basket: 'p 1sat id' } as ListOutputsArgs,
				'app.example',
			),
		).rejects.toThrow(/requires at least one id:/)
	})

	test('collection grant is per tag value', async () => {
		const prompts: string[][] = []
		const d = deps({
			permissionStore: mockStore(),
			promptHandler: async (req) => {
				if (req.kind === 'basketAccess') {
					const baskets = req.payload.baskets as { basket: string }[]
					prompts.push(baskets.map((b) => b.basket))
				}
				return true
			},
		})
		const collB =
			'collection:b1b2c3d4e5f6070890abcdef1234567890abcdef1234567890abcdef12345678_0'

		await handleListOutputsRequest(
			d,
			{ basket: 'p 1sat collection', tags: [COLL] } as ListOutputsArgs,
			'app.example',
		)
		expect(prompts).toHaveLength(1)
		expect(prompts[0][0]).toContain('a1b2c3d4')

		prompts.length = 0
		await handleListOutputsRequest(
			d,
			{ basket: 'p 1sat collection', tags: [COLL] } as ListOutputsArgs,
			'app.example',
		)
		expect(prompts).toHaveLength(0)

		await handleListOutputsRequest(
			d,
			{ basket: 'p 1sat collection', tags: [collB] } as ListOutputsArgs,
			'app.example',
		)
		expect(prompts).toHaveLength(1)
		expect(prompts[0][0]).toContain('b1b2c3d4')
	})
})
