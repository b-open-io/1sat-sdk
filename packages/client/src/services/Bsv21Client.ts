import type {
	Bsv21TransactionData,
	ClientOptions,
	IndexedOutput,
	Bsv21FundingTemplate,
	Bsv21OutputStatus,
	TokenDetailResponse,
	TokenStatus,
} from '@1sat/types'
import { BaseClient } from './BaseClient.js'

/**
 * Query options for /outputs validation endpoints.
 * All flags default to false on the server.
 */
export interface OutputQueryOptions {
	/** Filter for unspent outputs only */
	unspent?: boolean
	/** Include spend txid */
	spend?: boolean
	/** Include satoshis */
	sats?: boolean
	/** Include events array */
	events?: boolean
	/** Include block info */
	block?: boolean
	/** Comma-separated data tags to include (e.g. 'bsv21') */
	tags?: string
}

/**
 * Client for /1sat/bsv21/* routes.
 * Provides BSV21 token queries.
 *
 * Routes:
 * - GET /tokens - List tokens
 * - POST /tokens - Lookup tokens (bulk)
 * - GET /:tokenId - Get token details
 * - GET /:tokenId/fund - Get funding template
 * - POST /:tokenId/fund - Submit funding transaction
 * - POST /:tokenId/outputs/status - Outpoint states (bulk)
 * - GET /:tokenId/tx/:txid - Get transaction
 * - POST /:tokenId/outputs - Validate outpoints (bulk)
 * - GET /:tokenId/outputs/:outpoint - Validate outpoint
 * - GET /:tokenId/:lockType/:address/balance - Get address balance
 * - GET /:tokenId/:lockType/:address/unspent - Get address unspent
 * - GET /:tokenId/:lockType/:address/history - Get address history
 * - POST /:tokenId/:lockType/balance - Get balance (multi-address)
 * - POST /:tokenId/:lockType/unspent - Get unspent (multi-address)
 * - POST /:tokenId/:lockType/history - Get history (multi-address)
 */
