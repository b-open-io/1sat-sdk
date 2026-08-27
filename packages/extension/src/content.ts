/**
 * Content script bridge
 *
 * Relays messages between the page (inject script) and the
 * background service worker. Also handles injecting the provider script.
 * Works across Chrome, Firefox, Edge, Safari via webextension-polyfill.
 */

import browser from 'webextension-polyfill'
import {
	type ContentBridgeOptions,
	type ExtensionEvent,
	type ExtensionRequest,
	type ExtensionResponse,
	MessageType,
} from './types'

/** Message source identifiers */
const INJECT_SOURCE = 'onesat-inject'
const CONTENT_SOURCE = 'onesat-content'

/**
 * Create the content script bridge
 *
 * This should be called from your extension's content script.
 * It handles:
 * 1. Injecting the provider script into the page
 * 2. Relaying requests from page to background
 * 3. Relaying responses from background to page
 * 4. Relaying events from background to page
 */
export function createContentBridge(options: ContentBridgeOptions = {}): void {
	const { allowedOrigins, debug } = options

	const log = debug
		? (...args: unknown[]) => console.log('[onesat-content]', ...args)
		: () => {}

	/**
	 * Check if origin is allowed
	 */
	function isAllowedOrigin(origin: string): boolean {
		if (!allowedOrigins || allowedOrigins.length === 0) {
			return true // Allow all if not specified
		}
		return allowedOrigins.includes(origin)
	}

	/**
	 * Inject the provider script into the page
	 */
	function injectScript(): void {
		try {
			const script = document.createElement('script')
			script.src = browser.runtime.getURL('dist/inject.js')
			script.type = 'module'

			// Insert at document_start before page scripts run
			const container = document.head || document.documentElement
			container.insertBefore(script, container.firstChild)

			// Clean up after injection
			script.onload = () => script.remove()

			log('Provider script injected')
		} catch (err) {
			console.error('[onesat-content] Failed to inject script:', err)
		}
	}

	/**
	 * Handle messages from the page (inject script)
	 */
	async function handlePageMessage(event: MessageEvent): Promise<void> {
		// Only handle messages from this window
		if (event.source !== window) return

		// Check message format
		if (!event.data || event.data.source !== INJECT_SOURCE) return

		const request = event.data.payload as ExtensionRequest

		// Validate message type
		if (request.type !== MessageType.REQUEST) return

		// Check origin if filtering enabled
		const origin = window.location.origin
		if (!isAllowedOrigin(origin)) {
			log('Blocked request from non-allowed origin:', origin)
			return
		}

		log('Relaying request to background:', request.method, request.id)

		// Add origin to request
		const requestWithOrigin = {
			...request,
			origin,
		}

		try {
			// Send to background and wait for response
			const response = (await browser.runtime.sendMessage(
				requestWithOrigin,
			)) as ExtensionResponse

			log('Got response from background:', response?.id)

			// Relay response to page
			window.postMessage(
				{
					source: CONTENT_SOURCE,
					payload: response,
				},
				'*',
			)
		} catch (err) {
			// Extension context invalidated (extension was reloaded)
			log('Runtime error:', (err as Error).message)

			const errorResponse: ExtensionResponse = {
				type: MessageType.RESPONSE,
				id: request.id,
				error: {
					code: -32603,
					message: (err as Error).message || 'Extension error',
				},
			}

			window.postMessage(
				{
					source: CONTENT_SOURCE,
					payload: errorResponse,
				},
				'*',
			)
		}
	}

	/**
	 * Handle messages from the background (events)
	 */
	function handleBackgroundMessage(message: unknown): boolean {
		// Type guard
		const msg = message as ExtensionEvent
		if (!msg || msg.type !== MessageType.EVENT) return false

		log('Relaying event to page:', msg.event)

		// Relay event to page
		window.postMessage(
			{
				source: CONTENT_SOURCE,
				payload: msg,
			},
			'*',
		)

		return false // Don't keep channel open
	}

	// Set up listeners
	window.addEventListener('message', handlePageMessage)
	browser.runtime.onMessage.addListener(handleBackgroundMessage)

	// Inject the provider script
	injectScript()

	log('Content bridge initialized')
}

// Export for direct use
export { CONTENT_SOURCE, INJECT_SOURCE }
