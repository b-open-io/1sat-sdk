/**
 * Popup script - Shared logic for popup pages
 *
 * Communicates with the background script for wallet operations.
 * Uses KeyStore via message passing for encrypted key management.
 */

import browser from 'webextension-polyfill'

// Storage key for connected sites
const CONNECTED_SITES_KEY = 'connected_sites'

/**
 * Wallet state type
 */
export type WalletState = 'empty' | 'locked' | 'unlocked'

/**
 * Wallet addresses
 */
export interface WalletAddresses {
	paymentAddress: string
	ordinalAddress: string
	identityPubKey: string
}

/**
 * Send a message to background and get response
 */
async function sendWalletMessage<T>(
	type: string,
	data?: Record<string, unknown>,
): Promise<T> {
	return browser.runtime.sendMessage({ type, ...data }) as Promise<T>
}

/**
 * Get wallet state (empty, locked, or unlocked)
 */
export async function getWalletState(): Promise<WalletState> {
	return sendWalletMessage<WalletState>('WALLET_GET_STATE')
}

/**
 * Check if wallet is unlocked
 */
export async function isUnlocked(): Promise<boolean> {
	return sendWalletMessage<boolean>('WALLET_IS_UNLOCKED')
}

/**
 * Get wallet addresses (works even when locked, from metadata)
 */
export async function getWalletAddresses(): Promise<WalletAddresses | null> {
	return sendWalletMessage<WalletAddresses | null>('WALLET_GET_ADDRESSES')
}

/**
 * Get wallet address for display
 */
export async function getWalletAddress(): Promise<string> {
	const addresses = await getWalletAddresses()
	return addresses?.paymentAddress ?? 'No wallet yet'
}

/**
 * Check if wallet exists (locked or unlocked)
 */
export async function hasWallet(): Promise<boolean> {
	const state = await getWalletState()
	return state !== 'empty'
}

/**
 * Generate a new wallet with passphrase
 */
export async function generateNewWallet(
	passphrase: string,
): Promise<{ addresses?: WalletAddresses; error?: string }> {
	const result = await sendWalletMessage<WalletAddresses | { error: string }>(
		'WALLET_GENERATE',
		{ passphrase },
	)
	if ('error' in result) {
		return { error: result.error }
	}
	return { addresses: result as WalletAddresses }
}

/**
 * Import a WIF with passphrase
 */
export async function importWif(
	wif: string,
	passphrase: string,
): Promise<{ addresses?: WalletAddresses; error?: string }> {
	const result = await sendWalletMessage<WalletAddresses | { error: string }>(
		'WALLET_IMPORT_WIF',
		{ wif, passphrase },
	)
	if ('error' in result) {
		return { error: result.error }
	}
	return { addresses: result as WalletAddresses }
}

/**
 * Unlock the wallet with passphrase
 */
export async function unlockWallet(
	passphrase: string,
): Promise<{ success?: boolean; error?: string }> {
	return sendWalletMessage<{ success?: boolean; error?: string }>(
		'WALLET_UNLOCK',
		{
			passphrase,
		},
	)
}

/**
 * Lock the wallet (clear keys from memory)
 */
export async function lockWallet(): Promise<void> {
	await sendWalletMessage('WALLET_LOCK')
}

/**
 * Export encrypted backup
 */
export async function exportBackup(
	passphrase: string,
): Promise<{ backup?: string; error?: string }> {
	return sendWalletMessage<{ backup?: string; error?: string }>(
		'WALLET_EXPORT_BACKUP',
		{
			passphrase,
		},
	)
}

/**
 * Get connected sites
 */
export async function getConnectedSites(): Promise<string[]> {
	const result = await browser.storage.local.get(CONNECTED_SITES_KEY)
	return (result[CONNECTED_SITES_KEY] as string[]) || []
}

/**
 * Disconnect a site
 */
export async function disconnectSite(origin: string): Promise<void> {
	const sites = await getConnectedSites()
	const filtered = sites.filter((s) => s !== origin)
	await browser.storage.local.set({ [CONNECTED_SITES_KEY]: filtered })
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

	const result = await browser.storage.session.get(`approval_${requestId}`)
	return (
		(result[`approval_${requestId}`] as { requestId: string; params: T }) ||
		null
	)
}

/**
 * Send approval response
 */
export function sendApprovalResponse(
	requestId: string,
	approved: boolean,
): void {
	browser.runtime.sendMessage({
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

// Make functions available globally for popup scripts
declare global {
	interface Window {
		popup: {
			getWalletAddress: typeof getWalletAddress
			getWalletAddresses: typeof getWalletAddresses
			getWalletState: typeof getWalletState
			hasWallet: typeof hasWallet
			isUnlocked: typeof isUnlocked
			generateNewWallet: typeof generateNewWallet
			importWif: typeof importWif
			unlockWallet: typeof unlockWallet
			lockWallet: typeof lockWallet
			exportBackup: typeof exportBackup
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
	getWalletAddresses,
	getWalletState,
	hasWallet,
	isUnlocked,
	generateNewWallet,
	importWif,
	unlockWallet,
	lockWallet,
	exportBackup,
	getConnectedSites,
	disconnectSite,
	getApprovalData,
	sendApprovalResponse,
	fetchBalance,
}
