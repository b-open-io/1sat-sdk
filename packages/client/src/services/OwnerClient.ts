import type {
	BalanceResponse,
	ClientOptions,
	IndexedOutput,
	SyncOutput,
	SyncProgress,
	TxoQueryOptions,
} from '@1sat/types'
import { BaseClient } from './BaseClient.js'

/**
 * Event types emitted by the OwnerTxos SSE stream.
 */
export type TxoStreamEvent =
	| { type: 'sync'; data: SyncProgress }
	| { type: 'txo'; data: IndexedOutput }
	| { type: 'done' }
	| { type: 'error'; error: Error }

/**
 * Parsed SSE event from a streaming response.
 */
interface SSEEvent {
	event?: string
	data: string
	id?: string
}

/**
 * Parse SSE events from a fetch Response body.
 * Works in browsers, Node, and Bun — no EventSource dependency.
 */
async function* parseSSE(response: Response): AsyncGenerator<SSEEvent> {
	const reader = response.body?.getReader()
	if (!reader) throw new Error('Response body is not readable')

	const decoder = new TextDecoder()
	let buffer = ''

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })

			// Split on double newline (SSE event boundary)
			const parts = buffer.split('\n\n')
			// Last part is incomplete — keep it in buffer
			buffer = parts.pop() || ''

			for (const part of parts) {
				if (!part.trim()) continue

				const event: SSEEvent = { data: '' }
				for (const line of part.split('\n')) {
					if (line.startsWith('data: ')) {
						event.data = line.slice(6)
					} else if (line.startsWith('event: ')) {
						event.event = line.slice(7)
					} else if (line.startsWith('id: ')) {
						event.id = line.slice(4)
					}
				}
				yield event
			}
		}
	} finally {
		reader.releaseLock()
	}
}

/**
 * Client for /1sat/owner/* routes.
 * Provides owner (address) queries and sync.
 *
 * Routes:
 * - GET /:owner/txos - SSE stream: sync progress then TXO results
 * - GET /:owner/balance - Get balance
 * - GET /sync?owner=... - SSE stream of outputs for sync (supports multiple owners)
 */
export class OwnerClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/owner`, options)
	}

	/**
	 * Stream TXOs owned by an address/owner as an async iterator.
	 *
	 * The stream has three phases:
	 * 1. Sync — progress events report blockchain sync status (when refresh=true)
	 * 2. Data — each matching TXO is delivered individually
	 * 3. Done — signals the stream is complete
	 */
	async *getTxos(
		owner: string,
		opts?: TxoQueryOptions & { refresh?: boolean },
	): AsyncGenerator<TxoStreamEvent> {
		const qs = this.buildQueryString({
			tags: opts?.tags,
			from: opts?.from,
			limit: opts?.limit,
			rev: opts?.rev,
			unspent: opts?.unspent,
			sats: opts?.sats,
			spend: opts?.spend,
			events: opts?.events,
			block: opts?.block,
			refresh: opts?.refresh,
		})

		const url = `${this.baseUrl}/${owner}/txos${qs}`
		const response = await this.fetchFn(url)
		if (!response.ok) {
			throw new Error(`SSE request failed: ${response.status}`)
		}

		for await (const sse of parseSSE(response)) {
			if (sse.event === 'sync') {
				yield { type: 'sync', data: JSON.parse(sse.data) as SyncProgress }
			} else if (sse.event === 'txo') {
				yield { type: 'txo', data: JSON.parse(sse.data) as IndexedOutput }
			} else if (sse.event === 'done') {
				yield { type: 'done' }
				return
			} else if (sse.event === 'error') {
				yield { type: 'error', error: new Error(sse.data) }
				return
			}
		}
	}

	/**
	 * Get balance for an address/owner
	 */
	async getBalance(owner: string): Promise<BalanceResponse> {
		return this.request<BalanceResponse>(`/${owner}/balance`)
	}

	/**
	 * Sync outputs for owner(s) via streaming fetch.
	 * The server merges results from all owners in score order,
	 * triggers lazy indexing (JungleBus sync), and streams results.
	 *
	 * @param owners - Array of addresses/owners to sync
	 * @param from - Starting score (for pagination/resumption)
	 * @param onProgress - Optional callback for progress updates
	 * @yields SyncOutput for each output
	 */
	async *sync(
		owners: string[],
		from?: number,
		onProgress?: (progress: SyncProgress) => void,
	): AsyncGenerator<SyncOutput> {
		const params = new URLSearchParams()
		for (const owner of owners) {
			params.append('owner', owner)
		}
		if (from !== undefined) {
			params.set('from', String(from))
		}

		const url = `${this.baseUrl}/sync?${params.toString()}`
		const response = await this.fetchFn(url)
		if (!response.ok) {
			throw new Error(`Sync request failed: ${response.status}`)
		}

		for await (const sse of parseSSE(response)) {
			if (sse.event === 'done') {
				return
			}
			if (sse.event === 'error') {
				throw new Error(sse.data)
			}
			if (sse.event === 'sync' && onProgress) {
				onProgress(JSON.parse(sse.data) as SyncProgress)
				continue
			}
			// Default message events (no event: prefix) contain SyncOutput data
			if (!sse.event && sse.data) {
				yield JSON.parse(sse.data) as SyncOutput
			}
		}
	}
}
