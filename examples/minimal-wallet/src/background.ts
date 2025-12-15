/**
 * Background service worker - Wallet logic
 *
 * Handles all wallet operations: key management, signing, balance checks
 */

import {
	createBackgroundHandler,
	openApprovalPopup,
	keepAlive,
	UserRejectedError,
	UnauthorizedError,
	type ConnectResult,
	type SignMessageResult,
	type BalanceResult,
	type Utxo,
} from '@1sat/extension'
import { PrivateKey, BSM, BigNumber, Hash, type PublicKey } from '@bsv/sdk'

// Storage keys
const STORAGE_KEYS = {
	PRIVATE_KEY: 'wallet_private_key',
	CONNECTED_SITES: 'connected_sites',
} as const

/**
 * Get or create the wallet's private key
 */
async function getOrCreatePrivateKey(): Promise<PrivateKey> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.PRIVATE_KEY)
	if (result[STORAGE_KEYS.PRIVATE_KEY]) {
		return PrivateKey.fromWif(result[STORAGE_KEYS.PRIVATE_KEY])
	}

	// Generate new key
	const pk = PrivateKey.fromRandom()
	await chrome.storage.local.set({
		[STORAGE_KEYS.PRIVATE_KEY]: pk.toWif(),
	})
	return pk
}

/**
 * Get connected sites
 */
async function getConnectedSites(): Promise<string[]> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.CONNECTED_SITES)
	return result[STORAGE_KEYS.CONNECTED_SITES] || []
}

/**
 * Add connected site
 */
async function addConnectedSite(origin: string): Promise<void> {
	const sites = await getConnectedSites()
	if (!sites.includes(origin)) {
		sites.push(origin)
		await chrome.storage.local.set({ [STORAGE_KEYS.CONNECTED_SITES]: sites })
	}
}

/**
 * Remove connected site
 */
async function removeConnectedSite(origin: string): Promise<void> {
	const sites = await getConnectedSites()
	const filtered = sites.filter((s) => s !== origin)
	await chrome.storage.local.set({ [STORAGE_KEYS.CONNECTED_SITES]: filtered })
}

/**
 * Check if site is connected
 */
async function isSiteConnected(origin: string): Promise<boolean> {
	const sites = await getConnectedSites()
	return sites.includes(origin)
}

/**
 * Fetch balance from WhatsOnChain API
 */
async function fetchBalance(address: string): Promise<number> {
	const response = await fetch(
		`https://api.whatsonchain.com/v1/bsv/main/address/${address}/balance`,
	)
	if (!response.ok) {
		throw new Error('Failed to fetch balance')
	}
	const data = await response.json()
	return data.confirmed + data.unconfirmed
}

/**
 * Fetch UTXOs from WhatsOnChain API
 */
