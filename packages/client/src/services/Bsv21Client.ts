import type {
	Bsv21TransactionData,
	ClientOptions,
	IndexedOutput,
	TokenDetailResponse,
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
	 * Results are cached since token deploy data is immutable.
	 */
	async getTokenDetails(tokenId: string): Promise<TokenDetailResponse> {
		const cached = this.cache.get(tokenId)
		if (cached) return cached

		const details = await this.request<TokenDetailResponse>(`/${tokenId}`)
		this.cache.set(tokenId, details)
		return details
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
