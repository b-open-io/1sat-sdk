import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { WalletInterface } from '@bsv/sdk'
import { createSigmaCWIReceiver } from '../../src/cwi/sigma-receiver'
import { CWIEventName } from '../../src/cwi/types'

const fireMessage = (
	target: EventTarget,
	data: unknown,
	source: unknown,
	origin = 'https://dapp.test',
) => {
	const event = new Event('message') as MessageEvent
	Object.assign(event, { data, origin, source })
	target.dispatchEvent(event)
}

describe('createSigmaCWIReceiver', () => {
	let target: EventTarget
	let dispose: (() => void) | undefined

	beforeEach(() => {
		target = new EventTarget()
	})
	afterEach(() => dispose?.())

	it('dispatches CWI requests like web-receiver', async () => {
		const wallet = {
			getVersion: mock(async () => ({ version: '1.0.0' })),
		} as unknown as WalletInterface
		const posted: unknown[] = []
		const parent = { postMessage: (d: unknown) => posted.push(d) }

		const receiver = createSigmaCWIReceiver(wallet, {
			target,
			allowedOrigins: ['https://dapp.test'],
		})
		dispose = receiver.dispose

		fireMessage(
			target,
			{
				type: 'CWI',
				isInvocation: true,
				id: 'r-1',
				call: CWIEventName.GET_VERSION,
				args: {},
			},
			parent,
		)

		await new Promise((r) => setTimeout(r, 10))
		expect(posted).toHaveLength(1)
	})

	it('forwards origin as originator to the wallet method', async () => {
		const spy = mock(async () => ({ version: '1.0.0' }))
		const wallet = { getVersion: spy } as unknown as WalletInterface
		const parent = { postMessage: () => {} }

		const receiver = createSigmaCWIReceiver(wallet, {
			target,
			allowedOrigins: ['https://dapp.test'],
		})
		dispose = receiver.dispose

		fireMessage(
			target,
			{
				type: 'CWI',
				isInvocation: true,
				id: 'r-2',
				call: CWIEventName.GET_VERSION,
				args: { x: 1 },
			},
			parent,
		)

		await new Promise((r) => setTimeout(r, 10))
		expect(spy).toHaveBeenCalledWith({ x: 1 }, 'https://dapp.test')
	})

	it('routes non-CWI messages to onCustomMessage', async () => {
		const wallet = {} as unknown as WalletInterface
		const received: Array<{ type: string; payload: unknown; origin: string }> =
			[]

		const receiver = createSigmaCWIReceiver(wallet, {
			target,
			allowedOrigins: ['https://dapp.test'],
			onCustomMessage: (m) => received.push(m),
		})
		dispose = receiver.dispose

		fireMessage(target, { type: 'SET_IDENTITY', payload: { pk: 'abc' } }, null)

		await new Promise((r) => setTimeout(r, 10))
		expect(received).toEqual([
			{
				type: 'SET_IDENTITY',
				payload: { pk: 'abc' },
				origin: 'https://dapp.test',
			},
		])
	})
})
