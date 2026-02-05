import type {
	AddressSyncQueueInput,
	AddressSyncQueueItem,
	AddressSyncQueueStats,
	AddressSyncQueueStorage,
	AddressSyncState,
} from '@1sat/types'

const QUEUE_STORE = 'queue'
const STATE_STORE = 'state'
const STATE_KEY = 'syncState'
const DB_VERSION = 1

/**
 * IndexedDB implementation of AddressSyncQueueStorage for browser environments.
 */
export class AddressSyncQueueIdb implements AddressSyncQueueStorage {
	private dbName: string
	private db: IDBDatabase | null = null
	private dbPromise: Promise<IDBDatabase> | null = null

	/**
	 * Create a new IndexedDB address sync queue.
	 * @param accountId - Unique identifier for the account (e.g., address, pubkey hash)
	 */
	constructor(accountId: string) {
		this.dbName = `sync-queue-${accountId}`
	}

	private async getDb(): Promise<IDBDatabase> {
		if (this.db) return this.db
		if (this.dbPromise) return this.dbPromise

		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, DB_VERSION)

			request.onerror = () => reject(request.error)

			request.onblocked = () => {
				reject(new Error('Database blocked - close other tabs'))
			}

			request.onsuccess = () => {
				this.db = request.result
				resolve(this.db)
			}

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result

				// Queue store with indexes
				if (!db.objectStoreNames.contains(QUEUE_STORE)) {
					const queueStore = db.createObjectStore(QUEUE_STORE, {
						keyPath: 'id',
					})
					queueStore.createIndex('status', 'status', { unique: false })
					queueStore.createIndex('outpoint', 'outpoint', { unique: false })
				}

