/**
 * CWI Chrome Transport - For extension popup/options pages
 * Uses chrome.runtime.sendMessage directly to service worker
 */

import type { WalletInterface } from '@bsv/sdk'
import { type CWITransport, createCWI } from './factory'
import type { CWIEventName, CWIResponseDetail } from './types'

/**
 * chrome.runtime.sendMessage-based transport for extension context.
 * Communicates directly with service worker without content script intermediary.
 */
const chromeTransport: CWITransport = <TResult>(
	action: CWIEventName,
	params: unknown,
): Promise<TResult> => {
	return new Promise<TResult>((resolve, reject) => {
		// Use originator at message level (BRC-100 standard)
		// Format as chrome-extension://<id> to match the admin originator in initWallet.ts
		const originator = `chrome-extension://${chrome.runtime?.id}`
		console.log('[ChromeCWI] Sending message:', {
			action,
			originator,
			paramsType: typeof params,
		})

		chrome.runtime.sendMessage(
			{ action, params, originator },
			(response: CWIResponseDetail<TResult>) => {
				if (chrome.runtime.lastError) {
					console.error(
						'[ChromeCWI] Runtime error:',
						chrome.runtime.lastError.message,
					)
					reject(new Error(chrome.runtime.lastError.message))
					return
				}
				if (response.success) {
					console.log('[ChromeCWI] Success:', action)
					resolve(response.data as TResult)
				} else {
					console.error('[ChromeCWI] Failed:', action, response.error)
					reject(new Error(response.error || 'Unknown error'))
				}
			},
		)
	})
}

/**
 * Create a CWI for extension context (popup, options page).
 * Uses chrome.runtime.sendMessage directly to communicate with service worker.
 */
export const createChromeCWI = (): WalletInterface => createCWI(chromeTransport)

// Default instance for convenience
export const ChromeCWI = createChromeCWI()
