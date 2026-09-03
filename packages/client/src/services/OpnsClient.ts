import type { ClientOptions } from '@1sat/types'
import { BaseClient } from './BaseClient.js'

export interface OpnsOriginResult {
	name: string
	outpoint: string
}

export interface OpnsMineResult {
	outpoint: string
	domain: string
}

/**
 * Client for /1sat/opns/* routes.
 * Provides OpNS domain name queries.
 *
 * Routes:
 * - GET /origin/:name - Get domain origin outpoint
 * - GET /mine/:name - Get domain mining status
 * - POST /origins - Bulk validate outpoints as OpNS origins
 */
export class OpnsClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/opns`, options)
	}

	/**
	 * Get the current outpoint for a registered OpNS domain.
	 */
	async getOrigin(name: string): Promise<OpnsOriginResult> {
		return this.request<OpnsOriginResult>(`/origin/${encodeURIComponent(name)}`)
	}

	/**
	 * Get the mining status of an OpNS domain.
	 */
	async getMine(name: string): Promise<OpnsMineResult> {
		return this.request<OpnsMineResult>(`/mine/${encodeURIComponent(name)}`)
	}

	/**
	 * Bulk validate outpoints as registered OpNS origins.
	 * Returns a map of outpoint string to boolean for those that exist.
	 * @param outpoints - Array of outpoint strings (txid_vout or txid.vout)
	 */
	async validateOrigins(outpoints: string[]): Promise<Record<string, boolean>> {
		return this.request<Record<string, boolean>>('/origins', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(outpoints),
		})
	}
}
