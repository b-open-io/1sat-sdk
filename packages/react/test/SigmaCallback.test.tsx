import { expect, mock, test } from 'bun:test'

const react = await import('react')
const effects: Array<() => void> = []
const exchange = mock(async () => ({ bapId: 'test-identity' }))
const connect = mock(async () => ({ providerType: 'sigma' }))
const apply = mock(() => {})
const complete = mock(() => {})
const errors: unknown[] = []
mock.module('react', () => ({
	...react,
	useRef: (current: unknown) => ({ current }),
	useState: (value: unknown) => [value, (next: unknown) => errors.push(next)],
	useEffect: (effect: () => void) => effects.push(effect),
}))
mock.module('@1sat/connect', () => ({
	completeSigmaOAuth: exchange,
	connectSigmaWallet: connect,
}))
mock.module('../src/wallet-context', () => ({
	useWallet: () => ({ applyResult: apply }),
	clearSigmaGuard: () => {},
}))
const { SigmaCallback } = await import('../src/SigmaCallback')

test('effect replay consumes the OAuth code and connects the wallet once', async () => {
	Object.assign(globalThis, {
		window: { location: { search: '?code=test&state=test' } },
	})
	SigmaCallback({ onComplete: complete })
	effects[0]()
	effects[0]()
	await new Promise((resolve) => setTimeout(resolve, 0))
	expect(exchange).toHaveBeenCalledTimes(1)
	expect(connect).toHaveBeenCalledTimes(1)
	expect(apply).toHaveBeenCalledTimes(1)
	expect(complete).toHaveBeenCalledTimes(1)
	expect(errors).toEqual(['Connecting wallet...'])
})
