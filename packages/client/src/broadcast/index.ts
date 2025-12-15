/**
 * Transaction broadcaster for 1Sat API
 *
 * Broadcasts transactions to the BSV network via the 1Sat API
 */

import { API_HOST } from '@1sat/constants'
import type {
	BroadcastFailure,
	BroadcastResponse,
	Broadcaster,
	HttpClient,
	Transaction,
} from '@bsv/sdk'
import { Utils } from '@bsv/sdk'
import { createHttpClient } from '../http'

const { toBase64 } = Utils

/**
 * Configuration options for the broadcaster
 */
export interface BroadcasterConfig {
	/** API host URL (defaults to mainnet) */
	apiHost?: string
	/** Custom HTTP client */
	httpClient?: HttpClient
}

/**
 * 1Sat API transaction broadcaster
 *
 * Implements the @bsv/sdk Broadcaster interface for compatibility
 * with the Transaction class's broadcast() method.
 */
export class OneSatBroadcaster implements Broadcaster {
	private readonly url: string
	private readonly httpClient: HttpClient

	constructor(config: BroadcasterConfig = {}) {
		const { apiHost = API_HOST, httpClient } = config
		this.url = `${apiHost}/tx`
		this.httpClient = httpClient ?? createHttpClient()
	}

	/**
	 * Broadcast a transaction to the network
	 *
	 * @param tx - Transaction to broadcast
	 * @returns Broadcast result with txid on success
	 */
	async broadcast(
		tx: Transaction,
	): Promise<BroadcastResponse | BroadcastFailure> {
		const rawtx = toBase64(tx.toBinary())

		try {
			const response = await this.httpClient.request<
				string | { message?: string }
			>(this.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				data: { rawtx },
			})

			if (response.ok) {
				const txid =
					typeof response.data === 'string'
						? response.data
						: (tx.id('hex') as string)
				return {
					status: 'success',
					txid,
					message: 'broadcast successful',
				}
			}

			const errorMsg =
				typeof response.data === 'object' && response.data?.message
					? response.data.message
					: 'Unknown error'

			return {
				status: 'error',
				code: response.status.toString(),
				description: errorMsg,
			}
		} catch (error) {
			return {
				status: 'error',
				code: '500',
				description:
					error instanceof Error ? error.message : 'Internal Server Error',
			}
		}
	}
}

/**
 * Create a 1Sat broadcaster instance
 *
 * @param config - Optional configuration
 * @returns Broadcaster instance
 */
export function createBroadcaster(config?: BroadcasterConfig): Broadcaster {
	return new OneSatBroadcaster(config)
}
