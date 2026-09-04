import type {
	BapIdentity,
	BapProfileEntry,
	BapValidByAddressResponse,
	ClientOptions,
} from '@1sat/types'
import { BaseClient } from './BaseClient.js'

/**
 * Client for /1sat/bap/* routes.
 * Provides BAP identity lookups, address validation, and profile queries.
 *
 * Routes:
 * - POST /identity/get - Get identity by BAP ID
 * - POST /identity/validByAddress - Check address validity for an identity
 * - GET /identity/search - Full-text search across identities
 * - GET /profile - List profiles (paginated)
 * - GET /profile/:bapId - Get profile data for a specific identity
 */
export class BapClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/bap`, options)
	}

	/**
	 * Get a BAP identity by its ID key.
	 */
	async getIdentity(idKey: string): Promise<BapIdentity> {
		return this.request<BapIdentity>('/identity/get', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ idKey }),
		})
	}

	/**
	 * Check if an address is currently valid for a BAP identity.
	 * Handles key rotation — an address valid at one block height may not be current.
	 *
	 * @param address - Bitcoin address to check
	 * @param block - Optional block height for point-in-time validity check.
	 *                If omitted, checks current validity.
	 */
	async validByAddress(
		address: string,
		block?: number,
	): Promise<BapValidByAddressResponse> {
		return this.request<BapValidByAddressResponse>('/identity/validByAddress', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ address, block: block ?? 0 }),
		})
	}

	/**
	 * Full-text search across BAP identities.
	 */
	async searchIdentities(
		q: string,
		limit = 20,
		offset = 0,
	): Promise<BapIdentity[]> {
		const qs = this.buildQueryString({ q, limit, offset })
		return this.request<BapIdentity[]>(`/identity/search${qs}`)
	}

	/**
	 * List BAP profiles (paginated).
	 */
	async listProfiles(limit = 20, offset = 0): Promise<BapProfileEntry[]> {
		const qs = this.buildQueryString({ limit, offset })
		return this.request<BapProfileEntry[]>(`/profile${qs}`)
	}

	/**
	 * Get profile data for a specific BAP identity.
	 * Returns the on-chain profile (schema.org data), not the full identity.
	 */
	async getProfile(bapId: string): Promise<Record<string, unknown>> {
		return this.request<Record<string, unknown>>(
			`/profile/${encodeURIComponent(bapId)}`,
		)
	}
}
