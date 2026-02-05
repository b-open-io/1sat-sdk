import type {
	ClientOptions,
	IndexedOutput,
	SpendResponse,
	TxoQueryOptions,
} from '@1sat/types'
import { BaseClient } from './BaseClient'

/**
 * Client for /1sat/txo/* routes.
 * Provides TXO (transaction output) lookup and search.
 *
 * Routes:
 * - GET /:outpoint - Get single TXO (outpoint pattern-matched)
 * - GET /:outpoint/spend - Get spend info
 * - POST /outpoints - Get multiple TXOs
 * - POST /spends - Get multiple spends
 * - GET /tx/:txid - Get all TXOs for a transaction
 * - GET /search?key=... - Search by key(s)
 */
export class TxoClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/txo`, options)
	}

	/**
	 * Get a single TXO by outpoint
	 */
	async get(outpoint: string, opts?: TxoQueryOptions): Promise<IndexedOutput> {
		const qs = this.buildQueryString({
			tags: opts?.tags,
			sats: opts?.sats,
			spend: opts?.spend,
			block: opts?.block,
		})
		return this.request<IndexedOutput>(`/${outpoint}${qs}`)
	}

	/**
	 * Get multiple TXOs by outpoints
	 */
	async getBatch(
		outpoints: string[],
		opts?: TxoQueryOptions,
	): Promise<(IndexedOutput | null)[]> {
		const qs = this.buildQueryString({
			tags: opts?.tags,
			sats: opts?.sats,
			spend: opts?.spend,
			block: opts?.block,
		})
		return this.request<(IndexedOutput | null)[]>(`/outpoints${qs}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(outpoints),
		})
	}

	/**
	 * Get spend info for an outpoint
	 */
	async getSpend(outpoint: string): Promise<string | null> {
		const resp = await this.request<SpendResponse>(`/${outpoint}/spend`)
		return resp.spendTxid
	}

	/**
	 * Get spend info for multiple outpoints
	 */
	async getSpends(outpoints: string[]): Promise<(string | null)[]> {
		const resp = await this.request<SpendResponse[]>('/spends', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(outpoints),
		})
		return resp.map((r) => r.spendTxid)
	}

	/**
	 * Get all TXOs for a transaction
	 */
	async getByTxid(
		txid: string,
		opts?: TxoQueryOptions,
	): Promise<IndexedOutput[]> {
		const qs = this.buildQueryString({
			tags: opts?.tags,
			sats: opts?.sats,
			spend: opts?.spend,
			block: opts?.block,
		})
		return this.request<IndexedOutput[]>(`/tx/${txid}${qs}`)
	}

	/**
	 * Search TXOs by key(s)
	 */
	async search(
		keys: string | string[],
		opts?: TxoQueryOptions,
	): Promise<IndexedOutput[]> {
		const qs = this.buildQueryString({
			key: Array.isArray(keys) ? keys : [keys],
			tags: opts?.tags,
			from: opts?.from,
			limit: opts?.limit,
			rev: opts?.rev,
			unspent: opts?.unspent,
			sats: opts?.sats,
			spend: opts?.spend,
			events: opts?.events,
			block: opts?.block,
		})
		return this.request<IndexedOutput[]>(`/search${qs}`)
	}
}
