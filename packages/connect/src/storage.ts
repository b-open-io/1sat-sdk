import type { ConnectResult } from './types'

const STORAGE_KEY = 'onesat:connection'

/**
 * Connection state stored in localStorage
 */
export interface StoredConnection {
	paymentAddress: string
	ordinalAddress: string
	identityPubKey: string
	connectedAt: number
}

/**
 * Save connection state to localStorage
 */
export function saveConnection(connection: ConnectResult): void {
	const stored: StoredConnection = {
		...connection,
		connectedAt: Date.now(),
	}
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
	} catch {
		// localStorage might be unavailable
	}
}

/**
 * Load connection state from localStorage
 */
export function loadConnection(): StoredConnection | null {
	try {
		const data = localStorage.getItem(STORAGE_KEY)
		if (!data) return null
		return JSON.parse(data) as StoredConnection
	} catch {
		return null
	}
}

/**
 * Clear connection state from localStorage
 */
export function clearConnection(): void {
	try {
		localStorage.removeItem(STORAGE_KEY)
	} catch {
		// localStorage might be unavailable
	}
}

/**
 * Check if a valid connection exists
 */
export function hasStoredConnection(): boolean {
	return loadConnection() !== null
}
