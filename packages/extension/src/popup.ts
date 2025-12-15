/**
 * Popup utilities
 *
 * Helper functions for approval popup pages to retrieve request data
 * and send approve/reject responses back to the background script.
 */

import type { ApprovalData } from './types'

/**
 * Get the approval data passed to this popup
 *
 * Call this in your popup page to retrieve the data that was passed
 * when opening the approval popup.
 *
 * @returns The approval data, or null if not found
 */
export async function getApprovalData<T = unknown>(): Promise<ApprovalData<T> | null> {
	// Get request ID from URL params
	const params = new URLSearchParams(window.location.search)
	const requestId = params.get('requestId')

	if (!requestId) {
		console.error('[onesat-popup] No requestId in URL')
		return null
	}

	// Retrieve data from session storage
	const key = `approval_${requestId}`
	const result = await chrome.storage.session.get(key)

	if (!result[key]) {
		console.error('[onesat-popup] No approval data found for', requestId)
		return null
	}

	return result[key] as ApprovalData<T>
}

/**
 * Get the request ID for this popup
 */
export function getRequestId(): string | null {
	const params = new URLSearchParams(window.location.search)
	return params.get('requestId')
}

/**
 * Approve the current request
 *
 * Call this when the user clicks approve. The popup will close automatically.
 *
 * @param result - Optional result data to include with approval
 */
export function approveRequest(result?: unknown): void {
	const requestId = getRequestId()

	if (!requestId) {
		console.error('[onesat-popup] Cannot approve: no requestId')
		return
	}

	// Send approval message to background
	chrome.runtime.sendMessage({
		type: 'APPROVAL_RESPONSE',
		requestId,
		approved: true,
		result,
	})

	// Close the popup
	window.close()
}

/**
 * Reject the current request
 *
 * Call this when the user clicks reject or closes the popup.
 * The popup will close automatically.
 *
 * @param reason - Optional rejection reason
 */
export function rejectRequest(reason?: string): void {
	const requestId = getRequestId()

	if (!requestId) {
		console.error('[onesat-popup] Cannot reject: no requestId')
		return
	}

	// Send rejection message to background
	chrome.runtime.sendMessage({
		type: 'APPROVAL_RESPONSE',
		requestId,
		approved: false,
		reason,
	})

	// Close the popup
	window.close()
}

/**
 * Close the popup without sending a response
 *
 * The background will treat this as a rejection.
 */
export function closePopup(): void {
	window.close()
}