				// State store (simple key-value)
				if (!db.objectStoreNames.contains(STATE_STORE)) {
					db.createObjectStore(STATE_STORE, { keyPath: 'key' })
				}
			}
		})

		return this.dbPromise
	}

	async enqueue(items: AddressSyncQueueInput[]): Promise<void> {
		if (items.length === 0) return

		const db = await this.getDb()
		const now = Date.now()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(QUEUE_STORE, 'readwrite')
			const store = tx.objectStore(QUEUE_STORE)

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error)

			for (const item of items) {
				const id = `${item.outpoint}:${item.score}`

				// Check if item already exists
				const getRequest = store.get(id)
				getRequest.onsuccess = () => {
					const existing = getRequest.result as AddressSyncQueueItem | undefined

					// Skip if already done
					if (existing?.status === 'done') {
						return
					}

					const queueItem: AddressSyncQueueItem = {
						id,
						outpoint: item.outpoint,
						score: item.score,
						spendTxid: item.spendTxid,
						status: 'pending',
						attempts: existing?.attempts ?? 0,
						createdAt: existing?.createdAt ?? now,
						updatedAt: now,
					}
					store.put(queueItem)
				}
			}
		})
	}

	async claim(count = 1): Promise<Map<string, AddressSyncQueueItem[]>> {
		const db = await this.getDb()
		const now = Date.now()

		// Step 1: Find up to `count` pending items as seeds
		const seedItems = await new Promise<AddressSyncQueueItem[]>(
			(resolve, reject) => {
				const tx = db.transaction(QUEUE_STORE, 'readonly')
				const store = tx.objectStore(QUEUE_STORE)
				const index = store.index('status')
				const seeds: AddressSyncQueueItem[] = []

				const request = index.openCursor(IDBKeyRange.only('pending'))

				request.onsuccess = () => {
					const cursor = request.result
					if (cursor && seeds.length < count) {
						seeds.push(cursor.value as AddressSyncQueueItem)
						cursor.continue()
					}
				}

				tx.oncomplete = () => resolve(seeds)
				tx.onerror = () => reject(tx.error)
			},
		)

		if (seedItems.length === 0) {
			return new Map()
		}

		// Step 2: Get unique txids from seeds
		const txids = new Set<string>()
		for (const item of seedItems) {
			txids.add(item.outpoint.substring(0, 64))
		}

		// Step 3: For each txid, get ALL pending items (not just seeds)
		const byTxid = new Map<string, AddressSyncQueueItem[]>()
		for (const txid of txids) {
			const items = await this.getPendingByTxid(txid)
			if (items.length > 0) {
				byTxid.set(txid, items)
			}
		}

		// Step 4: Mark all gathered items as processing
		const allItems = Array.from(byTxid.values()).flat()
		await this.markProcessing(allItems, now)

		return byTxid
	}

	private async getPendingByTxid(
		txid: string,
	): Promise<AddressSyncQueueItem[]> {
		const db = await this.getDb()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(QUEUE_STORE, 'readonly')
			const store = tx.objectStore(QUEUE_STORE)
			const index = store.index('outpoint')
			const results: AddressSyncQueueItem[] = []

			const request = index.openCursor()

			request.onsuccess = () => {
				const cursor = request.result
				if (cursor) {
					const item = cursor.value as AddressSyncQueueItem
					if (item.outpoint.startsWith(txid) && item.status === 'pending') {
						results.push(item)
					}
					cursor.continue()
				}
			}

			tx.oncomplete = () => resolve(results)
			tx.onerror = () => reject(tx.error)
		})
	}

	private async markProcessing(
		items: AddressSyncQueueItem[],
		now: number,
	): Promise<void> {
		if (items.length === 0) return

		const db = await this.getDb()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(QUEUE_STORE, 'readwrite')
			const store = tx.objectStore(QUEUE_STORE)

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error)

			for (const item of items) {
				item.status = 'processing'
				item.attempts += 1
				item.updatedAt = now
				store.put(item)
			}
		})
	}

	async complete(id: string): Promise<void> {
		return this.completeMany([id])
	}

	async completeMany(ids: string[]): Promise<void> {
		if (ids.length === 0) return

		const db = await this.getDb()
		const now = Date.now()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(QUEUE_STORE, 'readwrite')
			const store = tx.objectStore(QUEUE_STORE)

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error)

			for (const id of ids) {
				const request = store.get(id)
				request.onsuccess = () => {
					const item = request.result as AddressSyncQueueItem | undefined
					if (item) {
						item.status = 'done'
						item.updatedAt = now
						store.put(item)
					}
				}
			}
		})
	}

	async fail(id: string, error: string): Promise<void> {
		const db = await this.getDb()
		const now = Date.now()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(QUEUE_STORE, 'readwrite')
			const store = tx.objectStore(QUEUE_STORE)

			const request = store.get(id)
			request.onsuccess = () => {
				const item = request.result as AddressSyncQueueItem | undefined
				if (item) {
					item.status = 'failed'
					item.lastError = error
					item.updatedAt = now
					store.put(item)
				}
			}

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error)
		})
	}

	async getByTxid(txid: string): Promise<AddressSyncQueueItem[]> {
		const db = await this.getDb()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(QUEUE_STORE, 'readonly')
			const store = tx.objectStore(QUEUE_STORE)
			const index = store.index('outpoint')
			const results: AddressSyncQueueItem[] = []

			// Use a cursor to find all outpoints starting with this txid
			const request = index.openCursor()

			request.onsuccess = () => {
				const cursor = request.result
				if (cursor) {
					const item = cursor.value as AddressSyncQueueItem
					if (item.outpoint.startsWith(txid)) {
						results.push(item)
					}
					cursor.continue()
				}
			}

			tx.oncomplete = () => resolve(results)
			tx.onerror = () => reject(tx.error)
		})
	}

	async getByStatus(
		status: AddressSyncQueueItem['status'],
		limit = 100,
	): Promise<AddressSyncQueueItem[]> {
		const db = await this.getDb()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(QUEUE_STORE, 'readonly')
			const store = tx.objectStore(QUEUE_STORE)
			const index = store.index('status')
			const results: AddressSyncQueueItem[] = []

			const request = index.openCursor(IDBKeyRange.only(status))

			request.onsuccess = () => {
				const cursor = request.result
				if (cursor && results.length < limit) {
					results.push(cursor.value as AddressSyncQueueItem)
					cursor.continue()
				}
			}

			tx.oncomplete = () => resolve(results)
			tx.onerror = () => reject(tx.error)
		})
	}

	async getStats(): Promise<AddressSyncQueueStats> {
		const db = await this.getDb()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(QUEUE_STORE, 'readonly')
			const store = tx.objectStore(QUEUE_STORE)
			const request = store.openCursor()

			const txidsByStatus: Record<string, Set<string>> = {
				pending: new Set(),
				processing: new Set(),
				done: new Set(),
				failed: new Set(),
			}

			request.onsuccess = () => {
				const cursor = request.result
				if (cursor) {
					const item = cursor.value as AddressSyncQueueItem
					const txid = item.outpoint.substring(0, 64)
					txidsByStatus[item.status]?.add(txid)
					cursor.continue()
				} else {
					resolve({
						pending: txidsByStatus.pending.size,
						processing: txidsByStatus.processing.size,
						done: txidsByStatus.done.size,
						failed: txidsByStatus.failed.size,
					})
				}
			}
			request.onerror = () => reject(request.error)
		})
	}

	async getState(): Promise<AddressSyncState> {
		const db = await this.getDb()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(STATE_STORE, 'readonly')
			const store = tx.objectStore(STATE_STORE)
			const request = store.get(STATE_KEY)

			request.onsuccess = () => {
				const result = request.result as
					| { key: string; value: AddressSyncState }
					| undefined
				resolve(result?.value ?? { lastQueuedScore: 0 })
			}
			request.onerror = () => reject(request.error)
		})
	}

	async setState(state: Partial<AddressSyncState>): Promise<void> {
		const db = await this.getDb()
		const current = await this.getState()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(STATE_STORE, 'readwrite')
			const store = tx.objectStore(STATE_STORE)

			store.put({
				key: STATE_KEY,
				value: { ...current, ...state },
			})

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error)
		})
	}

	async resetProcessing(): Promise<number> {
		const db = await this.getDb()
		const now = Date.now()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(QUEUE_STORE, 'readwrite')
			const store = tx.objectStore(QUEUE_STORE)
			const index = store.index('status')
			let count = 0

			const request = index.openCursor(IDBKeyRange.only('processing'))

			request.onsuccess = () => {
				const cursor = request.result
				if (cursor) {
					const item = cursor.value as AddressSyncQueueItem
					item.status = 'pending'
					item.updatedAt = now
					cursor.update(item)
					count++
					cursor.continue()
				}
			}

			tx.oncomplete = () => resolve(count)
			tx.onerror = () => reject(tx.error)
		})
	}

	async clear(): Promise<void> {
		const db = await this.getDb()

		return new Promise((resolve, reject) => {
			const tx = db.transaction([QUEUE_STORE, STATE_STORE], 'readwrite')

			tx.objectStore(QUEUE_STORE).clear()
			tx.objectStore(STATE_STORE).clear()

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error)
		})
	}

	async close(): Promise<void> {
		if (this.db) {
			this.db.close()
			this.db = null
			this.dbPromise = null
		}
	}
}
