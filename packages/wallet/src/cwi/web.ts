/**
 * CWI Web Transport - For remote web wallets via iframe/postMessage
 * Creates a hidden iframe to the wallet host and communicates via postMessage.
 */

import type { WalletInterface } from '@bsv/sdk'
import { type CWITransport, createCWI } from './factory'
import type { CWIEventName } from './types'

const DEFAULT_WALLET_URL = 'https://1sat.market'
const DEFAULT_IFRAME_PATH = '/wallet/cwi'
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000

export interface WebCWIConfig {
	/** Base URL for wallet host (default: https://1sat.market) */
	walletUrl?: string
	/** Iframe path on wallet host (default: /wallet/cwi) */
	iframePath?: string
	/** Request timeout in milliseconds (default: 120000) */
	timeout?: number
	/** Handshake timeout in milliseconds (default: 5000) */
	handshakeTimeout?: number
}

export interface WebCWIResult {
	wallet: WalletInterface
	destroy: () => void
}

interface PendingRequest {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
	timeoutId: ReturnType<typeof setTimeout>
}

interface CWIRequestMessage {
	type: 'CWI'
	isInvocation: true
	id: string
	call: string
	args?: unknown
}

interface CWIResponseMessage {
	type: 'CWI'
	isInvocation: false
	id: string
	result?: unknown
	status?: 'error'
	description?: string
	code?: number
}

interface CWIStateMessage {
	type: 'CWI'
	cwiState: {
		status?: string
		hasPermission?: boolean
		fallbackRecommended?: boolean
		reason?: string
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null

const isResponse = (v: unknown): v is CWIResponseMessage =>
	isRecord(v) && v.type === 'CWI' && v.isInvocation === false && typeof v.id === 'string'

const isState = (v: unknown): v is CWIStateMessage =>
	isRecord(v) && v.type === 'CWI' && isRecord(v.cwiState)

const createId = (): string =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`

/**
 * Create a WalletInterface backed by a remote web wallet via iframe/postMessage.
 *
 * Returns { wallet, destroy }. Call destroy() to remove the iframe and clean up listeners.
 */
export function createWebCWI(config?: WebCWIConfig): WebCWIResult {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		throw new Error('createWebCWI requires a browser environment')
	}

	const walletUrl = config?.walletUrl ?? DEFAULT_WALLET_URL
	const iframePath = config?.iframePath ?? DEFAULT_IFRAME_PATH
	const requestTimeout = config?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS
	const handshakeTimeout = config?.handshakeTimeout ?? DEFAULT_HANDSHAKE_TIMEOUT_MS

	const walletOrigin = new URL(walletUrl).origin
	const iframeUrl = new URL(iframePath, walletUrl).toString()

	const pending = new Map<string, PendingRequest>()
	let iframe: HTMLIFrameElement | null = null
	let destroyed = false
	let handshakeResolve: (() => void) | null = null
	let handshakeReject: ((err: Error) => void) | null = null
	let handshakeComplete = false

	const handleMessage = (event: MessageEvent): void => {
		if (destroyed) return
		if (event.origin !== walletOrigin) return

		const iframeWindow = iframe?.contentWindow
		if (!iframeWindow || event.source !== iframeWindow) return

		const data = event.data

		if (isState(data)) {
			if (data.cwiState.fallbackRecommended) {
				handshakeReject?.(new Error('Web wallet indicated fallback recommended'))
				handshakeResolve = null
				handshakeReject = null
				return
			}
			if (!handshakeComplete) {
				handshakeComplete = true
				handshakeResolve?.()
				handshakeResolve = null
				handshakeReject = null
			}
			if (data.cwiState.hasPermission === true) {
				updateIframeVisibility(true)
			} else {
				updateIframeVisibility(false)
			}
			return
		}

		if (!isResponse(data)) return
		const req = pending.get(data.id)
		if (!req) return

		pending.delete(data.id)
		clearTimeout(req.timeoutId)

		if (data.status === 'error') {
			req.reject(new Error(data.description ?? 'Web wallet request failed'))
		} else {
			req.resolve(data.result)
		}
	}

	const updateIframeVisibility = (show: boolean): void => {
		if (!iframe) return
		iframe.style.zIndex = '2147483647'
		if (show) {
			iframe.style.width = '100%'
			iframe.style.height = '100%'
			iframe.style.opacity = '1'
			iframe.style.pointerEvents = 'auto'
		} else {
			iframe.style.width = '0'
			iframe.style.height = '0'
			iframe.style.opacity = '0'
			iframe.style.pointerEvents = 'none'
		}
	}

	const ensureIframe = (): HTMLIFrameElement => {
		if (iframe) return iframe

		const el = document.createElement('iframe')
		el.src = iframeUrl
		el.setAttribute('aria-hidden', 'true')
		el.style.position = 'fixed'
		el.style.top = '0'
		el.style.left = '0'
		el.style.width = '0'
		el.style.height = '0'
		el.style.border = '0'
		el.style.opacity = '0'
		el.style.pointerEvents = 'none'

		const parent = document.body ?? document.documentElement
		if (!parent) throw new Error('Unable to mount CWI iframe')
		parent.appendChild(el)
		iframe = el
		return el
	}

	const waitForHandshake = (): Promise<void> => {
		if (handshakeComplete) return Promise.resolve()

		return new Promise<void>((resolve, reject) => {
			handshakeResolve = resolve
			handshakeReject = reject

			setTimeout(() => {
				if (!handshakeComplete) {
					handshakeReject?.(new Error('Web wallet handshake timed out'))
					handshakeResolve = null
					handshakeReject = null
				}
			}, handshakeTimeout)
		})
	}

	window.addEventListener('message', handleMessage)
	ensureIframe()

	const transport: CWITransport = async <TResult>(
		action: CWIEventName,
		params: unknown,
	): Promise<TResult> => {
		if (destroyed) throw new Error('WebCWI has been destroyed')

		await waitForHandshake()

		const target = iframe?.contentWindow
		if (!target) throw new Error('CWI iframe is not reachable')

		const id = createId()
		const request: CWIRequestMessage = {
			type: 'CWI',
			isInvocation: true,
			id,
			call: action,
			args: params,
		}

		return new Promise<TResult>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				pending.delete(id)
				reject(new Error(`Web wallet request timed out: ${action}`))
			}, requestTimeout)

			pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeoutId,
			})

			try {
				target.postMessage(request, walletOrigin)
			} catch (err) {
				clearTimeout(timeoutId)
				pending.delete(id)
				reject(new Error(`Failed to post message to web wallet: ${err instanceof Error ? err.message : String(err)}`))
			}
		})
	}

	const destroy = (): void => {
		if (destroyed) return
		destroyed = true

		window.removeEventListener('message', handleMessage)

		for (const req of pending.values()) {
			clearTimeout(req.timeoutId)
			req.reject(new Error('WebCWI destroyed'))
		}
		pending.clear()

		if (iframe?.parentNode) {
			iframe.parentNode.removeChild(iframe)
		}
		iframe = null
	}

	return { wallet: createCWI(transport), destroy }
}
