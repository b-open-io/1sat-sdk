import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { WalletInterface } from '@bsv/sdk'
import { createWalletSession } from '../src/walletSession'

function mockWallet(opts: {
	authenticated?: boolean
	identityKey?: string
	isAuthenticatedImpl?: () => Promise<{ authenticated: boolean }>
	getPublicKeyImpl?: () => Promise<{ publicKey: string }>
}): WalletInterface & { setIdentity: (n: string) => void } {
	let identity = opts.identityKey ?? 'key-a'
	return {
		isAuthenticated:
			opts.isAuthenticatedImpl ??
			(async () => ({ authenticated: opts.authenticated ?? true })),
		getPublicKey:
			opts.getPublicKeyImpl ?? (async () => ({ publicKey: identity })),
		setIdentity(next: string) {
			identity = next
		},
	} as WalletInterface & { setIdentity: (n: string) => void }
}

describe('createWalletSession', () => {
	const sessions: Array<ReturnType<typeof createWalletSession>> = []

	afterEach(() => {
		for (const s of sessions) {
			s.stop()
			if (s.status === 'connected') s.disconnect()
		}
		sessions.length = 0
	})

	function track(
		result: Parameters<typeof createWalletSession>[0],
		options?: Parameters<typeof createWalletSession>[1],
	) {
		const session = createWalletSession(result, options)
		sessions.push(session)
		return session
	}

	it('emits identityChange when a different identity key is returned', async () => {
		const wallet = mockWallet({ identityKey: 'key-a' })
		const disconnect = mock(() => {})
		const session = track(
			{
				wallet,
				identityKey: 'key-a',
				provider: 'brc100',
				disconnect,
			},
			{ pollIntervalMs: 20 },
		)

		const changes: Array<{ previous: string; next: string }> = []
		session.on('identityChange', (e) => changes.push(e))
		session.start()

		wallet.setIdentity('key-b')
		await Bun.sleep(50)

		expect(changes).toEqual([{ previous: 'key-a', next: 'key-b' }])
		expect(session.identityKey).toBe('key-b')
		expect(session.status).toBe('connected')
		expect(disconnect).not.toHaveBeenCalled()
	})

	it('does not call getPublicKey when unauthenticated', async () => {
		const getPublicKey = mock(async () => ({ publicKey: 'key-a' }))
		const wallet = mockWallet({
			isAuthenticatedImpl: async () => ({ authenticated: false }),
			getPublicKeyImpl: getPublicKey,
		})
		const disconnect = mock(() => {})
		const session = track(
			{
				wallet,
				identityKey: 'key-a',
				provider: 'brc100',
				disconnect,
			},
			{ pollIntervalMs: 20 },
		)

		const reasons: string[] = []
		session.on('disconnected', (e) => reasons.push(e.reason))
		session.start()
		await Bun.sleep(50)

		expect(getPublicKey).not.toHaveBeenCalled()
		expect(reasons).toEqual(['unauthenticated'])
		expect(session.status).toBe('disconnected')
		expect(session.identityKey).toBeNull()
		expect(session.wallet).toBeNull()
		expect(disconnect).toHaveBeenCalledTimes(1)
	})

	it('disconnects as unavailable when isAuthenticated throws', async () => {
		const wallet = mockWallet({
			isAuthenticatedImpl: async () => {
				throw new Error('no substrate')
			},
		})
		const disconnect = mock(() => {})
		const session = track(
			{
				wallet,
				identityKey: 'key-a',
				provider: 'brc100',
				disconnect,
			},
			{ pollIntervalMs: 20 },
		)

		const reasons: string[] = []
		session.on('disconnected', (e) => reasons.push(e.reason))
		session.start()
		await Bun.sleep(50)

		expect(reasons).toEqual(['unavailable'])
		expect(session.status).toBe('disconnected')
		expect(disconnect).toHaveBeenCalledTimes(1)
	})

	it('manual disconnect stops polling and emits disconnected', async () => {
		const getPublicKey = mock(async () => ({ publicKey: 'key-a' }))
		const wallet = mockWallet({
			getPublicKeyImpl: getPublicKey,
		})
		const disconnect = mock(() => {})
		const session = track({
			wallet,
			identityKey: 'key-a',
			provider: 'brc100',
			disconnect,
		})

		const reasons: string[] = []
		session.on('disconnected', (e) => reasons.push(e.reason))
		session.start()
		session.disconnect()
		await Bun.sleep(30)

		expect(reasons).toEqual(['manual'])
		expect(session.status).toBe('disconnected')
		expect(disconnect).toHaveBeenCalledTimes(1)
		expect(getPublicKey).not.toHaveBeenCalled()
	})

	it('stop prevents further polls without clearing identity', async () => {
		const wallet = mockWallet({ identityKey: 'key-a' })
		const session = track(
			{
				wallet,
				identityKey: 'key-a',
				provider: 'brc100',
				disconnect: () => {},
			},
			{ pollIntervalMs: 20 },
		)

		const changes: unknown[] = []
		session.on('identityChange', (e) => changes.push(e))
		session.start()
		session.stop()
		wallet.setIdentity('key-b')
		await Bun.sleep(50)

		expect(changes).toEqual([])
		expect(session.identityKey).toBe('key-a')
		expect(session.status).toBe('connected')
	})

	it('start is idempotent', async () => {
		let intervalCalls = 0
		const original = globalThis.setInterval
		globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
			intervalCalls += 1
			return original(...args)
		}) as typeof setInterval

		try {
			const session = track({
				wallet: mockWallet({}),
				identityKey: 'key-a',
				provider: 'brc100',
				disconnect: () => {},
			})
			session.start()
			session.start()
			expect(intervalCalls).toBe(1)
		} finally {
			globalThis.setInterval = original
		}
	})
})
