import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoredGrant } from '@1sat/wallet'

/**
 * `1sat permissions` works on the JSON store file alone: no key, no
 * wallet, no running server. Only the data directory is stubbed.
 */
const dir = mkdtempSync(join(tmpdir(), '1sat-permissions-cmd-'))
mock.module(new URL('../src/config.js', import.meta.url).pathname, () => ({
	ensureDataDir: () => dir,
}))

const { handlePermissionsCommand } = await import('../src/commands/permissions')
const storeFile = join(dir, 'permissions-main.json')

afterAll(() => {
	rmSync(dir, { recursive: true, force: true })
})

const flags = {
	json: true,
	quiet: false,
	yes: false,
	chain: 'main' as const,
	envFiles: [],
	help: false,
	version: false,
	rest: [],
}

/** Run a subcommand, returning whatever it printed as JSON. */
async function run(args: string[]): Promise<unknown> {
	const lines: string[] = []
	const original = console.log
	console.log = (line?: unknown) => {
		lines.push(String(line))
	}
	try {
		await handlePermissionsCommand(args, flags)
	} finally {
		console.log = original
	}
	return lines.length > 0 ? JSON.parse(lines.join('\n')) : undefined
}

function storedGrants(): StoredGrant[] {
	if (!existsSync(storeFile)) return []
	const file = JSON.parse(readFileSync(storeFile, 'utf8')) as {
		grants: Record<string, StoredGrant>
	}
	return Object.values(file.grants)
}

describe('1sat permissions', () => {
	beforeEach(() => {
		rmSync(storeFile, { force: true })
	})

	test('grant writes to the store file and list reads it back', async () => {
		await run([
			'grant',
			'gib',
			'--protocol',
			'gib branch',
			'--level',
			'1',
			'--counterparty',
			'anyone',
		])

		expect(storedGrants()).toEqual([
			{
				key: {
					type: 'protocol',
					originator: 'gib',
					privileged: false,
					// Level 1 protocols are counterparty-less upstream, so the
					// --counterparty the caller passed is normalized away exactly
					// as the manager would normalize it on lookup.
					protocolLevel: 1,
					protocolName: 'gib branch',
					counterparty: '',
				},
				expiry: 0,
				grantedAt: expect.any(Number),
			},
		])

		const listed = (await run(['list'])) as StoredGrant[]
		expect(listed).toHaveLength(1)
		expect(listed[0].key).toMatchObject({ originator: 'gib' })
	})

	test('one call grants several selectors', async () => {
		await run([
			'grant',
			'gib',
			'--basket',
			'gib refs',
			'--label',
			'gib push',
			'--spending',
			'50000',
			'--certificate',
			'identity',
			'--fields',
			'name,email',
			'--counterparty',
			'02ab',
		])

		const grants = storedGrants()
		expect(grants.map((g) => g.key.type).sort()).toEqual([
			'basket',
			'certificate',
			'protocol',
			'spending',
		])
		const label = grants.find((g) => g.key.type === 'protocol')
		expect(label?.key).toMatchObject({
			protocolName: 'action label gib push',
			protocolLevel: 1,
		})
		const cert = grants.find((g) => g.key.type === 'certificate')
		expect(cert?.key).toMatchObject({
			certType: 'identity',
			fields: ['email', 'name'],
			verifier: '02ab',
		})
		expect(
			grants.find((g) => g.key.type === 'spending')?.authorizedAmount,
		).toBe(50000)
	})

	test('the origin is normalized the way the manager normalizes it', async () => {
		await run(['grant', 'http://GIB:80/some/path', '--basket', 'gib refs'])
		expect(storedGrants()[0].key.originator).toBe('gib')

		const listed = (await run(['list', 'https://gib'])) as StoredGrant[]
		expect(listed).toHaveLength(1)
	})

	test('revoke removes the matching grant only', async () => {
		await run(['grant', 'gib', '--basket', 'gib refs'])
		await run(['grant', 'gib', '--basket', 'other'])
		await run(['grant', 'bitplan.dev', '--basket', 'gib refs'])

		const result = (await run(['revoke', 'gib', '--basket', 'gib refs'])) as {
			revoked: unknown[]
			notFound: unknown[]
		}
		expect(result.revoked).toHaveLength(1)
		expect(result.notFound).toHaveLength(0)

		const left = storedGrants().map(
			(g) =>
				`${g.key.originator}:${g.key.type === 'basket' ? g.key.basket : ''}`,
		)
		expect(left.sort()).toEqual(['bitplan.dev:gib refs', 'gib:other'])
	})

	test('revoke reports a selector that matches nothing', async () => {
		const result = (await run(['revoke', 'gib', '--basket', 'nope'])) as {
			revoked: unknown[]
			notFound: unknown[]
		}
		expect(result.revoked).toHaveLength(0)
		expect(result.notFound).toHaveLength(1)
	})

	test('revoke --all clears one origin', async () => {
		await run(['grant', 'gib', '--basket', 'gib refs'])
		await run(['grant', 'gib', '--spending', '1000'])
		await run(['grant', 'bitplan.dev', '--basket', 'gib refs'])

		const result = (await run(['revoke', 'gib', '--all'])) as {
			removed: number
		}
		expect(result.removed).toBe(2)
		expect(storedGrants().map((g) => g.key.originator)).toEqual(['bitplan.dev'])
	})

	test('list reports an empty store without creating one', async () => {
		const listed = (await run(['list'])) as StoredGrant[]
		expect(listed).toEqual([])
		expect(existsSync(storeFile)).toBe(false)
	})
})
