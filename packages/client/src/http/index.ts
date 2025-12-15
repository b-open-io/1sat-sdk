/**
 * HTTP client abstraction for 1Sat API
 *
 * Provides a universal HTTP client that works in both browser and Node.js
 */

import type {
	HttpClient,
	HttpClientRequestOptions,
	HttpClientResponse,
} from '@bsv/sdk'
import { NodejsHttpClient } from '@bsv/sdk'

/**
 * Fetch function interface
 */
export type FetchFn = (url: string, options: FetchOptions) => Promise<Response>

/**
 * Fetch options limited to what we need
 */
export interface FetchOptions {
	method?: string
	headers?: Record<string, string>
	body?: string | null
}

/**
 * HTTP client using fetch API (browser/modern Node.js)
 */
export class FetchHttpClient implements HttpClient {
	constructor(private readonly fetch: FetchFn) {}

	async request<D>(
		url: string,
		options: HttpClientRequestOptions,
	): Promise<HttpClientResponse<D>> {
		const fetchOptions: FetchOptions = {
			method: options.method,
			headers: options.headers,
			body: options.data ? JSON.stringify(options.data) : null,
		}

		const res = await this.fetch(url, fetchOptions)
		const mediaType = res.headers.get('Content-Type')
		const data = mediaType?.startsWith('application/json')
			? await res.json()
			: await res.text()

		return {
			ok: res.ok,
			status: res.status,
			statusText: res.statusText,
			data: data as D,
		}
	}
}

/**
 * No-op HTTP client that throws (for unsupported environments)
 */
const noHttpClient: HttpClient = {
	async request(): Promise<HttpClientResponse> {
		throw new Error('No method available to perform HTTP request')
	},
}

/**
 * Create a default HTTP client for the current environment
 */
export function createHttpClient(): HttpClient {
	// Browser environment
	if (typeof globalThis.fetch === 'function') {
		return new FetchHttpClient(globalThis.fetch.bind(globalThis))
	}

	// Node.js environment
	if (typeof require !== 'undefined') {
		try {
			// biome-ignore lint/security/noGlobalEval: Need dynamic require for Node.js
			const https = eval('require')('node:https')
			return new NodejsHttpClient(https)
		} catch {
			return noHttpClient
		}
	}

	return noHttpClient
}

// Re-export types from @bsv/sdk
export type { HttpClient, HttpClientRequestOptions, HttpClientResponse }
