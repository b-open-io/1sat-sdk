import { describe, expect, test } from 'bun:test'
import { isSecretConfigKey, maskSecrets } from '../src/commands/config.js'

describe('config secret masking', () => {
	test('recognizes key, token, password and database URL paths', () => {
		for (const path of [
			'broadcast.arcApiKey',
			'broadcast.whatsOnChainApiKey',
			'server.callbackToken',
			'server.storage.dbUrl',
			'x.password',
		]) {
			expect(isSecretConfigKey(path)).toBe(true)
		}
		for (const path of ['broadcast.arcUrl', 'broadcast.failover', 'chain']) {
			expect(isSecretConfigKey(path)).toBe(false)
		}
	})

	test('masks secret values and leaves the rest', () => {
		const masked = maskSecrets(
			{
				chain: 'main',
				broadcast: { failover: true, arcUrl: '', arcApiKey: 'secret-1' },
				server: { storage: { provider: 'pg', dbUrl: 'postgres://u:p@h/db' } },
			},
			'',
		)
		expect(masked).toEqual({
			chain: 'main',
			broadcast: { failover: true, arcUrl: '', arcApiKey: '(set, hidden)' },
			server: { storage: { provider: 'pg', dbUrl: '(set, hidden)' } },
		})
	})
})
