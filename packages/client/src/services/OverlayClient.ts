import type { ClientOptions } from '@1sat/types'
import { BaseClient } from './BaseClient'

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
					'X-Topics': JSON.stringify(topics),
				},
				body: new Blob([new Uint8Array(beefArray)]),
			},
		)
	}

	/**
	 * Submit a BSV-21 token transaction to the overlay.
	 * Convenience method that formats the topic correctly.
	 * @param beef - BEEF data
	 * @param tokenId - Token ID (txid_vout format)
	 */
	async submitBsv21(
		beef: Uint8Array | number[],
		tokenId: string,
	): Promise<{ status: string; txid?: string; message?: string }> {
		return this.submit(beef, [`tm_${tokenId}`])
	}
}
