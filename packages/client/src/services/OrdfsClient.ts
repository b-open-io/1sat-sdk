import type {
	ClientOptions,
	OrdfsContentOptions,
	OrdfsContentResponse,
	OrdfsMetadata,
	OrdfsResponseHeaders,
} from '@1sat/types'
import { BaseClient } from './BaseClient.js'

/**
 * Client for ordfs routes.
 * Provides inscription content and metadata.
 *
 * Content is served from /content (e.g., https://api.1sat.app/content/:outpoint)
 * API routes use /1sat/ordfs (e.g., https://api.1sat.app/1sat/ordfs/metadata/:outpoint)
 */
export class OrdfsClient extends BaseClient {
	private readonly contentBaseUrl: string

	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/ordfs`, options)
		// Content is at root /content, not under /1sat/
		this.contentBaseUrl = `${baseUrl.replace(/\/$/, '')}/content`
	}

	/**
	 * Get metadata for an inscription
	 * @param outpoint - Outpoint (txid_vout) or txid
	 * @param seq - Optional sequence number (-1 for latest)
	 */
	async getMetadata(outpoint: string, seq?: number): Promise<OrdfsMetadata> {
		const path = seq !== undefined ? `${outpoint}:${seq}` : outpoint
		return this.request<OrdfsMetadata>(`/metadata/${path}`)
	}

	/**
	 * Get metadata for multiple outpoints in a single request.
	 * @param outpoints - Array of outpoints (txid_vout). Supports `:seq` suffix (e.g. `txid_0:-2` for origin resolution).
	 * @returns Map of outpoint (as provided) to metadata (null if not found)
	 */
	async bulkMetadata(
		outpoints: string[],
	): Promise<Record<string, OrdfsMetadata | null>> {
		return this.request<Record<string, OrdfsMetadata | null>>('/metadata', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ outpoints }),
		})
	}

	/**
	 * Get inscription content with full response headers
	 * @param outpoint - Outpoint (txid_vout) or txid
	 * @param options - Content request options
	 */
	async getContent(
		outpoint: string,
		options: OrdfsContentOptions = {},
	): Promise<OrdfsContentResponse> {
		const url = this.getContentUrl(outpoint, options)
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.timeout)

		try {
			const response = await this.fetchFn(url, {
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new Error(`Failed to fetch content: ${response.statusText}`)
			}

			const headers = this.parseResponseHeaders(response)
			const arrayBuffer = await response.arrayBuffer()

			return {
				data: new Uint8Array(arrayBuffer),
				headers,
			}
		} finally {
			clearTimeout(timeoutId)
		}
	}

	/**
	 * Preview base64-encoded HTML content
	 * @param b64HtmlData - Base64-encoded HTML
	 */
	async previewHtml(b64HtmlData: string): Promise<string> {
		const response = await this.requestRaw(`/preview/${b64HtmlData}`)
		return response.text()
	}

	/**
	 * Preview content by posting it directly
	 * @param content - Content to preview
	 * @param contentType - Content type header
	 */
	async previewContent(
		content: Uint8Array,
		contentType: string,
	): Promise<Uint8Array> {
		return this.requestBinary('/preview', {
			method: 'POST',
			headers: { 'Content-Type': contentType },
			body: content as unknown as BodyInit,
		})
	}

	/**
	 * Get the URL for fetching inscription content directly.
	 * Useful for displaying in img/video tags.
	 * @param outpoint - Outpoint (txid_vout) or txid
	 * @param options - Content request options
	 */
	getContentUrl(outpoint: string, options: OrdfsContentOptions = {}): string {
		let path = outpoint
		if (options.seq !== undefined) {
			path = `${outpoint}:${options.seq}`
		}

		const queryParams = this.buildQueryString({
			map: options.map,
			parent: options.parent,
			raw: options.raw,
		})

		return `${this.contentBaseUrl}/${path}${queryParams}`
	}

	/**
	 * Parse response headers into structured object
	 */
	private parseResponseHeaders(response: Response): OrdfsResponseHeaders {
		const headers: OrdfsResponseHeaders = {
			contentType:
				response.headers.get('content-type') || 'application/octet-stream',
		}

		const outpoint = response.headers.get('x-outpoint')
		if (outpoint) headers.outpoint = outpoint

		const origin = response.headers.get('x-origin')
		if (origin) headers.origin = origin

		const seq = response.headers.get('x-ord-seq')
		if (seq) headers.sequence = Number.parseInt(seq, 10)

		const cacheControl = response.headers.get('cache-control')
		if (cacheControl) headers.cacheControl = cacheControl

		const mapData = response.headers.get('x-map')
		if (mapData) {
			try {
				headers.map = JSON.parse(mapData)
			} catch {
				// Invalid JSON, skip
			}
		}

		const parent = response.headers.get('x-parent')
		if (parent) headers.parent = parent

		return headers
	}
}
