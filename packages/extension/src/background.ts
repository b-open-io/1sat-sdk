/**
 * Background script handler
 *
 * Sets up the background service worker to handle wallet requests.
 * Includes support for approval popups and MV3 service worker lifecycle.
 * Works across Chrome, Firefox, Edge, Safari via webextension-polyfill.
 */

import browser from 'webextension-polyfill'
import { MethodNotFoundError, toExtensionError } from './errors'
import type { OneSatEvent } from './provider-types'
import { ConnectedSites, WalletState } from './storage'
import {
	type ApprovalData,
	type BackgroundHandlerConfig,
	type ExtensionEvent,
	type ExtensionRequest,
	type ExtensionResponse,
	type InitState,
	MessageType,
	type RequestSender,
	RpcMethod,
	type RpcMethodValue,
} from './types'

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
		await browser.storage.session.set({ [PENDING_REQUESTS_KEY]: pending })
	}

	/**
	 * Get all pending requests
	 */
	async function getPendingRequests(): Promise<Record<string, PendingRequest>> {
		const result = await browser.storage.session.get(PENDING_REQUESTS_KEY)
		return (
			(result[PENDING_REQUESTS_KEY] as Record<string, PendingRequest>) || {}
		)
	}

	/**
	 * Track connected tab
	 */
	async function addConnectedTab(tabId: number, origin: string): Promise<void> {
		const result = await browser.storage.session.get(CONNECTED_TABS_KEY)
		const tabs = (result[CONNECTED_TABS_KEY] as Record<number, string>) || {}
		tabs[tabId] = origin
		await browser.storage.session.set({ [CONNECTED_TABS_KEY]: tabs })
		onConnect?.(tabId, origin)
	}

	/**
	 * Remove connected tab
	 */
	async function removeConnectedTab(tabId: number): Promise<void> {
		const result = await browser.storage.session.get(CONNECTED_TABS_KEY)
		const tabs = (result[CONNECTED_TABS_KEY] as Record<number, string>) || {}
		const origin = tabs[tabId]
		if (origin) {
			delete tabs[tabId]
			await browser.storage.session.set({ [CONNECTED_TABS_KEY]: tabs })
			onDisconnect?.(tabId, origin)
		}
	}

	/**
	 * Get all connected tabs
	 */
	async function getConnectedTabs(): Promise<Record<number, string>> {
		const result = await browser.storage.session.get(CONNECTED_TABS_KEY)
		return (result[CONNECTED_TABS_KEY] as Record<number, string>) || {}
	}

	/**
	 * Handle the internal __init__ request
	 * Returns current connection state for the requesting origin
	 */
	async function handleInit(origin: string | undefined): Promise<InitState> {
		if (!origin) {
			return { isConnected: false, addresses: null, identityPubKey: null }
		}

		const isConnected = await ConnectedSites.isConnected(origin)
		if (!isConnected) {
			return { isConnected: false, addresses: null, identityPubKey: null }
		}

		const walletAddresses = await WalletState.getAddresses()
		return {
			isConnected: true,
			addresses: walletAddresses
				? {
						paymentAddress: walletAddresses.paymentAddress,
						ordinalAddress: walletAddresses.ordinalAddress,
					}
				: null,
			identityPubKey: walletAddresses?.identityPubKey ?? null,
		}
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
			// Handle internal __init__ method
			if (method === RpcMethod.INIT) {
				const initState = await handleInit(sender.origin)
				return {
					type: MessageType.RESPONSE,
					id,
					result: initState,
				}
			}

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
				await browser.tabs.sendMessage(Number(tabId), message)
			} catch {
				// Tab may have been closed
				await removeConnectedTab(Number(tabId))
			}
		}
	}

	// Set up message listener
	browser.runtime.onMessage.addListener(
		(message: unknown, sender: browser.Runtime.MessageSender) => {
			// Type guard for our messages
			const msg = message as ExtensionRequest
			if (!msg || msg.type !== MessageType.REQUEST) {
				return false
			}

			// Build sender info - extract origin from sender.url
			const senderOrigin = sender.url ? new URL(sender.url).origin : undefined
			const requestSender: RequestSender = {
				origin: msg.origin || senderOrigin,
				tab: sender.tab,
				frameId: sender.frameId,
			}

			// Check if auto-approve
			const autoApprove = shouldAutoApprove?.(msg) ?? false

			// Return promise for async response
			if (autoApprove) {
				return handleRequest(msg, requestSender)
			}

			// Store for MV3 persistence and handle
			return storePendingRequest(msg.id, msg, requestSender).then(() =>
				handleRequest(msg, requestSender),
			)
		},
	)

	// Clean up when tabs are closed
	browser.tabs.onRemoved.addListener((tabId) => {
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
	// Generate unique request ID
	const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

	// Store approval data for popup to retrieve
	const approvalData: ApprovalData<T> = {
		requestId,
		method: 'approval' as RpcMethodValue,
		params: data as T,
	}

	await browser.storage.session.set({ [`approval_${requestId}`]: approvalData })

	// Build popup URL with request ID
	const url = browser.runtime.getURL(`${path}?requestId=${requestId}`)

	// Open popup window
	const window = await browser.windows.create({
		url,
		type: 'popup',
		width: 400,
		height: 600,
		focused: true,
	})

	if (!window?.id) {
		return false
	}

	const windowId = window.id

	return new Promise((resolve) => {
		// Listen for popup to send response
		function handleMessage(message: unknown) {
			const msg = message as {
				type: string
				requestId: string
				approved: boolean
			}
			if (msg?.type === 'APPROVAL_RESPONSE' && msg.requestId === requestId) {
				browser.runtime.onMessage.removeListener(handleMessage)
				browser.storage.session.remove(`approval_${requestId}`)
				resolve(msg.approved)
			}
		}

		browser.runtime.onMessage.addListener(handleMessage)

		// Handle popup being closed without response
		function onClose(closedId: number) {
			if (closedId === windowId) {
				browser.windows.onRemoved.removeListener(onClose)
				browser.runtime.onMessage.removeListener(handleMessage)
				browser.storage.session.remove(`approval_${requestId}`)
				resolve(false)
			}
		}

		browser.windows.onRemoved.addListener(onClose)
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
	const keepAlivePort = browser.runtime.connect({ name: 'keepalive' })

	try {
		return await fn()
	} finally {
		keepAlivePort.disconnect()
	}
}
