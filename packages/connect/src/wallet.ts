/**
 * Wallet-side utilities for popup protocol
 *
 * Use these in your wallet's popup pages to handle requests from dApps.
 *
 * @example
 * ```typescript
 * import { parsePopupParams, sendResponse, sendErrorResponse, ErrorCodes } from '@1sat/connect'
 *
 * // In your popup page (e.g., /connect)
 * const { requestId, origin, method, params } = parsePopupParams(
 *   new URLSearchParams(window.location.search)
 * )
 *
 * // After user approves
 * sendResponse(requestId, { paymentAddress, ordinalAddress }, origin)
 *
 * // Or on error
 * sendErrorResponse(requestId, ErrorCodes.USER_REJECTED, 'User rejected', origin)
 * ```
 */

import { ErrorCodes } from './errors'
import { createErrorResponse, createResponse } from './messages'

export interface PopupParams {
	/** Unique request identifier for matching response */
	requestId: string | null
	/** Origin of the requesting dApp */
	origin: string | null
	/** RPC method being called (connect, signTransaction, etc.) */
	method: string | null
	/** App name for display purposes */
	appName: string | null
	/** Parsed request parameters */
	params: unknown
}

/**
 * Parse popup URL query parameters
 *
 * Call this in your popup page to extract the request data from the URL.
 */
export function parsePopupParams(searchParams: URLSearchParams): PopupParams {
	const requestId = searchParams.get('requestId')
	const origin = searchParams.get('origin')
	const method = searchParams.get('method')
	const appName = searchParams.get('appName')
	const paramsStr = searchParams.get('params')

	let params: unknown = undefined
	if (paramsStr) {
		try {
			params = JSON.parse(decodeURIComponent(paramsStr))
		} catch {
			// Invalid params, leave as undefined
		}
	}

	return { requestId, origin, method, appName, params }
}

/**
 * Send a success response to the opener window and close the popup
 */
export function sendResponse(
	requestId: string,
	result: unknown,
	origin: string,
): void {
	if (typeof window === 'undefined') return

	if (!window.opener) {
		console.error('[onesat] No opener window found')
		return
	}

	const response = createResponse(requestId, result, origin)
	window.opener.postMessage(response, origin)
	window.close()
}

/**
 * Send an error response to the opener window and close the popup
 */
export function sendErrorResponse(
	requestId: string,
	code: number,
	message: string,
	origin: string,
	data?: unknown,
): void {
	if (typeof window === 'undefined') return

	if (!window.opener) {
		console.error('[onesat] No opener window found')
		return
	}

	const response = createErrorResponse(requestId, code, message, origin, data)
	window.opener.postMessage(response, origin)
	window.close()
}

/**
 * Reject a request with USER_REJECTED error code
 */
export function rejectRequest(
	requestId: string,
	origin: string,
	reason = 'User rejected the request',
): void {
	sendErrorResponse(requestId, ErrorCodes.USER_REJECTED, reason, origin)
}

/**
 * Send a wallet locked error response
 */
export function walletLockedError(requestId: string, origin: string): void {
	sendErrorResponse(
		requestId,
		ErrorCodes.WALLET_LOCKED,
		'Wallet is locked. Please unlock your wallet.',
		origin,
	)
}

/**
 * Send a wallet not connected error response
 */
export function walletNotConnectedError(
	requestId: string,
	origin: string,
): void {
	sendErrorResponse(
		requestId,
		ErrorCodes.WALLET_NOT_CONNECTED,
		'Wallet is not connected',
		origin,
	)
}

/**
 * Close the popup without sending a response
 * The dApp will receive a POPUP_CLOSED error via the PopupManager
 */
export function closePopup(): void {
	if (typeof window !== 'undefined') {
		window.close()
	}
}

/**
 * Check if this page was opened as a popup by a dApp
 */
export function isPopupContext(): boolean {
	if (typeof window === 'undefined') return false
	return window.opener !== null
}

/**
 * Get popup context with validated parameters
 * Throws if required parameters are missing
 */
export function getPopupContext(searchParams: URLSearchParams): {
	requestId: string
	origin: string
	method: string | null
	appName: string | null
	params: unknown
} {
	const { requestId, origin, method, appName, params } =
		parsePopupParams(searchParams)

	if (!requestId) {
		throw new Error('Missing requestId in popup parameters')
	}
	if (!origin) {
		throw new Error('Missing origin in popup parameters')
	}

	return { requestId, origin, method, appName, params }
}
