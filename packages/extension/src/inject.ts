/**
 * Inject script - Creates window.onesat provider
 *
 * This script is injected into web pages and creates the window.onesat
 * provider that dApps use to communicate with the extension.
 */

import type {
	OneSatProvider,
	OneSatEvent,
	EventHandler,
	ConnectResult,
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
	ListOptions,
	Utxo,
} from './provider-types'
import {
	MessageType,
	RpcMethod,
	type ExtensionRequest,
	type ExtensionResponse,
	type ExtensionEvent,
	type RpcMethodValue,
	type InjectOptions,
	type InitState,
} from './types'
import { fromExtensionError } from './errors'

/** Message source identifier */
const MESSAGE_SOURCE = 'onesat-inject'

/** Generate unique request ID */
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Create a method that sends requests to the content script
 */
function createMethod<TParams, TResult>(method: RpcMethodValue) {
	return (params?: TParams): Promise<TResult> => {
		return new Promise((resolve, reject) => {
			const id = generateId()

			const request: ExtensionRequest<TParams> = {
				type: MessageType.REQUEST,
				id,
				method,
				params,
			}

			// Listen for response
			function handleResponse(event: MessageEvent) {
				// Only handle messages from content script
				if (event.source !== window) return
				if (!event.data || event.data.source !== 'onesat-content') return

				const response = event.data.payload as ExtensionResponse<TResult>
				if (response.type !== MessageType.RESPONSE) return
				if (response.id !== id) return

				// Remove listener
				window.removeEventListener('message', handleResponse)

				if (response.error) {
					reject(fromExtensionError(response.error))
				} else {
					resolve(response.result as TResult)
				}
			}

			window.addEventListener('message', handleResponse)

			// Send request to content script
			window.postMessage(
				{
					source: MESSAGE_SOURCE,
					payload: request,
				},
				'*',
			)
		})
	}
}

/**
 * Inject the OneSat provider into the page
 */
export function injectOneSatProvider(options: InjectOptions = {}): void {
	// Don't inject if already present
	if (typeof window !== 'undefined' && window.onesat?.isOneSat) {
		return
	}

	// Event listeners
	const eventListeners = new Map<OneSatEvent, Set<EventHandler>>()

	// Connection state (cached locally for sync access)
	let connected = false
	let addresses: { paymentAddress: string; ordinalAddress: string } | null =
		null
	let identityPubKey: string | null = null

	// Create the provider
	const provider: OneSatProvider = {
		isOneSat: true as const,

		// Connection methods
		async connect(): Promise<ConnectResult> {
			const result = await createMethod<void, ConnectResult>('connect')()
			connected = true
			addresses = {
				paymentAddress: result.paymentAddress,
				ordinalAddress: result.ordinalAddress,
			}
			identityPubKey = result.identityPubKey
			return result
		},

		async disconnect(): Promise<void> {
			await createMethod<void, void>('disconnect')()
			connected = false
			addresses = null
			identityPubKey = null
		},

		isConnected(): boolean {
			return connected
		},

		// Signing
		signTransaction: createMethod<SignTransactionRequest, SignTransactionResult>(
			'signTransaction',
		),

		async signMessage(message: string): Promise<SignMessageResult> {
			return createMethod<{ message: string }, SignMessageResult>('signMessage')(
				{ message },
			)
		},

		// Ordinals
		inscribe: createMethod<InscribeRequest, InscribeResult>('inscribe'),
		sendOrdinals: createMethod<SendOrdinalsRequest, SendResult>('sendOrdinals'),

		// Listings
		createListing: createMethod<CreateListingRequest, ListingResult>(
			'createListing',
		),
		purchaseListing: createMethod<PurchaseListingRequest, SendResult>(
			'purchaseListing',
		),
		cancelListing: createMethod<CancelListingRequest, SendResult>(
			'cancelListing',
		),

		// Tokens
		transferToken: createMethod<TransferTokenRequest, SendResult>(
			'transferToken',
		),

		// Read-only
		getBalance: createMethod<void, BalanceResult>('getBalance'),
		getOrdinals: createMethod<ListOptions | undefined, OrdinalOutput[]>(
			'getOrdinals',
		),
		getTokens: createMethod<ListOptions | undefined, TokenOutput[]>('getTokens'),
		getUtxos: createMethod<void, Utxo[]>('getUtxos'),

		// Events
		on<T = unknown>(event: OneSatEvent, handler: EventHandler<T>): void {
			if (!eventListeners.has(event)) {
				eventListeners.set(event, new Set())
			}
			eventListeners.get(event)!.add(handler as EventHandler)
		},

		off(event: OneSatEvent, handler: EventHandler): void {
			eventListeners.get(event)?.delete(handler)
		},

		// Utility
		getAddresses(): { paymentAddress: string; ordinalAddress: string } | null {
			return addresses
		},

		getIdentityPubKey(): string | null {
			return identityPubKey
		},
	}

	// Listen for events from content script
	window.addEventListener('message', (event: MessageEvent) => {
		if (event.source !== window) return
		if (!event.data || event.data.source !== 'onesat-content') return

		const message = event.data.payload as ExtensionEvent
		if (message.type !== MessageType.EVENT) return

		// Update local state on events
		if (message.event === 'connect') {
			connected = true
			const data = message.data as ConnectResult
			addresses = {
				paymentAddress: data.paymentAddress,
				ordinalAddress: data.ordinalAddress,
			}
			identityPubKey = data.identityPubKey
		} else if (message.event === 'disconnect') {
			connected = false
			addresses = null
			identityPubKey = null
		} else if (message.event === 'accountChange') {
			const data = message.data as { paymentAddress: string; ordinalAddress: string }
			addresses = data
		}

		// Emit to listeners
		const listeners = eventListeners.get(message.event)
		if (listeners) {
			for (const handler of listeners) {
				try {
					handler(message.data)
				} catch (err) {
					console.error('[onesat] Event handler error:', err)
				}
			}
		}
	})

	// Freeze and expose the provider
	const frozenProvider = Object.freeze(provider)

	Object.defineProperty(window, 'onesat', {
		value: frozenProvider,
		writable: false,
		configurable: false,
	})

	// Sync initial state from background (async, updates local cache)
	// This ensures isConnected(), getAddresses(), etc. return correct values on page refresh
	createMethod<void, InitState>(RpcMethod.INIT)()
		.then((initState) => {
			connected = initState.isConnected
			addresses = initState.addresses
			identityPubKey = initState.identityPubKey

			// Dispatch ready event after state is synced
			window.dispatchEvent(new Event('onesat:ready'))

			if (options.walletName) {
				console.log(
					`[onesat] ${options.walletName} provider ready`,
					initState.isConnected ? '(connected)' : '(not connected)',
				)
			}
		})
		.catch((err) => {
			// Init failed (extension not responding), still dispatch ready
			console.warn('[onesat] Init failed:', err)
			window.dispatchEvent(new Event('onesat:ready'))
		})
}

// Auto-inject if this script is loaded directly
if (typeof window !== 'undefined') {
	injectOneSatProvider()
}