async function fetchUtxos(address: string): Promise<Utxo[]> {
	const response = await fetch(
		`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
	)
	if (!response.ok) {
		throw new Error('Failed to fetch UTXOs')
	}
	const data = await response.json()
	return data.map(
		(u: { tx_hash: string; tx_pos: number; value: number; script?: string }) => ({
			txid: u.tx_hash,
			vout: u.tx_pos,
			satoshis: u.value,
			script: u.script || '',
		}),
	)
}

// Set up the background handler
const { broadcast } = createBackgroundHandler({
	handlers: {
		/**
		 * Connect - Shows approval popup, returns addresses
		 */
		async connect(_request, sender) {
			const origin = sender.origin
			if (!origin) throw new UnauthorizedError('No origin')

			// Check if already connected
			if (await isSiteConnected(origin)) {
				const pk = await getOrCreatePrivateKey()
				const address = pk.toAddress().toString()
				return {
					paymentAddress: address,
					ordinalAddress: address,
					identityPubKey: pk.toPublicKey().toString(),
				} as ConnectResult
			}

			// Show approval popup
			const approved = await keepAlive(() =>
				openApprovalPopup('/popup/connect.html', { origin }),
			)

			if (!approved) {
				throw new UserRejectedError('Connection rejected')
			}

			// Store connection
			await addConnectedSite(origin)

			const pk = await getOrCreatePrivateKey()
			const address = pk.toAddress().toString()

			return {
				paymentAddress: address,
				ordinalAddress: address,
				identityPubKey: pk.toPublicKey().toString(),
			} as ConnectResult
		},

		/**
		 * Disconnect - Removes site from connected list
		 */
		async disconnect(_request, sender) {
			if (sender.origin) {
				await removeConnectedSite(sender.origin)
			}
		},

		/**
		 * Check if connected
		 */
		async isConnected(_request, sender) {
			if (!sender.origin) return false
			return isSiteConnected(sender.origin)
		},

		/**
		 * Sign message - Shows approval popup, returns BSM signature
		 */
		async signMessage(request, sender) {
			if (!sender.origin || !(await isSiteConnected(sender.origin))) {
				throw new UnauthorizedError('Not connected')
			}

			const { message } = request.params as { message: string }

			// Show approval popup
			const approved = await keepAlive(() =>
				openApprovalPopup('/popup/sign.html', {
					origin: sender.origin,
					message,
				}),
			)

			if (!approved) {
				throw new UserRejectedError('Signing rejected')
			}

			// Sign the message using BSM
			const pk = await getOrCreatePrivateKey()
			const address = pk.toAddress().toString()

			// BSM signature
			const signature = BSM.sign(
				Array.from(new TextEncoder().encode(message)),
				pk,
			)

			return {
				address,
				message,
				sig: signature.toString('base64'),
			} as SignMessageResult
		},

		/**
		 * Get balance
		 */
		async getBalance(_request, sender) {
			if (!sender.origin || !(await isSiteConnected(sender.origin))) {
				throw new UnauthorizedError('Not connected')
			}

			const pk = await getOrCreatePrivateKey()
			const address = pk.toAddress().toString()
			const satoshis = await fetchBalance(address)

			return { satoshis } as BalanceResult
		},

		/**
		 * Get UTXOs
		 */
		async getUtxos(_request, sender) {
			if (!sender.origin || !(await isSiteConnected(sender.origin))) {
				throw new UnauthorizedError('Not connected')
			}

			const pk = await getOrCreatePrivateKey()
			const address = pk.toAddress().toString()
			return fetchUtxos(address)
		},

		/**
		 * Get addresses
		 */
		async getAddresses(_request, sender) {
			if (!sender.origin || !(await isSiteConnected(sender.origin))) {
				return null
			}

			const pk = await getOrCreatePrivateKey()
			const address = pk.toAddress().toString()
			return {
				paymentAddress: address,
				ordinalAddress: address,
			}
		},

		/**
		 * Get identity public key
		 */
		async getIdentityPubKey(_request, sender) {
			if (!sender.origin || !(await isSiteConnected(sender.origin))) {
				return null
			}

			const pk = await getOrCreatePrivateKey()
			return pk.toPublicKey().toString()
		},
	},

	// Auto-approve read-only methods
	shouldAutoApprove(request) {
		const readOnlyMethods = [
			'getBalance',
			'getUtxos',
			'getOrdinals',
			'getTokens',
			'isConnected',
			'getAddresses',
			'getIdentityPubKey',
			'__init__',
		]
		return readOnlyMethods.includes(request.method)
	},

	onConnect(tabId, origin) {
		console.log(`[minimal-wallet] Connected: ${origin} (tab ${tabId})`)
	},

	onDisconnect(tabId, origin) {
		console.log(`[minimal-wallet] Disconnected: ${origin} (tab ${tabId})`)
	},
})

// Export broadcast for potential future use
;(globalThis as unknown as { walletBroadcast: typeof broadcast }).walletBroadcast = broadcast

console.log('[minimal-wallet] Background service worker started')
