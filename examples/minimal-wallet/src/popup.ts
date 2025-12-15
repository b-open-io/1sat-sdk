/**
 * Popup script - Shared logic for popup pages
 *
 * This is bundled and included in all popup pages
 */

import { PrivateKey } from '@bsv/sdk'

// Storage keys
const STORAGE_KEYS = {
	PRIVATE_KEY: 'wallet_private_key',
	CONNECTED_SITES: 'connected_sites',
} as const

/**
 * Get or create wallet address
 */
export async function getWalletAddress(): Promise<string> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.PRIVATE_KEY)
	if (result[STORAGE_KEYS.PRIVATE_KEY]) {
		const pk = PrivateKey.fromWif(result[STORAGE_KEYS.PRIVATE_KEY])
		return pk.toAddress().toString()
	}
	return 'No wallet yet'
}

/**
 * Get connected sites
 */
export async function getConnectedSites(): Promise<string[]> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.CONNECTED_SITES)
	return result[STORAGE_KEYS.CONNECTED_SITES] || []
}

/**
 * Disconnect a site
 */
export async function disconnectSite(origin: string): Promise<void> {
	const sites = await getConnectedSites()
	const filtered = sites.filter((s) => s !== origin)
	await chrome.storage.local.set({ [STORAGE_KEYS.CONNECTED_SITES]: filtered })
}

/**
 * Get approval data from storage
 */
export async function getApprovalData<T>(): Promise<{
	requestId: string
	params: T
} | null> {
	const urlParams = new URLSearchParams(window.location.search)
	const requestId = urlParams.get('requestId')
	if (!requestId) return null

	const result = await chrome.storage.session.get(`approval_${requestId}`)
	return result[`approval_${requestId}`] || null
}

/**
 * Send approval response
 */
export function sendApprovalResponse(requestId: string, approved: boolean): void {
	chrome.runtime.sendMessage({
		type: 'APPROVAL_RESPONSE',
		requestId,
		approved,
	})
	window.close()
}

/**
 * Fetch balance from API
 */
export async function fetchBalance(address: string): Promise<number> {
	try {
		const response = await fetch(
			`https://api.whatsonchain.com/v1/bsv/main/address/${address}/balance`,
		)
		if (!response.ok) return 0
		const data = await response.json()
		return data.confirmed + data.unconfirmed
	} catch {
		return 0
	}
}

// Make functions available globally for inline scripts
declare global {
	interface Window {
		popup: {
			getWalletAddress: typeof getWalletAddress
			getConnectedSites: typeof getConnectedSites
			disconnectSite: typeof disconnectSite
			getApprovalData: typeof getApprovalData
			sendApprovalResponse: typeof sendApprovalResponse
			fetchBalance: typeof fetchBalance
		}
	}
}

window.popup = {
	getWalletAddress,
	getConnectedSites,
	disconnectSite,
	getApprovalData,
	sendApprovalResponse,
	fetchBalance,
}
