/**
 * Storage utilities for wallet extensions
 *
 * Helpers for managing connected sites and wallet state
 * using chrome.storage.local for persistence.
 */

import type { ConnectedSite, WalletAddresses } from './types'

/** Storage keys */
const CONNECTED_SITES_KEY = 'onesat_connected_sites'
const WALLET_ADDRESSES_KEY = 'onesat_wallet_addresses'

/**
 * Connected sites storage
 *
 * Manages the list of sites that have been granted access to the wallet.
 */
export const ConnectedSites = {
	/**
	 * Add a connected site
	 */
	async add(
		origin: string,
		options: { permissions?: string[] } = {},
	): Promise<void> {
		const sites = await this.getAll()
		sites[origin] = {
			origin,
			connectedAt: Date.now(),
			permissions: options.permissions || ['sign'],
		}
		await chrome.storage.local.set({ [CONNECTED_SITES_KEY]: sites })
	},

	/**
	 * Remove a connected site
	 */
	async remove(origin: string): Promise<void> {
		const sites = await this.getAll()
		delete sites[origin]
		await chrome.storage.local.set({ [CONNECTED_SITES_KEY]: sites })
	},

	/**
	 * Check if a site is connected
	 */
	async isConnected(origin: string): Promise<boolean> {
		const sites = await this.getAll()
		return origin in sites
	},

	/**
	 * Get info for a connected site
	 */
	async get(origin: string): Promise<ConnectedSite | null> {
		const sites = await this.getAll()
		return sites[origin] || null
	},

	/**
	 * Get all connected sites
	 */
	async getAll(): Promise<Record<string, ConnectedSite>> {
		const result = await chrome.storage.local.get(CONNECTED_SITES_KEY)
		return result[CONNECTED_SITES_KEY] || {}
	},

	/**
	 * Check if site has a specific permission
	 */
	async hasPermission(origin: string, permission: string): Promise<boolean> {
		const site = await this.get(origin)
		return site?.permissions.includes(permission) ?? false
	},

	/**
	 * Add permission to a site
	 */
	async addPermission(origin: string, permission: string): Promise<void> {
		const site = await this.get(origin)
		if (site && !site.permissions.includes(permission)) {
			site.permissions.push(permission)
			const sites = await this.getAll()
			sites[origin] = site
			await chrome.storage.local.set({ [CONNECTED_SITES_KEY]: sites })
		}
	},

	/**
	 * Remove permission from a site
	 */
	async removePermission(origin: string, permission: string): Promise<void> {
		const site = await this.get(origin)
		if (site) {
			site.permissions = site.permissions.filter((p) => p !== permission)
			const sites = await this.getAll()
			sites[origin] = site
			await chrome.storage.local.set({ [CONNECTED_SITES_KEY]: sites })
		}
	},

	/**
	 * Clear all connected sites
	 */
	async clear(): Promise<void> {
		await chrome.storage.local.remove(CONNECTED_SITES_KEY)
	},
}

/**
 * Wallet state storage
 *
 * Manages cached wallet addresses. Note: actual keys should be
 * stored securely by the wallet implementation, not here.
 */
export const WalletState = {
	/**
	 * Set wallet addresses
	 */
	async setAddresses(addresses: WalletAddresses): Promise<void> {
		await chrome.storage.local.set({ [WALLET_ADDRESSES_KEY]: addresses })
	},

	/**
	 * Get wallet addresses
	 */
	async getAddresses(): Promise<WalletAddresses | null> {
		const result = await chrome.storage.local.get(WALLET_ADDRESSES_KEY)
		return result[WALLET_ADDRESSES_KEY] || null
	},

	/**
	 * Check if wallet has addresses set
	 */
	async hasAddresses(): Promise<boolean> {
		const addresses = await this.getAddresses()
		return addresses !== null
	},

	/**
	 * Clear wallet state
	 */
	async clear(): Promise<void> {
		await chrome.storage.local.remove(WALLET_ADDRESSES_KEY)
	},
}

/**
 * Generic storage helper for wallet-specific data
 */
export const WalletStorage = {
	/**
	 * Get a value from storage
	 */
	async get<T>(key: string): Promise<T | null> {
		const result = await chrome.storage.local.get(key)
		return result[key] ?? null
	},

	/**
	 * Set a value in storage
	 */
	async set<T>(key: string, value: T): Promise<void> {
		await chrome.storage.local.set({ [key]: value })
	},

	/**
	 * Remove a value from storage
	 */
	async remove(key: string): Promise<void> {
		await chrome.storage.local.remove(key)
	},

	/**
	 * Get multiple values
	 */
	async getMany<T extends Record<string, unknown>>(
		keys: string[],
	): Promise<Partial<T>> {
		return chrome.storage.local.get(keys) as Promise<Partial<T>>
	},

	/**
	 * Set multiple values
	 */
	async setMany(items: Record<string, unknown>): Promise<void> {
		await chrome.storage.local.set(items)
	},
}
