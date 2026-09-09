import type {
	ClientOptions,
	SubmitOptions,
	TransactionStatus,
} from '@1sat/types'
import { Utils } from '@bsv/sdk'
import { BaseClient } from './BaseClient.js'

export interface ArcadeMiningFee {
	satoshis: number
	bytes: number
}

export interface ArcadePolicy {
	miningFee: ArcadeMiningFee
	maxtxsizepolicy?: number
	maxscriptsizepolicy?: number
	maxtxsigopscountspolicy?: number
	standardFormatSupported?: boolean
}

export interface ArcadePolicyResponse {
	policy: ArcadePolicy
	timestamp?: string
}

/**
 * HTTP client for an Arcade root (POST /tx, GET /tx/:txid, GET /policy).
 * Pass the Arcade host, or `{stack}/1sat/arcade` for the 1sat-stack wrap.
 */
export class ArcadeClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(baseUrl, options)
	}

	/**
	 * Submit a single transaction for broadcast
	 */
	async submitTransaction(
		rawTx: number[] | Uint8Array,
		options?: SubmitOptions,
	): Promise<TransactionStatus> {
		const bytes = rawTx instanceof Uint8Array ? rawTx : new Uint8Array(rawTx)
		return this.request<TransactionStatus>(
			'/tx',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/octet-stream',
					...this.buildSubmitHeaders(options),
				},
				body: bytes as unknown as BodyInit,
			},
			{ allow: [400] },
		)
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
	): Promise<{ submitted: number; duplicates: number; total: number }> {
		const chunks = rawTxs.map((tx) =>
			tx instanceof Uint8Array ? tx : new Uint8Array(tx),
		)
		let offset = 0
		const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
		for (const chunk of chunks) {
			body.set(chunk, offset)
			offset += chunk.length
		}
		return this.request('/txs', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				...this.buildSubmitHeaders(options),
			},
			body: body as unknown as BodyInit,
		})
	}

	/**
	 * Get status of a submitted transaction
	 */
	async getStatus(txid: string): Promise<TransactionStatus> {
		return this.request<TransactionStatus>(`/tx/${txid}`)
	}

	async getPolicy(): Promise<ArcadePolicyResponse> {
		return this.request<ArcadePolicyResponse>('/policy')
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
