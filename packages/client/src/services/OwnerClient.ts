import type {
	BalanceResponse,
	ClientOptions,
	IndexedOutput,
	SyncOutput,
	SyncProgress,
	TxoQueryOptions,
} from '@1sat/types'
import { BaseClient } from './BaseClient'

/**
 * Event types emitted by the OwnerTxos SSE stream.
 */
export type TxoStreamEvent =
	| { type: 'sync'; data: SyncProgress }
	| { type: 'txo'; data: IndexedOutput }
	| { type: 'done' }
	| { type: 'error'; error: Error }

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
	 * Stream TXOs owned by an address/owner via SSE.
	 *
	 * The stream has three phases:
	 * 1. Sync — progress events report blockchain sync status (when refresh=true)
	 * 2. Data — each matching TXO is delivered individually
	 * 3. Done — signals the stream is complete
	 *
	 * @param owner - Owner identifier (address, pubkey, or script hash)
	 * @param opts - Query options and callbacks
	 * @returns Unsubscribe function to close the stream
	 */
	getTxos(
		owner: string,
		opts?: TxoQueryOptions & {
			refresh?: boolean
			onSync?: (progress: SyncProgress) => void
			onTxo?: (output: IndexedOutput) => void
			onDone?: (outputs: IndexedOutput[]) => void
			onError?: (error: Error) => void
		},
	): () => void {
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
		const eventSource = new EventSource(url)
		const collected: IndexedOutput[] = []

		eventSource.addEventListener('sync', (event) => {
			try {
				const progress = JSON.parse(
					(event as MessageEvent).data,
				) as SyncProgress
				opts?.onSync?.(progress)
			} catch (e) {
				opts?.onError?.(e instanceof Error ? e : new Error(String(e)))
			}
		})

		eventSource.addEventListener('txo', (event) => {
			try {
				const output = JSON.parse((event as MessageEvent).data) as IndexedOutput
				collected.push(output)
				opts?.onTxo?.(output)
			} catch (e) {
				opts?.onError?.(e instanceof Error ? e : new Error(String(e)))
			}
		})

		eventSource.addEventListener('done', () => {
			eventSource.close()
			opts?.onDone?.(collected)
		})

		eventSource.addEventListener('error', (event) => {
			try {
				const data = (event as MessageEvent).data
				const msg = data ? String(data) : 'SSE stream error'
				opts?.onError?.(new Error(msg))
			} catch {
				opts?.onError?.(new Error('SSE stream error'))
			}
		})

		eventSource.onerror = () => {
			eventSource.close()
			opts?.onError?.(new Error('SSE connection error'))
		}

		return () => {
			eventSource.close()
		}
	}

	/**
	 * Stream TXOs as an async iterator yielding typed events.
	 *
	 * @example
	 * ```ts
	 * for await (const event of client.owner.getTxosIterator(address)) {
	 *   if (event.type === 'sync') updateProgress(event.data)
	 *   if (event.type === 'txo') addOutput(event.data)
	 * }
	 * ```
	 */
	async *getTxosIterator(
		owner: string,
		opts?: TxoQueryOptions & { refresh?: boolean },
	): AsyncGenerator<TxoStreamEvent, void, unknown> {
		const events: TxoStreamEvent[] = []
		let done = false
		let error: Error | null = null
		let resolve: (() => void) | null = null

		const unsubscribe = this.getTxos(owner, {
			...opts,
			onSync: (progress) => {
				events.push({ type: 'sync', data: progress })
				resolve?.()
			},
			onTxo: (output) => {
				events.push({ type: 'txo', data: output })
				resolve?.()
			},
			onDone: () => {
				done = true
				resolve?.()
			},
			onError: (e) => {
				error = e
				resolve?.()
			},
		})

		try {
			while (!done && !error) {
				if (events.length > 0) {
					const event = events.shift()
					if (event) yield event
				} else {
					await new Promise<void>((r) => {
						resolve = r
					})
				}
			}

			// Yield remaining events
			while (events.length > 0) {
				const event = events.shift()
				if (event) yield event
			}

			if (error) {
				yield { type: 'error', error }
			}
		} finally {
			unsubscribe()
		}
	}

	/**
	 * Get balance for an address/owner
	 */
	async getBalance(owner: string): Promise<BalanceResponse> {
		return this.request<BalanceResponse>(`/${owner}/balance`)
	}

	/**
	 * Sync outputs for owner(s) via SSE stream.
	 * The server merges results from all owners in score order.
	 *
	 * @param owners - Array of addresses/owners to sync
	 * @param onOutput - Callback for each output
	 * @param from - Starting score (for pagination/resumption)
	 * @param onDone - Callback when sync completes (client should retry after delay)
	 * @param onError - Callback for errors
	 * @returns Unsubscribe function
	 */
	sync(
		owners: string[],
		onOutput: (output: SyncOutput) => void,
		from?: number,
		onDone?: () => void,
		onError?: (error: Error) => void,
	): () => void {
		const params = new URLSearchParams()
		for (const owner of owners) {
			params.append('owner', owner)
		}
		if (from !== undefined) {
			params.set('from', String(from))
		}

		const url = `${this.baseUrl}/sync?${params.toString()}`
		const eventSource = new EventSource(url)

		eventSource.onmessage = (event) => {
			try {
				const output = JSON.parse(event.data) as SyncOutput
				onOutput(output)
			} catch (e) {
				onError?.(e instanceof Error ? e : new Error(String(e)))
			}
		}

		eventSource.addEventListener('done', () => {
			eventSource.close()
			onDone?.()
		})

		eventSource.onerror = () => {
			eventSource.close()
			onError?.(new Error('SSE connection error'))
		}

		return () => {
			eventSource.close()
		}
	}

	/**
	 * Sync outputs as an async iterator.
	 * Yields SyncOutput objects until the stream is done.
	 */
	async *syncIterator(
		owners: string[],
		from?: number,
	): AsyncGenerator<SyncOutput, void, unknown> {
		const outputs: SyncOutput[] = []
		let done = false
		let error: Error | null = null
		let resolve: (() => void) | null = null

		const unsubscribe = this.sync(
			owners,
			(output) => {
				outputs.push(output)
				resolve?.()
			},
			from,
			() => {
				done = true
				resolve?.()
			},
			(e) => {
				error = e
				resolve?.()
			},
		)

		try {
			while (!done && !error) {
				if (outputs.length > 0) {
					const output = outputs.shift()
					if (output) yield output
				} else {
					await new Promise<void>((r) => {
						resolve = r
					})
				}
			}

			// Yield remaining outputs
			while (outputs.length > 0) {
				const output = outputs.shift()
				if (output) yield output
			}

			if (error) {
				throw error
			}
		} finally {
			unsubscribe()
		}
	}
}
