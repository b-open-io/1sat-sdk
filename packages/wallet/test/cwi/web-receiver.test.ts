import type { WalletInterface } from '@bsv/sdk'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createWebCWIReceiver } from '../../src/cwi/web-receiver'
import { CWIEventName } from '../../src/cwi/types'

interface PostedEnvelope {
	data: unknown
	targetOrigin: string
}

const postedMessages: PostedEnvelope[] = []
const parent = {
	postMessage: (data: unknown, targetOrigin: string) => {
		postedMessages.push({ data, targetOrigin })
	},
}

describe('createWebCWIReceiver', () => {
	let target: EventTarget
	let dispose: (() => void) | undefined

	beforeEach(() => {
		postedMessages.length = 0
		target = new EventTarget()
	})
	afterEach(() => dispose?.())

	const fireMessage = (
		data: unknown,
		source: unknown = parent,
		origin = 'https://dapp.test',
	) => {
		const event = new Event('message') as MessageEvent
		Object.assign(event, { data, origin, source })
		target.dispatchEvent(event)
	}

	it('responds to valid BRC-100 envelopes', async () => {
		const wallet = {
			getVersion: mock(async () => ({ version: '1.0.0' })),
		} as unknown as WalletInterface
		const receiver = createWebCWIReceiver(wallet, {
			target,
			allowedOrigins: ['https://dapp.test'],
		})
		dispose = receiver.dispose

		fireMessage({
			type: 'CWI',
			isInvocation: true,
			id: 'r-1',
			call: CWIEventName.GET_VERSION,
			args: {},
		})

		await new Promise((r) => setTimeout(r, 10))
		expect(postedMessages).toHaveLength(1)
		expect(postedMessages[0].data).toMatchObject({
			type: 'CWI',
			isInvocation: false,
			id: 'r-1',
			result: { version: '1.0.0' },
		})
	})

	it('forwards the message origin as originator', async () => {
		const spy = mock(async () => ({ version: '1.0.0' }))
		const wallet = { getVersion: spy } as unknown as WalletInterface
		const receiver = createWebCWIReceiver(wallet, {
			target,
			allowedOrigins: ['https://dapp.test'],
		})
		dispose = receiver.dispose

		fireMessage({
			type: 'CWI',
			isInvocation: true,
			id: 'r-ok',
			call: CWIEventName.GET_VERSION,
			args: { x: 1 },
		})

		await new Promise((r) => setTimeout(r, 10))
		expect(spy).toHaveBeenCalledWith({ x: 1 }, 'https://dapp.test')
	})

	it('drops envelopes whose call is not in CWIEventName', async () => {
		const wallet = {
			getVersion: mock(async () => ({})),
		} as unknown as WalletInterface
		const receiver = createWebCWIReceiver(wallet, {
			target,
			allowedOrigins: ['https://dapp.test'],
		})
		dispose = receiver.dispose

		fireMessage({
			type: 'CWI',
			isInvocation: true,
			id: 'r-2',
			call: 'MASTER_BACKUP',
			args: {},
		})

		await new Promise((r) => setTimeout(r, 10))
		expect(postedMessages).toHaveLength(0)
	})

	it('drops messages whose origin is not in allowedOrigins', async () => {
		const wallet = {
			getVersion: mock(async () => ({ version: '1' })),
		} as unknown as WalletInterface
		const receiver = createWebCWIReceiver(wallet, {
			target,
			allowedOrigins: ['https://dapp.test'],
		})
		dispose = receiver.dispose

		fireMessage(
			{
				type: 'CWI',
				isInvocation: true,
				id: 'r-3',
				call: CWIEventName.GET_VERSION,
				args: {},
			},
			parent,
			'https://evil.test',
		)

		await new Promise((r) => setTimeout(r, 10))
		expect(postedMessages).toHaveLength(0)
	})
})
