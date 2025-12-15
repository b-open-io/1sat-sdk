/**
 * Content script bridge
 *
 * Relays messages between the page (inject script) and the
 * background service worker. Also handles injecting the provider script.
 */

import {
	MessageType,
	type ExtensionRequest,
	type ExtensionResponse,
	type ExtensionEvent,
	type ContentBridgeOptions,
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
			script.src = chrome.runtime.getURL('dist/inject.js')
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
	function handlePageMessage(event: MessageEvent): void {
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

		// Send to background and wait for response
		chrome.runtime.sendMessage(requestWithOrigin, (response: ExtensionResponse) => {
			if (chrome.runtime.lastError) {
				// Extension context invalidated (extension was reloaded)
				log('Runtime error:', chrome.runtime.lastError.message)

				const errorResponse: ExtensionResponse = {
					type: MessageType.RESPONSE,
					id: request.id,
					error: {
						code: -32603,
						message: chrome.runtime.lastError.message || 'Extension error',
					},
				}

				window.postMessage(
					{
						source: CONTENT_SOURCE,
						payload: errorResponse,
					},
					'*',
				)
				return
			}

			log('Got response from background:', response?.id)

			// Relay response to page
			window.postMessage(
				{
					source: CONTENT_SOURCE,
					payload: response,
				},
				'*',
			)
		})
	}

	/**
	 * Handle messages from the background (events)
	 */
	function handleBackgroundMessage(
		message: ExtensionEvent,
		_sender: chrome.runtime.MessageSender,
		_sendResponse: (response?: unknown) => void,
	): boolean {
		// Only handle events
		if (message.type !== MessageType.EVENT) return false

		log('Relaying event to page:', message.event)

		// Relay event to page
		window.postMessage(
			{
				source: CONTENT_SOURCE,
				payload: message,
			},
			'*',
		)

		return false // Don't keep channel open
	}

	// Set up listeners
	window.addEventListener('message', handlePageMessage)
	chrome.runtime.onMessage.addListener(handleBackgroundMessage)

	// Inject the provider script
	injectScript()

	log('Content bridge initialized')
}

// Export for direct use
export { INJECT_SOURCE, CONTENT_SOURCE }
