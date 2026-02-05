import type { ClientOptions } from '@1sat/types'
import { HttpError } from '../errors'

/**
 * Base client with shared HTTP utilities for all 1sat-stack API clients.
 * Provides timeout handling, error parsing, and request helpers.
 */
export class BaseClient {
	protected readonly baseUrl: string
	protected readonly timeout: number
	protected readonly fetchFn: typeof fetch

	constructor(baseUrl: string, options: ClientOptions = {}) {
		this.baseUrl = baseUrl.replace(/\/$/, '')
		this.timeout = options.timeout ?? 30000
		this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
	}

	/**
	 * Make a JSON request and parse the response
	 */
	protected async request<T>(path: string, init?: RequestInit): Promise<T> {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.timeout)

		try {
			const response = await this.fetchFn(`${this.baseUrl}${path}`, {
				...init,
				signal: controller.signal,
			})

			if (!response.ok) {
				throw await this.parseError(response)
			}

			// Handle empty responses
			const text = await response.text()
			if (!text) {
				return undefined as T
			}

			return JSON.parse(text) as T
		} finally {
			clearTimeout(timeoutId)
		}
	}

	/**
	 * Make a request and return raw binary data
	 */
	protected async requestBinary(
		path: string,
		init?: RequestInit,
	): Promise<Uint8Array> {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.timeout)

		try {
			const response = await this.fetchFn(`${this.baseUrl}${path}`, {
				...init,
				signal: controller.signal,
			})

			if (!response.ok) {
				throw await this.parseError(response)
			}

			const arrayBuffer = await response.arrayBuffer()
			return new Uint8Array(arrayBuffer)
		} finally {
			clearTimeout(timeoutId)
		}
	}

	/**
	 * Make a request and return the raw Response object
	 * Useful for streaming responses
	 */
	protected async requestRaw(
		path: string,
		init?: RequestInit,
	): Promise<Response> {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.timeout)

		try {
			const response = await this.fetchFn(`${this.baseUrl}${path}`, {
				...init,
				signal: controller.signal,
			})

			if (!response.ok) {
				throw await this.parseError(response)
			}

			return response
		} finally {
			clearTimeout(timeoutId)
		}
	}

	/**
	 * Parse error response into HttpError
	 */
	private async parseError(response: Response): Promise<HttpError> {
		try {
			const data = await response.json()
			const message =
				data.message || data.error || data.detail || response.statusText
			return new HttpError(response.status, message)
		} catch {
			try {
				const text = await response.text()
				return new HttpError(response.status, text || response.statusText)
			} catch {
				return new HttpError(response.status, response.statusText)
			}
		}
	}

	/**
	 * Build query string from options object
	 */
	protected buildQueryString(
		params: Record<string, string | number | boolean | string[] | undefined>,
	): string {
		const entries: string[] = []

		for (const [key, value] of Object.entries(params)) {
			if (value === undefined) continue

			if (Array.isArray(value)) {
				if (value.length > 0) {
					entries.push(`${key}=${encodeURIComponent(value.join(','))}`)
				}
			} else if (typeof value === 'boolean') {
				if (value) {
					entries.push(`${key}=true`)
				}
			} else {
				entries.push(`${key}=${encodeURIComponent(String(value))}`)
			}
		}

		return entries.length > 0 ? `?${entries.join('&')}` : ''
	}
}
