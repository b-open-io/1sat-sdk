import EventEmitter from 'eventemitter3'
import { WalletNotConnectedError, fromErrorResponse } from './errors'
import { isResponse, isValidMessage } from './messages'
import { PopupManager } from './popup'
import {
	type StoredConnection,
	clearConnection,
	loadConnection,
	saveConnection,
} from './storage'
import {
	type BalanceResult,
	type CancelListingRequest,
	type ConnectParams,
	type ConnectResult,
	type CreateListingRequest,
	type EventHandler,
	type InscribeRequest,
	type InscribeResult,
	type ListOptions,
	type ListingResult,
	type OneSatConfig,
	type OneSatEvent,
	type OneSatProvider,
	type OrdinalOutput,
	type PurchaseListingRequest,
	type RpcMethod,
	RpcMethods,
	type SendOrdinalsRequest,
	type SendResult,
	type SignMessageResult,
	type SignTransactionRequest,
	type SignTransactionResult,
	type TokenOutput,
	type TransferTokenRequest,
	type Utxo,
} from './types'

const DEFAULT_POPUP_URL = 'https://www.1satwallet.com'
const DEFAULT_TIMEOUT = 300_000 // 5 minutes

/**
 * Browser implementation of the OneSat wallet provider
 * Uses popup-based communication with the wallet
 */
export class OneSatBrowserProvider implements OneSatProvider {
	/** Identifies this as the OneSat provider (for detection like Phantom's isPhantom) */
	readonly isOneSat = true as const

	private popupManager: PopupManager
	private connection: StoredConnection | null = null
	private events = new EventEmitter()
	private popupOrigin: string

	constructor(config?: OneSatConfig) {
		const popupUrl = config?.popupUrl ?? DEFAULT_POPUP_URL

		this.popupManager = new PopupManager({
			popupUrl,
			timeout: config?.timeout ?? DEFAULT_TIMEOUT,
			appName: config?.appName,
		})

		// Extract origin from popup URL for message validation
		this.popupOrigin = new URL(popupUrl).origin

		// Load existing connection from storage
		this.connection = loadConnection()

		// Listen for messages from popup
		if (typeof window !== 'undefined') {
			window.addEventListener('message', this.handleMessage)
		}
	}

	/**
	 * Handle messages from the wallet popup
	 */
	private handleMessage = (event: MessageEvent) => {
		let eventOrigin: string
		let eventData: unknown
		try {
			eventOrigin = event.origin
			eventData = event.data
		} catch {
			return
		}

		// Validate origin
		if (eventOrigin !== this.popupOrigin) return

		// Validate message format
		if (!isValidMessage(eventData)) return

		// Only handle responses
		if (!isResponse(eventData)) return

		const { requestId, result, error } = eventData

		// Check if we have a pending request for this
		if (!this.popupManager.hasPendingRequest(requestId)) return

		if (error) {
			this.popupManager.rejectRequest(requestId, fromErrorResponse(error))
		} else {
			this.popupManager.resolveRequest(requestId, result)
		}
	}

	/**
	 * Generate a unique request ID
	 */
	private generateRequestId(): string {
		return crypto.randomUUID()
	}

	/**
	 * Send a request that requires popup approval
	 */
	private async sendRequest<T>(
		method: RpcMethod,
		params?: unknown,
	): Promise<T> {
		const requestId = this.generateRequestId()
		return this.popupManager.openPopup<T>(method, requestId, params)
	}

	// Connection methods

	async connect(params?: ConnectParams): Promise<ConnectResult> {
		const result = await this.sendRequest<ConnectResult>(
			RpcMethods.CONNECT,
			params?.challenge ? { challenge: params.challenge } : undefined,
		)

		// Save connection to storage
		this.connection = {
			...result,
			connectedAt: Date.now(),
		}
		saveConnection(result)

		// Emit connect event
		this.events.emit('connect', result)

		return result
	}

	async disconnect(): Promise<void> {
		this.connection = null
		clearConnection()
		this.events.emit('disconnect', undefined)
	}

	isConnected(): boolean {
		return this.connection !== null
	}

	/**
	 * Get the current connection (throws if not connected)
	 */
	private requireConnection(): StoredConnection {
		if (!this.connection) {
			throw new WalletNotConnectedError()
		}
		return this.connection
	}

	// Signing methods

	async signTransaction(
		request: SignTransactionRequest,
	): Promise<SignTransactionResult> {
		this.requireConnection()
		return this.sendRequest<SignTransactionResult>(
			RpcMethods.SIGN_TRANSACTION,
			request,
		)
	}

	async signMessage(message: string): Promise<SignMessageResult> {
		this.requireConnection()
		return this.sendRequest<SignMessageResult>(RpcMethods.SIGN_MESSAGE, {
			message,
		})
	}

	// Ordinal methods

	async inscribe(request: InscribeRequest): Promise<InscribeResult> {
		this.requireConnection()
		return this.sendRequest<InscribeResult>(RpcMethods.INSCRIBE, request)
	}

	async sendOrdinals(request: SendOrdinalsRequest): Promise<SendResult> {
		this.requireConnection()
		return this.sendRequest<SendResult>(RpcMethods.SEND_ORDINALS, request)
	}

	// Listing methods

	async createListing(request: CreateListingRequest): Promise<ListingResult> {
		this.requireConnection()
		return this.sendRequest<ListingResult>(RpcMethods.CREATE_LISTING, request)
	}

	async purchaseListing(request: PurchaseListingRequest): Promise<SendResult> {
		this.requireConnection()
		return this.sendRequest<SendResult>(RpcMethods.PURCHASE_LISTING, request)
	}

	async cancelListing(request: CancelListingRequest): Promise<SendResult> {
		this.requireConnection()
		return this.sendRequest<SendResult>(RpcMethods.CANCEL_LISTING, request)
	}

	// Token methods

	async transferToken(request: TransferTokenRequest): Promise<SendResult> {
		this.requireConnection()
		return this.sendRequest<SendResult>(RpcMethods.TRANSFER_TOKEN, request)
	}

	// Read-only methods

	async getBalance(): Promise<BalanceResult> {
		this.requireConnection()
		return this.sendRequest<BalanceResult>(RpcMethods.GET_BALANCE)
	}

	async getOrdinals(options?: ListOptions): Promise<OrdinalOutput[]> {
		this.requireConnection()
		return this.sendRequest<OrdinalOutput[]>(RpcMethods.GET_ORDINALS, options)
	}

	async getTokens(options?: ListOptions): Promise<TokenOutput[]> {
		this.requireConnection()
		return this.sendRequest<TokenOutput[]>(RpcMethods.GET_TOKENS, options)
	}

	async getUtxos(): Promise<Utxo[]> {
		this.requireConnection()
		return this.sendRequest<Utxo[]>(RpcMethods.GET_UTXOS)
	}

	// Event methods

	on<T = unknown>(event: OneSatEvent, handler: EventHandler<T>): void {
		this.events.on(event, handler)
	}

	off(event: OneSatEvent, handler: EventHandler): void {
		this.events.off(event, handler)
	}

	// Utility methods

	getAddresses(): { paymentAddress: string; ordinalAddress: string } | null {
		if (!this.connection) return null
		return {
			paymentAddress: this.connection.paymentAddress,
			ordinalAddress: this.connection.ordinalAddress,
		}
	}

	getIdentityPubKey(): string | null {
		return this.connection?.identityPubKey ?? null
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {
		if (typeof window !== 'undefined') {
			window.removeEventListener('message', this.handleMessage)
		}
		this.popupManager.destroy()
		this.events.removeAllListeners()
	}
}
