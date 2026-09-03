import type {
	ClientOptions,
	SubmitOptions,
	TransactionStatus,
} from '@1sat/types'
import { Utils } from '@bsv/sdk'
import { BaseClient } from './BaseClient.js'

/**
 * Client for /1sat/arcade/* routes.
 * Provides transaction broadcast and status checking.
 *
 * Routes:
 * - POST /tx - Submit single transaction
 * - POST /txs - Submit multiple transactions
 * - GET /tx/:txid - Get transaction status
 * - GET /policy - Get mining policy
 * - GET /events - SSE stream of transaction events
 */
export class ArcadeClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/arcade`, options)
	}

	/**
	 * Submit a single transaction for broadcast
	 */
	async submitTransaction(
		rawTx: number[] | Uint8Array,
		options?: SubmitOptions,
	): Promise<TransactionStatus> {
		const bytes = rawTx instanceof Uint8Array ? rawTx : new Uint8Array(rawTx)
		return this.request<TransactionStatus>('/tx', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				...this.buildSubmitHeaders(options),
			},
			body: bytes as unknown as BodyInit,
		})
	}

	/**
	 * Submit a transaction as hex string
	 */
	async submitTransactionHex(
		rawTxHex: string,
		options?: SubmitOptions,
	): Promise<TransactionStatus> {
		return this.submitTransaction(Utils.toArray(rawTxHex, 'hex'), options)
	}

	/**
	 * Submit multiple transactions for broadcast
	 */
	async submitTransactions(
		rawTxs: (number[] | Uint8Array)[],
		options?: SubmitOptions,
	): Promise<TransactionStatus[]> {
		return this.request<TransactionStatus[]>('/txs', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...this.buildSubmitHeaders(options),
			},
			body: JSON.stringify(
				rawTxs.map((tx) => ({
					rawTx: Utils.toHex(tx instanceof Uint8Array ? Array.from(tx) : tx),
				})),
			),
		})
	}

	/**
	 * Get status of a submitted transaction
	 */
	async getStatus(txid: string): Promise<TransactionStatus> {
		return this.request<TransactionStatus>(`/tx/${txid}`)
	}

	/**
	 * Subscribe to transaction status events via SSE
	 * Returns unsubscribe function
	 */
	subscribeEvents(
		callback: (status: TransactionStatus) => void,
		callbackToken?: string,
	): () => void {
		const url = callbackToken
			? `${this.baseUrl}/events?token=${encodeURIComponent(callbackToken)}`
			: `${this.baseUrl}/events`

		const eventSource = new EventSource(url)

		eventSource.onmessage = (event) => {
			try {
				const status = JSON.parse(event.data) as TransactionStatus
				callback(status)
			} catch {
				// Ignore parse errors
			}
		}

		eventSource.onerror = () => {
			eventSource.close()
		}

		return () => {
			eventSource.close()
		}
	}

	/**
	 * Build headers for submit requests
	 */
	private buildSubmitHeaders(options?: SubmitOptions): Record<string, string> {
		const headers: Record<string, string> = {}
		if (options?.callbackUrl) headers['X-CallbackUrl'] = options.callbackUrl
		if (options?.callbackToken)
			headers['X-CallbackToken'] = options.callbackToken
		if (options?.fullStatusUpdates) headers['X-FullStatusUpdates'] = 'true'
		if (options?.skipFeeValidation) headers['X-SkipFeeValidation'] = 'true'
		if (options?.skipScriptValidation)
			headers['X-SkipScriptValidation'] = 'true'
		return headers
	}
}
