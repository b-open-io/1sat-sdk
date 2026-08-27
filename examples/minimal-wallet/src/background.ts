/**
 * Background service worker - Wallet logic
 *
 * Handles all wallet operations: key management, signing, balance checks
 * Uses KeyStore from @1sat/extension/keys for encrypted key storage.
 */

import {
	type BalanceResult,
	type ConnectResult,
	createBackgroundHandler,
	keepAlive,
	openApprovalPopup,
	type SignMessageResult,
	UnauthorizedError,
	UserRejectedError,
	type Utxo,
} from '@1sat/extension'
import { KeyStore } from '@1sat/extension/keys'
import { BSM } from '@bsv/sdk'
import browser from 'webextension-polyfill'

// Storage key for connected sites
const CONNECTED_SITES_KEY = 'connected_sites'

// Create the KeyStore instance
const keyStore = new KeyStore()

/**
 * Get connected sites
 */
async function getConnectedSites(): Promise<string[]> {
	const result = await browser.storage.local.get(CONNECTED_SITES_KEY)
	return (result[CONNECTED_SITES_KEY] as string[]) || []
}

/**
 * Add connected site
 */
async function addConnectedSite(origin: string): Promise<void> {
	const sites = await getConnectedSites()
	if (!sites.includes(origin)) {
		sites.push(origin)
		await browser.storage.local.set({ [CONNECTED_SITES_KEY]: sites })
	}
}

/**
 * Remove connected site
 */
async function removeConnectedSite(origin: string): Promise<void> {
	const sites = await getConnectedSites()
	const filtered = sites.filter((s) => s !== origin)
	await browser.storage.local.set({ [CONNECTED_SITES_KEY]: filtered })
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
		(u: {
			tx_hash: string
			tx_pos: number
			value: number
			script?: string
		}) => ({
			txid: u.tx_hash,
			vout: u.tx_pos,
			satoshis: u.value,
			script: u.script || '',
		}),
	)
}

// Internal message types for wallet management
interface WalletMessage {
	type: string
	passphrase?: string
	wif?: string
}

// Listen for internal wallet management messages from popup
browser.runtime.onMessage.addListener((message: unknown) => {
	const msg = message as WalletMessage
	if (!msg?.type?.startsWith('WALLET_')) return

	// Handle wallet management messages
	switch (msg.type) {
		case 'WALLET_GET_STATE':
			return keyStore.getState()

		case 'WALLET_IS_UNLOCKED':
			return Promise.resolve(keyStore.isUnlocked())

		case 'WALLET_GET_ADDRESSES':
			return keyStore.getAddresses()

		case 'WALLET_GENERATE':
			if (!msg.passphrase) {
				return Promise.resolve({ error: 'Passphrase required' })
			}
			keyStore.generate()
			return keyStore.lock(msg.passphrase).then(() => keyStore.getAddresses())

		case 'WALLET_IMPORT_WIF':
			if (!msg.wif || !msg.passphrase) {
				return Promise.resolve({ error: 'WIF and passphrase required' })
			}
			keyStore.importSingleWif(msg.wif)
			return keyStore.lock(msg.passphrase).then(() => keyStore.getAddresses())

		case 'WALLET_UNLOCK':
			if (!msg.passphrase) {
				return Promise.resolve({ error: 'Passphrase required' })
			}
			return keyStore
				.unlock(msg.passphrase)
				.then(() => ({ success: true }))
				.catch((err: Error) => ({ error: err.message }))

		case 'WALLET_LOCK':
			keyStore.clearMemory()
			return Promise.resolve({ success: true })

		case 'WALLET_EXPORT_BACKUP':
			if (!msg.passphrase) {
				return Promise.resolve({ error: 'Passphrase required' })
			}
			if (!keyStore.isUnlocked()) {
				return Promise.resolve({ error: 'Wallet is locked' })
			}
			return keyStore
				.exportBackup(msg.passphrase)
				.then((backup) => ({ backup }))
				.catch((err: Error) => ({ error: err.message }))

		default:
			return
	}
})

// Set up the background handler
const { broadcast } = createBackgroundHandler({
	handlers: {
		/**
		 * Connect - Shows approval popup, returns addresses
		 */
		async connect(_request, sender) {
			const origin = sender.origin
			if (!origin) throw new UnauthorizedError('No origin')

			// Check if wallet exists
			const state = await keyStore.getState()
			if (state === 'empty') {
				throw new UnauthorizedError('No wallet configured')
			}

			// Check if already connected
			if (await isSiteConnected(origin)) {
				const addresses = await keyStore.getAddresses()
				if (!addresses) {
					throw new UnauthorizedError('Wallet not available')
				}
				return {
					paymentAddress: addresses.paymentAddress,
					ordinalAddress: addresses.ordinalAddress,
					identityPubKey: addresses.identityPubKey,
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

			const addresses = await keyStore.getAddresses()
			if (!addresses) {
				throw new UnauthorizedError('Wallet not available')
			}

			return {
				paymentAddress: addresses.paymentAddress,
				ordinalAddress: addresses.ordinalAddress,
				identityPubKey: addresses.identityPubKey,
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

			// Must be unlocked to sign
			if (!keyStore.isUnlocked()) {
				throw new UnauthorizedError('Wallet is locked')
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
			const keys = keyStore.getKeys()
			const address = keys.paymentKey.toAddress()

			// BSM signature
			const signature = BSM.sign(
				Array.from(new TextEncoder().encode(message)),
				keys.paymentKey,
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

			const addresses = await keyStore.getAddresses()
			if (!addresses) {
				throw new UnauthorizedError('Wallet not available')
			}

			const satoshis = await fetchBalance(addresses.paymentAddress)
			return { satoshis } as BalanceResult
		},

		/**
		 * Get UTXOs
		 */
		async getUtxos(_request, sender) {
			if (!sender.origin || !(await isSiteConnected(sender.origin))) {
				throw new UnauthorizedError('Not connected')
			}

			const addresses = await keyStore.getAddresses()
			if (!addresses) {
				throw new UnauthorizedError('Wallet not available')
			}

			return fetchUtxos(addresses.paymentAddress)
		},

		/**
		 * Get addresses
		 */
		async getAddresses(_request, sender) {
			if (!sender.origin || !(await isSiteConnected(sender.origin))) {
				return null
			}

			const addresses = await keyStore.getAddresses()
			if (!addresses) return null

			return {
				paymentAddress: addresses.paymentAddress,
				ordinalAddress: addresses.ordinalAddress,
			}
		},

		/**
		 * Get identity public key
		 */
		async getIdentityPubKey(_request, sender) {
			if (!sender.origin || !(await isSiteConnected(sender.origin))) {
				return null
			}

			const addresses = await keyStore.getAddresses()
			return addresses?.identityPubKey ?? null
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
;(
	globalThis as unknown as { walletBroadcast: typeof broadcast }
).walletBroadcast = broadcast

console.log('[minimal-wallet] Background service worker started')
