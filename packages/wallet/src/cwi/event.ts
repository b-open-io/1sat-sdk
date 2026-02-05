/**
 * CWI Event Transport - For browser pages
 * Uses CustomEvent pattern, forwarded by content script to service worker
 */

import type { WalletInterface } from '@bsv/sdk'
import { type CWITransport, createCWI } from './factory'
import type { CWIEventName } from './types'

// Event name for requests (listened by content script)
const YOURS_REQUEST = 'YoursRequest'

/**
 * CustomEvent-based transport for browser page context.
 * Content script listens for these events and forwards to service worker.
 */
const eventTransport: CWITransport = <TResult>(
	action: CWIEventName,
	params: unknown,
): Promise<TResult> => {
	return new Promise<TResult>((resolve, reject) => {
		const messageId = `${action}-${Date.now()}-${Math.random()}`
		const requestEvent = new CustomEvent(YOURS_REQUEST, {
			detail: { messageId, type: action, params },
		})

		function onResponse(e: Event) {
			const responseEvent = e as CustomEvent<{
				success: boolean
				data?: TResult
				error?: string
			}>
			const { detail } = responseEvent
			if (detail.success) {
				resolve(detail.data as TResult)
			} else {
				reject(new Error(detail.error || 'Unknown error'))
			}
		}

		self.addEventListener(messageId, onResponse, { once: true })
		self.dispatchEvent(requestEvent)
	})
}

/**
 * Create a CWI for browser page context.
 * Uses CustomEvent pattern - requires content script to forward to service worker.
 */
export const createEventCWI = (): WalletInterface => createCWI(eventTransport)

// Default instance for convenience
export const CWI = createEventCWI()
