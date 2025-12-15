/**
 * Background script handler
 *
 * Sets up the background service worker to handle wallet requests.
 * Includes support for approval popups and MV3 service worker lifecycle.
 */

import {
	MessageType,
	type ExtensionRequest,
	type ExtensionResponse,
	type ExtensionEvent,
	type BackgroundHandlerConfig,
	type RequestSender,
	type RpcMethodValue,
	type ApprovalData,
} from './types'
import type { OneSatEvent } from './provider-types'
import { toExtensionError, MethodNotFoundError } from './errors'

/** Storage key for pending requests (MV3 persistence) */
const PENDING_REQUESTS_KEY = 'onesat_pending_requests'

/** Storage key for connected tabs */
const CONNECTED_TABS_KEY = 'onesat_connected_tabs'

/**
 * Pending request stored for MV3 persistence
 */
interface PendingRequest {
	request: ExtensionRequest
	sender: RequestSender
	popupId?: number
}

/**
 * Result from background handler setup
 */
export interface BackgroundHandlerResult {
	/**
	 * Broadcast an event to all connected tabs
	 */
	broadcast: (event: OneSatEvent, data: unknown) => Promise<void>
}

/**
 * Create the background handler for wallet requests
 *
 * @param config - Handler configuration with method implementations
 * @returns Object with broadcast function for emitting events
 */
export function createBackgroundHandler(
	config: BackgroundHandlerConfig,
): BackgroundHandlerResult {
	const { handlers, shouldAutoApprove, onConnect, onDisconnect } = config

	/**
	 * Store pending request for MV3 persistence
	 */
	async function storePendingRequest(
		id: string,
		request: ExtensionRequest,
		sender: RequestSender,
		popupId?: number,
	): Promise<void> {
		const pending = await getPendingRequests()
		pending[id] = { request, sender, popupId }
		await chrome.storage.session.set({ [PENDING_REQUESTS_KEY]: pending })
	}

	/**
	 * Get all pending requests
	 */
	async function getPendingRequests(): Promise<Record<string, PendingRequest>> {
		const result = await chrome.storage.session.get(PENDING_REQUESTS_KEY)
		return result[PENDING_REQUESTS_KEY] || {}
	}

	/**
	 * Remove a pending request
	 */
	async function removePendingRequest(id: string): Promise<PendingRequest | undefined> {
		const pending = await getPendingRequests()
		const request = pending[id]
		if (request) {
			delete pending[id]
			await chrome.storage.session.set({ [PENDING_REQUESTS_KEY]: pending })
		}
		return request
	}

	/**
	 * Track connected tab
	 */
	async function addConnectedTab(tabId: number, origin: string): Promise<void> {
		const result = await chrome.storage.session.get(CONNECTED_TABS_KEY)
		const tabs: Record<number, string> = result[CONNECTED_TABS_KEY] || {}
		tabs[tabId] = origin
		await chrome.storage.session.set({ [CONNECTED_TABS_KEY]: tabs })
		onConnect?.(tabId, origin)
	}

	/**
	 * Remove connected tab
	 */
	async function removeConnectedTab(tabId: number): Promise<void> {
		const result = await chrome.storage.session.get(CONNECTED_TABS_KEY)
		const tabs: Record<number, string> = result[CONNECTED_TABS_KEY] || {}
		const origin = tabs[tabId]
		if (origin) {
			delete tabs[tabId]
			await chrome.storage.session.set({ [CONNECTED_TABS_KEY]: tabs })
			onDisconnect?.(tabId, origin)
		}
	}

	/**
	 * Get all connected tabs
	 */
	async function getConnectedTabs(): Promise<Record<number, string>> {
		const result = await chrome.storage.session.get(CONNECTED_TABS_KEY)
		return result[CONNECTED_TABS_KEY] || {}
	}

	/**
	 * Handle an incoming request
	 */
	async function handleRequest(
		request: ExtensionRequest,
		sender: RequestSender,
	): Promise<ExtensionResponse> {
		const { id, method, params } = request

		try {
			// Get the handler for this method
			const handler = handlers[method as keyof typeof handlers]

			if (!handler) {
				throw new MethodNotFoundError(method)
			}

			// Execute the handler
			const result = await handler({ params } as never, sender)

			// Track connection state
			if (method === 'connect' && sender.tab?.id && sender.origin) {
				await addConnectedTab(sender.tab.id, sender.origin)
			} else if (method === 'disconnect' && sender.tab?.id) {
				await removeConnectedTab(sender.tab.id)
			}

			return {
				type: MessageType.RESPONSE,
				id,
				result,
			}
		} catch (error) {
			return {
				type: MessageType.RESPONSE,
				id,
				error: toExtensionError(error),
			}
		}
	}

	/**
	 * Broadcast an event to all connected tabs
	 */
	async function broadcast(event: OneSatEvent, data: unknown): Promise<void> {
		const tabs = await getConnectedTabs()
		const message: ExtensionEvent = {
			type: MessageType.EVENT,
			event,
			data,
		}

		for (const tabId of Object.keys(tabs)) {
			try {
				await chrome.tabs.sendMessage(Number(tabId), message)
			} catch {
				// Tab may have been closed
				await removeConnectedTab(Number(tabId))
			}
		}
	}

	// Set up message listener
	chrome.runtime.onMessage.addListener(
		(
			message: ExtensionRequest,
			sender: chrome.runtime.MessageSender,
			sendResponse: (response: ExtensionResponse) => void,
		) => {
			// Only handle our request messages
			if (message.type !== MessageType.REQUEST) {
				return false
			}

			// Build sender info
			const requestSender: RequestSender = {
				origin: message.origin || sender.origin,
				tab: sender.tab,
				frameId: sender.frameId,
			}

			// Check if auto-approve
			const autoApprove = shouldAutoApprove?.(message) ?? false

			if (autoApprove) {
				// Handle immediately
				handleRequest(message, requestSender).then(sendResponse)
			} else {
				// Store for MV3 persistence and handle
				storePendingRequest(message.id, message, requestSender).then(() => {
					handleRequest(message, requestSender).then(sendResponse)
				})
			}

			// Return true to indicate async response
			return true
		},
	)

	// Clean up when tabs are closed
	chrome.tabs.onRemoved.addListener((tabId) => {
		removeConnectedTab(tabId)
	})

	return { broadcast }
}

