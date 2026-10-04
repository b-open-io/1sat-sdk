import type { ClientOptions } from '@1sat/types'
import type { STEAK } from '@bsv/sdk'
import { BaseClient } from './BaseClient.js'

/** Topic manager metadata returned by listTopicManagers */
export interface TopicManagerInfo {
	name?: string
	description?: string
	icon?: string
	[key: string]: unknown
}

/** Lookup service provider metadata returned by listLookupServiceProviders */
export interface LookupServiceInfo {
	[key: string]: unknown
}

/**
 * Client for overlay service routes.
 * Handles topic manager queries and overlay lookups.
 */
export class OverlayClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(baseUrl, options)
	}

	/**
	 * List all registered topic managers.
	 */
	async listTopicManagers(): Promise<Record<string, TopicManagerInfo>> {
		return this.request<Record<string, TopicManagerInfo>>(
			'/1sat/overlay/listTopicManagers',
		)
	}

	/**
	 * List all registered lookup service providers.
	 */
	async listLookupServiceProviders(): Promise<
		Record<string, LookupServiceInfo>
	> {
		return this.request<Record<string, LookupServiceInfo>>(
			'/1sat/overlay/listLookupServiceProviders',
		)
	}

	/**
	 * Submit a transaction to the overlay service for indexing.
	 * @param beef - BEEF data as Uint8Array or number[]
	 * @param topics - Topic names to submit to (e.g., ["tm_tokenId"])
	 */
	async submit(
		beef: Uint8Array | number[],
		topics: string[],
	): Promise<{ status: string; txid?: string; message?: string }> {
		const beefArray = beef instanceof Uint8Array ? Array.from(beef) : beef

		return this.request<{ status: string; txid?: string; message?: string }>(
			'/1sat/overlay/submit',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/octet-stream',
					// OpenAPI "simple" style with explode — comma-separated, not JSON.
					'X-Topics': topics.join(','),
				},
				body: new Blob([new Uint8Array(beefArray)]),
			},
		)
	}

	/**
	 * Submit a BSV-21 token transaction to the per-token overlay topic.
	 * @param beef - BEEF data
	 * @param tokenId - Token ID (txid_vout format)
	 */
	async submitBsv21(
		beef: Uint8Array | number[],
		tokenId: string,
	): Promise<{ status: string; txid?: string; message?: string }> {
		return this.submitToPath('/1sat/bsv21/overlay/submit', beef, [
			`tm_${tokenId}`,
		])
	}

	/**
	 * Submit a BSV-21 deploy transaction to the discovery topic.
	 * Used for `deploy+mint` and `deploy+auth` operations where the token's
	 * per-token topic does not yet exist; the discovery topic admits the
	 * deploy and triggers per-token worker creation downstream.
	 * @param beef - BEEF data
	 */
	async submitBsv21Discovery(
		beef: Uint8Array | number[],
	): Promise<{ status: string; txid?: string; message?: string }> {
		return this.submitToPath('/1sat/bsv21/overlay/submit', beef, ['tm_bsv21'])
	}

	/**
	 * BRC-22 submit to `<baseUrl>/submit` on an overlay given by its base URL.
	 * Topics go in `X-Topics` as a comma-separated bare string (the stack
	 * rejects a JSON array).
	 * @param beef - BEEF data
	 * @param topics - Topic names (e.g. ["tm_mandala"])
	 * @returns the overlay's STEAK
	 */
	async submitBrc22(
		beef: Uint8Array | number[],
		topics: string[],
	): Promise<STEAK> {
		return this.submitToPath<STEAK>('/submit', beef, topics)
	}

	/**
	 * Submit a Mandala (BRC-162) token transaction to its per-token topic at a
	 * BRC-22 overlay: `POST <baseUrl>/submit` with `X-Topics: tm_<tokenId>`.
	 * @param beef - BEEF data
	 * @param tokenId - Token id: the deploy txid (hex)
	 */
	async submitMandala(
		beef: Uint8Array | number[],
		tokenId: string,
	): Promise<STEAK> {
		return this.submitBrc22(beef, [`tm_${tokenId.toLowerCase()}`])
	}

	private async submitToPath<
		T = { status: string; txid?: string; message?: string },
	>(path: string, beef: Uint8Array | number[], topics: string[]): Promise<T> {
		const beefArray = beef instanceof Uint8Array ? Array.from(beef) : beef
		return this.request<T>(path, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				// OpenAPI "simple" style with explode — comma-separated, not JSON.
				'X-Topics': topics.join(','),
			},
			body: new Blob([new Uint8Array(beefArray)]),
		})
	}
}
