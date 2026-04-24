import type { WalletInterface } from '@bsv/sdk'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createChromeCWIReceiver } from '../../src/cwi/chrome-receiver'
import { CWIEventName } from '../../src/cwi/types'

type Listener = (
	msg: unknown,
	sender: unknown,
	sendResponse: (r: unknown) => void,
) => boolean | void

let listener: Listener | null = null
const chromeMock = {
	runtime: {
		onMessage: {
			addListener: (l: Listener) => {
				listener = l
			},
			removeListener: (l: Listener) => {
				if (listener === l) listener = null
			},
		},
	},
}

describe('createChromeCWIReceiver', () => {
	beforeEach(() => {
		listener = null
		;(globalThis as unknown as { chrome: unknown }).chrome = chromeMock
	})
	afterEach(() => {
		;(globalThis as unknown as { chrome?: unknown }).chrome = undefined
	})

	it('dispatches valid actions', async () => {
		const wallet = {
			getVersion: mock(async () => ({ version: '1.0.0' })),
		} as unknown as WalletInterface
		const receiver = createChromeCWIReceiver(wallet)
		const response = await new Promise((resolve) => {
			listener?.(
				{ action: CWIEventName.GET_VERSION, params: {}, originator: 'test' },
				{},
				resolve,
			)
		})
		expect(response).toEqual({ success: true, data: { version: '1.0.0' } })
		receiver.dispose()
	})

	it('forwards originator to wallet method', async () => {
		const spy = mock(async () => ({ version: '1.0.0' }))
		const wallet = {
			getVersion: spy,
		} as unknown as WalletInterface
		const receiver = createChromeCWIReceiver(wallet)
		await new Promise((resolve) => {
			listener?.(
				{
					action: CWIEventName.GET_VERSION,
					params: { a: 1 },
					originator: 'dapp.example.com',
				},
				{},
				resolve,
			)
		})
		expect(spy).toHaveBeenCalledWith({ a: 1 }, 'dapp.example.com')
		receiver.dispose()
	})

	it('ignores messages with non-CWI action (does not call sendResponse)', async () => {
		const wallet = {
			getVersion: mock(async () => ({})),
		} as unknown as WalletInterface
		const receiver = createChromeCWIReceiver(wallet)
		let called = false
		const rc = listener?.(
			{ action: 'MASTER_BACKUP', params: {}, originator: 'test' },
			{},
			() => {
				called = true
			},
		)
		await new Promise((r) => setTimeout(r, 10))
		expect(called).toBe(false)
		expect(rc).toBe(false)
		receiver.dispose()
	})
})