/**
 * Open an approval popup and wait for user response
 *
 * @param path - Path to the popup HTML file (e.g., '/popup/sign.html')
 * @param data - Data to pass to the popup
 * @returns Promise that resolves to true if approved, false if rejected
 */
export async function openApprovalPopup<T = unknown>(
	path: string,
	data?: T,
): Promise<boolean> {
	return new Promise((resolve) => {
		// Generate unique request ID
		const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

		// Store approval data for popup to retrieve
		const approvalData: ApprovalData<T> = {
			requestId,
			method: 'approval' as RpcMethodValue,
			params: data as T,
		}

		chrome.storage.session.set({ [`approval_${requestId}`]: approvalData })

		// Build popup URL with request ID
		const url = chrome.runtime.getURL(`${path}?requestId=${requestId}`)

		// Open popup window
		chrome.windows.create(
			{
				url,
				type: 'popup',
				width: 400,
				height: 600,
				focused: true,
			},
			(window) => {
				if (!window?.id) {
					resolve(false)
					return
				}

				const windowId = window.id

				// Listen for popup to send response
				function handleMessage(
					message: { type: string; requestId: string; approved: boolean },
					_sender: chrome.runtime.MessageSender,
				) {
					if (
						message.type === 'APPROVAL_RESPONSE' &&
						message.requestId === requestId
					) {
						chrome.runtime.onMessage.removeListener(handleMessage)
						chrome.storage.session.remove(`approval_${requestId}`)
						resolve(message.approved)
					}
				}

				chrome.runtime.onMessage.addListener(handleMessage)

				// Handle popup being closed without response
				chrome.windows.onRemoved.addListener(function onClose(closedId) {
					if (closedId === windowId) {
						chrome.windows.onRemoved.removeListener(onClose)
						chrome.runtime.onMessage.removeListener(handleMessage)
						chrome.storage.session.remove(`approval_${requestId}`)
						resolve(false)
					}
				})
			},
		)
	})
}

/**
 * Keep the service worker alive during long operations
 *
 * Prevents MV3 service worker from being terminated during
 * operations that take longer than 30 seconds (like waiting for popup)
 */
export async function keepAlive<T>(fn: () => Promise<T>): Promise<T> {
	// Create a port connection to keep service worker alive
	const keepAlivePort = chrome.runtime.connect({ name: 'keepalive' })

	try {
		return await fn()
	} finally {
		keepAlivePort.disconnect()
	}
}
