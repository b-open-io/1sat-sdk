/**
 * CWI Sigma Transport - For Sigma Identity signer iframe via postMessage
 * Creates a hidden iframe to the Sigma auth server's /signer page and
 * communicates via the standard CWI protocol.
 */

import type { WalletInterface } from '@bsv/sdk'
import { type CWITransport, createCWI } from './factory'
import type { CWIEventName } from './types'

const DEFAULT_IFRAME_PATH = '/signer'
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000

export interface SigmaCWIConfig {
	/** Sigma auth server URL (e.g. https://auth.sigmaidentity.com) */
	sigmaUrl: string
	/** Iframe path on sigma server (default: /signer) */
	iframePath?: string
	/** Request timeout in milliseconds (default: 30000) */
	timeout?: number
	/** Handshake timeout in milliseconds (default: 10000) */
	handshakeTimeout?: number
}

export interface SigmaCWIResult {
	wallet: WalletInterface
	destroy: () => void
	/** Send a non-CWI message to the sigma iframe (e.g. SET_IDENTITY). Awaits handshake first. */
	sendCustomMessage: (type: string, payload: unknown) => Promise<void>
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
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null

const isResponse = (v: unknown): v is CWIResponseMessage =>
	isRecord(v) &&
	v.type === 'CWI' &&
	v.isInvocation === false &&
	typeof v.id === 'string'

const isState = (v: unknown): v is CWIStateMessage =>
	isRecord(v) && v.type === 'CWI' && isRecord(v.cwiState)

const createId = (): string =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`

/**
 * Create a WalletInterface backed by the Sigma Identity signer iframe.
 *
 * The iframe hosts a password-protected wallet. When the wallet needs user
 * interaction (password entry, permission prompts), the iframe becomes visible.
 *
 * Returns { wallet, destroy, sendCustomMessage }.
 */
export function createSigmaCWI(config: SigmaCWIConfig): SigmaCWIResult {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		throw new Error('createSigmaCWI requires a browser environment')
	}

	const { sigmaUrl } = config
	const iframePath = config.iframePath ?? DEFAULT_IFRAME_PATH
	const requestTimeout = config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS
	const handshakeTimeout =
		config.handshakeTimeout ?? DEFAULT_HANDSHAKE_TIMEOUT_MS

	const sigmaOrigin = new URL(sigmaUrl).origin
	const iframeUrl = new URL(iframePath, sigmaUrl).toString()

	const pending = new Map<string, PendingRequest>()
	let iframe: HTMLIFrameElement | null = null
	let destroyed = false
	let handshakeResolve: (() => void) | null = null
	let handshakeReject: ((err: Error) => void) | null = null
	let handshakeComplete = false

	const updateIframeVisibility = (show: boolean): void => {
		if (!iframe) return
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

	const rejectAllPending = (error: Error): void => {
		for (const req of pending.values()) {
			clearTimeout(req.timeoutId)
			req.reject(error)
		}
		pending.clear()
	}

	const handleMessage = (event: MessageEvent): void => {
		if (destroyed) return
		if (event.origin !== sigmaOrigin) return

		const data = event.data

		if (isState(data)) {
			const { status, hasPermission } = data.cwiState
			const isInteractive =
				status === 'need_password' ||
				status === 'need_biometric' ||
				!!hasPermission

			// Reset pending request timeouts while user is interacting
			if (isInteractive) {
				for (const [id, req] of pending) {
					clearTimeout(req.timeoutId)
					req.timeoutId = setTimeout(() => {
						pending.delete(id)
						req.reject(new Error(`Sigma CWI request timed out: ${id}`))
					}, requestTimeout)
				}
			}

			updateIframeVisibility(isInteractive)

			if (!handshakeComplete) {
				handshakeComplete = true
				handshakeResolve?.()
				handshakeResolve = null
				handshakeReject = null
			}

			if (status === 'error') {
				rejectAllPending(
					new Error('Signer error. Please sign in to Sigma Identity.'),
				)
			}

			return
		}

		if (!isResponse(data)) return
		const req = pending.get(data.id)
		if (!req) return

		pending.delete(data.id)
		clearTimeout(req.timeoutId)

		if (data.status === 'error') {
			req.reject(new Error(data.description ?? 'Sigma CWI request failed'))
		} else {
			req.resolve(data.result)
		}
	}

	const ensureIframe = (): HTMLIFrameElement => {
		if (iframe) return iframe

		const el = document.createElement('iframe')
		el.src = iframeUrl
		el.setAttribute('aria-hidden', 'true')
		el.style.cssText = [
			'position: fixed',
			'top: 0',
			'left: 0',
			'width: 0',
			'height: 0',
			'border: 0',
			'opacity: 0',
			'pointer-events: none',
			'z-index: 2147483647',
		].join('; ')

		el.setAttribute('allow', 'publickey-credentials-get')

		const parent = document.body ?? document.documentElement
		if (!parent) throw new Error('Unable to mount Sigma CWI iframe')
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
					handshakeReject?.(new Error('Sigma signer handshake timed out'))
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
		if (destroyed) throw new Error('SigmaCWI has been destroyed')

		await waitForHandshake()

		const target = iframe?.contentWindow
		if (!target) throw new Error('Sigma iframe is not reachable')

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
				reject(new Error(`Sigma CWI request timed out: ${action}`))
			}, requestTimeout)

			pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeoutId,
			})

			try {
				target.postMessage(request, sigmaOrigin)
			} catch (err) {
				clearTimeout(timeoutId)
				pending.delete(id)
				reject(
					new Error(
						`Failed to post message to Sigma signer: ${err instanceof Error ? err.message : String(err)}`,
					),
				)
			}
		})
	}

	const sendCustomMessage = async (
		type: string,
		payload: unknown,
	): Promise<void> => {
		await waitForHandshake()
		const target = iframe?.contentWindow
		if (!target) return
		target.postMessage({ type, payload }, sigmaOrigin)
	}

	const destroy = (): void => {
		if (destroyed) return
		destroyed = true

		window.removeEventListener('message', handleMessage)
		rejectAllPending(new Error('SigmaCWI destroyed'))

		if (iframe?.parentNode) {
			iframe.parentNode.removeChild(iframe)
		}
		iframe = null
	}

	return { wallet: createCWI(transport), destroy, sendCustomMessage }
}
