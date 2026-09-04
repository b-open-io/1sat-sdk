import { afterEach, describe, expect, it } from 'bun:test'
import { createWebCWI } from '../../src/cwi/web'

const originalWindow = globalThis.window
const originalDocument = globalThis.document

const setBrowserGlobals = (
	windowValue: unknown,
	documentValue: unknown,
): void => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		writable: true,
		value: windowValue,
	})
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		writable: true,
		value: documentValue,
	})
}

afterEach(() => setBrowserGlobals(originalWindow, originalDocument))

describe('web CWI browser transport', () => {
	it('uses a top-level wallet window when Storage Access is unavailable', () => {
		let openedUrl = ''
		let closed = false
		const popup = {
			closed: false,
			close: () => {
				closed = true
			},
			postMessage: () => {},
		}
		setBrowserGlobals(
			{
				addEventListener: () => {},
				removeEventListener: () => {},
				open: (url: string) => {
					openedUrl = url
					return popup
				},
				screen: { width: 1200, height: 900 },
			},
			{},
		)

		const connection = createWebCWI({ walletUrl: 'https://wallet.example' })
		expect(openedUrl).toBe('https://wallet.example/wallet/cwi')
		connection.destroy()
		expect(closed).toBe(true)
	})

	it('exposes an interactive iframe only while wallet UI is visible', () => {
		const attributes = new Map<string, string>()
		let messageHandler: ((event: MessageEvent) => void) | undefined
		const bridgeWindow = { postMessage: () => {} }
		const iframe = {
			contentWindow: bridgeWindow,
			parentNode: { removeChild: () => {} },
			removeAttribute: (name: string) => attributes.delete(name),
			setAttribute: (name: string, value: string) =>
				attributes.set(name, value),
			style: {} as Record<string, string>,
			title: '',
			src: '',
		}
		setBrowserGlobals(
			{
				addEventListener: (
					_type: string,
					handler: (event: MessageEvent) => void,
				) => {
					messageHandler = handler
				},
				removeEventListener: () => {},
				screen: { width: 1200, height: 900 },
			},
			{
				requestStorageAccess: () => {},
				createElement: () => iframe,
				body: { appendChild: () => {} },
			},
		)

		const connection = createWebCWI({ walletUrl: 'https://wallet.example' })
		expect(iframe.title).toBe('1Sat Wallet connection')
		expect(attributes.get('allow')).toBe('storage-access')
		expect(attributes.get('aria-hidden')).toBe('true')

		messageHandler?.({
			origin: 'https://wallet.example',
			source: bridgeWindow,
			data: { type: 'CWI', cwiState: { hasPermission: true } },
		} as unknown as MessageEvent)
		expect(attributes.has('aria-hidden')).toBe(false)
		expect(iframe.style.width).toBe('100%')

		messageHandler?.({
			origin: 'https://wallet.example',
			source: bridgeWindow,
			data: { type: 'CWI', cwiState: { hasPermission: false } },
		} as unknown as MessageEvent)
		expect(attributes.get('aria-hidden')).toBe('true')
		expect(iframe.style.width).toBe('0')
		connection.destroy()
	})
})