export class Bsv21Client extends BaseClient {
	private cache = new Map<string, TokenDetailResponse>()

	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/bsv21`, options)
	}

	/**
	 * Bulk lookup token details with funding status.
	 * Returns details and active status for multiple tokens in one request.
	 * @param tokenIds - Array of token IDs (max 100)
	 */
	async lookupTokens(tokenIds: string[]): Promise<TokenDetailResponse[]> {
		return this.request<TokenDetailResponse[]>('/tokens', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(tokenIds),
		})
	}

	/**
	 * Get token details with funding status.
	 * Results are cached for the deploy data, which is immutable. The cached
	 * status goes stale, so callers that act on it pass `fresh: true`, which
	 * fetches and refreshes the cache.
	 */
	async getTokenDetails(
		tokenId: string,
		options: { fresh?: boolean } = {},
	): Promise<TokenDetailResponse> {
		const cached = options.fresh ? undefined : this.cache.get(tokenId)
		if (cached) return cached

		const details = await this.request<TokenDetailResponse>(`/${tokenId}`)
		this.cache.set(tokenId, details)
		return details
	}

	/**
	 * Get the payment outputs that activate the token's overlay: enough to meet
	 * its minimum funding and index its queued backlog. The outputs are in
	 * createAction form. Empty when no funding is needed.
	 */
	async getFundingTemplate(tokenId: string): Promise<Bsv21FundingTemplate> {
		return this.request<Bsv21FundingTemplate>(`/${tokenId}/fund`)
	}

	/**
	 * Submit a transaction paying the token's fee address. The server
	 * broadcasts it, indexes it, and starts the token's overlay if the funding
	 * qualifies. Returns the token's status after the payment.
	 */
	async submitFunding(
		tokenId: string,
		beef: Uint8Array | number[],
	): Promise<TokenStatus> {
		return this.request<TokenStatus>(`/${tokenId}/fund`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: new Blob([new Uint8Array(beef)]),
		})
	}

	/**
	 * Get the overlay state of each outpoint: valid, spent, queued, or unknown.
	 * Results come back in request order, with outpoints as sent.
	 */
	async getOutputStatus(
		tokenId: string,
		outpoints: string[],
	): Promise<Bsv21OutputStatus[]> {
		const results: Bsv21OutputStatus[] = []
		for (let i = 0; i < outpoints.length; i += 1000) {
			const batch = await this.request<Bsv21OutputStatus[]>(
				`/${tokenId}/outputs/status`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(outpoints.slice(i, i + 1000)),
				},
			)
			results.push(...batch)
		}
		return results
	}

	/**
	 * Get token transaction data for a specific txid
	 */
	async getTokenByTxid(
		tokenId: string,
		txid: string,
	): Promise<Bsv21TransactionData> {
		return this.request<Bsv21TransactionData>(`/${tokenId}/tx/${txid}`)
	}

	/**
	 * Get token balance for an address
	 */
	async getBalance(
		tokenId: string,
		lockType: string,
		address: string,
	): Promise<{ balance: number; utxoCount: number }> {
		return this.request<{ balance: number; utxoCount: number }>(
			`/${tokenId}/${lockType}/${address}/balance`,
		)
	}

	/**
	 * Get unspent token UTXOs for an address
	 */
	async getUnspent(
		tokenId: string,
		lockType: string,
		address: string,
	): Promise<IndexedOutput[]> {
		return this.request<IndexedOutput[]>(
			`/${tokenId}/${lockType}/${address}/unspent`,
		)
	}

	/**
	 * Get token transaction history for an address
	 */
	async getHistory(
		tokenId: string,
		lockType: string,
		address: string,
	): Promise<IndexedOutput[]> {
		return this.request<IndexedOutput[]>(
			`/${tokenId}/${lockType}/${address}/history`,
		)
	}

	/**
	 * Get token balance for multiple addresses
	 * @param addresses - Array of addresses (max 100)
	 */
	async getBalanceMulti(
		tokenId: string,
		lockType: string,
		addresses: string[],
	): Promise<{ balance: number; utxoCount: number }> {
		return this.request<{ balance: number; utxoCount: number }>(
			`/${tokenId}/${lockType}/balance`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(addresses),
			},
		)
	}

	/**
	 * Get unspent token UTXOs for multiple addresses
	 * @param addresses - Array of addresses (max 100)
	 */
	async getUnspentMulti(
		tokenId: string,
		lockType: string,
		addresses: string[],
	): Promise<IndexedOutput[]> {
		return this.request<IndexedOutput[]>(`/${tokenId}/${lockType}/unspent`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(addresses),
		})
	}

	/**
	 * Get token transaction history for multiple addresses
	 * @param addresses - Array of addresses (max 100)
	 */
	async getHistoryMulti(
		tokenId: string,
		lockType: string,
		addresses: string[],
	): Promise<IndexedOutput[]> {
		return this.request<IndexedOutput[]>(`/${tokenId}/${lockType}/history`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(addresses),
		})
	}

	/**
	 * Validate specific outpoints against the token's overlay topic.
	 * Returns only those found in the overlay. By default returns minimal data
	 * (outpoint + score). Use opts to include additional fields.
	 * @param tokenId - Token ID (txid_vout format)
	 * @param outpoints - Array of outpoints to validate (max 1000)
	 * @param opts - Optional query flags for additional data
	 */
	async validateOutputs(
		tokenId: string,
		outpoints: string[],
		opts?: OutputQueryOptions,
	): Promise<IndexedOutput[]> {
		const params = this.buildOutputQuery(opts)
		return this.request<IndexedOutput[]>(`/${tokenId}/outputs${params}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(outpoints),
		})
	}

	/**
	 * Validate a single outpoint against the token's overlay topic.
	 * Returns 404 if not found. By default returns minimal data (outpoint + score).
	 * @param tokenId - Token ID (txid_vout format)
	 * @param outpoint - Outpoint to validate (txid_vout or txid:vout)
	 * @param opts - Optional query flags for additional data
	 */
	async validateOutput(
		tokenId: string,
		outpoint: string,
		opts?: OutputQueryOptions,
	): Promise<IndexedOutput> {
		const params = this.buildOutputQuery(opts)
		return this.request<IndexedOutput>(
			`/${tokenId}/outputs/${outpoint}${params}`,
		)
	}

	private buildOutputQuery(opts?: OutputQueryOptions): string {
		if (!opts) return ''
		const parts: string[] = []
		if (opts.unspent) parts.push('unspent=true')
		if (opts.spend) parts.push('spend=true')
		if (opts.sats) parts.push('sats=true')
		if (opts.events) parts.push('events=true')
		if (opts.block) parts.push('block=true')
		if (opts.tags) parts.push(`tags=${encodeURIComponent(opts.tags)}`)
		return parts.length > 0 ? `?${parts.join('&')}` : ''
	}

	/**
	 * Clear the token details cache
	 */
	clearCache(): void {
		this.cache.clear()
	}
}
