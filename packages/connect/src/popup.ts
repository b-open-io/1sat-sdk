import { PopupBlockedError, PopupClosedError, TimeoutError } from './errors'
import type { RpcMethod } from './types'

const DEFAULT_POPUP_URL = 'https://1sat.market'
const DEFAULT_TIMEOUT = 300000 // 5 minutes
const POPUP_CHECK_INTERVAL = 500 // Check if popup is closed every 500ms

export interface PopupConfig {
	popupUrl: string
	timeout: number
	appName?: string
}

export interface PendingRequest<T> {
	resolve: (value: T) => void
	reject: (error: Error) => void
	popup: Window | null
	timeoutId: ReturnType<typeof setTimeout>
	checkIntervalId: ReturnType<typeof setInterval>
}

/**
 * Manages popup windows for wallet requests
 */
export class PopupManager {
	private config: PopupConfig
	private pendingRequests = new Map<string, PendingRequest<unknown>>()

	constructor(config?: Partial<PopupConfig>) {
		this.config = {
			popupUrl: config?.popupUrl ?? DEFAULT_POPUP_URL,
			timeout: config?.timeout ?? DEFAULT_TIMEOUT,
			appName: config?.appName,
		}
	}

	/**
	 * Open a popup window for a wallet request
	 */
	openPopup<T>(
		method: RpcMethod,
		requestId: string,
		params?: unknown,
	): Promise<T> {
		return new Promise((resolve, reject) => {
			// Build popup URL
			const url = new URL(`${this.config.popupUrl}/connect`)
			url.searchParams.set('method', method)
			url.searchParams.set('requestId', requestId)
			url.searchParams.set('origin', window.location.origin)

			if (this.config.appName) {
				url.searchParams.set('appName', this.config.appName)
			}

			if (params) {
				url.searchParams.set('params', JSON.stringify(params))
			}

			// Calculate popup position (center of screen)
			const width = 420
			const height = 640
			const left = Math.max(0, (window.screen.width - width) / 2)
			const top = Math.max(0, (window.screen.height - height) / 2)

			// Open popup
			const popup = window.open(
				url.toString(),
				'onesat-wallet',
				`width=${width},height=${height},left=${left},top=${top},popup=1,scrollbars=1`,
			)

			if (!popup) {
				reject(new PopupBlockedError())
				return
			}

			// Focus the popup
			popup.focus()

			// Set up timeout
			const timeoutId = setTimeout(() => {
				this.cleanup(requestId)
				reject(new TimeoutError())
			}, this.config.timeout)

			// Check if popup is closed
			const checkIntervalId = setInterval(() => {
				if (popup.closed) {
					this.cleanup(requestId)
					reject(new PopupClosedError())
				}
			}, POPUP_CHECK_INTERVAL)

			// Store pending request
			this.pendingRequests.set(requestId, {
				resolve: resolve as (value: unknown) => void,
				reject,
				popup,
				timeoutId,
				checkIntervalId,
			})
		})
	}

	/**
	 * Resolve a pending request with a result
	 */
	resolveRequest(requestId: string, result: unknown): boolean {
		const pending = this.pendingRequests.get(requestId)
		if (!pending) return false

		this.cleanup(requestId)
		pending.resolve(result)
		return true
	}

	/**
	 * Reject a pending request with an error
	 */
	rejectRequest(requestId: string, error: Error): boolean {
		const pending = this.pendingRequests.get(requestId)
		if (!pending) return false

		this.cleanup(requestId)
		pending.reject(error)
		return true
	}

	/**
	 * Check if there's a pending request
	 */
	hasPendingRequest(requestId: string): boolean {
		return this.pendingRequests.has(requestId)
	}

	/**
	 * Clean up a pending request
	 */
	private cleanup(requestId: string): void {
		const pending = this.pendingRequests.get(requestId)
		if (!pending) return

		clearTimeout(pending.timeoutId)
		clearInterval(pending.checkIntervalId)

		if (pending.popup && !pending.popup.closed) {
			pending.popup.close()
		}

		this.pendingRequests.delete(requestId)
	}

	/**
	 * Clean up all pending requests
	 */
	destroy(): void {
		for (const requestId of this.pendingRequests.keys()) {
			this.cleanup(requestId)
		}
	}
}
