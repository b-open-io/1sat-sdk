import { OneSatBrowserProvider } from './provider'
import type { OneSatConfig, OneSatProvider } from './types'

// Export types
export type {
	ConnectResult,
	OneSatConfig,
	OneSatProvider,
	OneSatEvent,
	EventHandler,
	RpcMethod,
	SignTransactionRequest,
	SignTransactionResult,
	SignMessageResult,
	InscribeRequest,
	InscribeResult,
	SendOrdinalsRequest,
	SendResult,
	CreateListingRequest,
	ListingResult,
	PurchaseListingRequest,
	CancelListingRequest,
	TransferTokenRequest,
	BalanceResult,
	OrdinalOutput,
	TokenOutput,
	Utxo,
	ListOptions,
} from './types'

export { RpcMethods } from './types'

// Export errors
export {
	ErrorCodes,
	type ErrorCode,
	OneSatError,
	UserRejectedError,
	WalletLockedError,
	WalletNotConnectedError,
	InsufficientFundsError,
	PopupBlockedError,
	PopupClosedError,
	TimeoutError,
	fromErrorResponse,
} from './errors'

// Export messages
export {
	PROTOCOL_VERSION,
	MessageTypes,
	type MessageType,
	type BaseMessage,
	type RequestMessage,
	type ResponseMessage,
	type ProtocolMessage,
	createRequest,
	createResponse,
	createErrorResponse,
	isValidMessage,
	isResponse,
} from './messages'

// Export storage utilities
export {
	saveConnection,
	loadConnection,
	clearConnection,
	hasStoredConnection,
	type StoredConnection,
} from './storage'

// Export provider
export { OneSatBrowserProvider } from './provider'
export { PopupManager, type PopupConfig, type PendingRequest } from './popup'

/**
 * Create a new OneSat provider instance
 *
 * @example
 * ```typescript
 * import { createOneSat } from '@1sat/connect'
 *
 * const onesat = createOneSat({
 *   appName: 'My dApp',
 * })
 *
 * // Connect to wallet
 * const { paymentAddress, ordinalAddress } = await onesat.connect()
 *
 * // Sign a transaction
 * const result = await onesat.signTransaction({ rawtx })
 * ```
 */
export function createOneSat(config?: OneSatConfig): OneSatProvider {
	const provider = new OneSatBrowserProvider(config)

	// Inject into window
	if (typeof window !== 'undefined') {
		window.onesat = provider
	}

	return provider
}

/**
 * Get the existing provider from window.onesat or create a new one
 */
export function getOneSat(config?: OneSatConfig): OneSatProvider {
	if (typeof window !== 'undefined' && window.onesat) {
		return window.onesat
	}
	return createOneSat(config)
}

/**
 * Check if the OneSat provider is available
 */
export function isOneSatAvailable(): boolean {
	return typeof window !== 'undefined' && window.onesat !== undefined
}

/**
 * Wait for the OneSat provider to be available
 */
export function waitForOneSat(timeout = 5000): Promise<OneSatProvider> {
	return new Promise((resolve, reject) => {
		if (isOneSatAvailable()) {
			resolve(window.onesat!)
			return
		}

		const startTime = Date.now()

		const checkInterval = setInterval(() => {
			if (isOneSatAvailable()) {
				clearInterval(checkInterval)
				resolve(window.onesat!)
				return
			}

			if (Date.now() - startTime > timeout) {
				clearInterval(checkInterval)
				reject(new Error('Timeout waiting for OneSat provider'))
			}
		}, 100)
	})
}
