import type { ProcessedTxStore } from './ProcessedTxStore.js'

const TXIDS_STORE = 'processed_txids'
const STATE_STORE = 'sync_state'
const DB_VERSION = 1

export class ProcessedTxStoreIdb implements ProcessedTxStore {
	private dbName: string
	private db: IDBDatabase | null = null
	private dbPromise: Promise<IDBDatabase> | null = null

	constructor(namespace: string) {
		this.dbName = `sync-processed-${namespace}`
	}

	private async getDb(): Promise<IDBDatabase> {
		if (this.db) return this.db
		if (this.dbPromise) return this.dbPromise

		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, DB_VERSION)
			request.onerror = () => reject(request.error)
			request.onblocked = () =>
				reject(new Error('Database blocked - close other tabs'))
			request.onsuccess = () => {
				this.db = request.result
				resolve(this.db)
			}
			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result
				if (!db.objectStoreNames.contains(TXIDS_STORE)) {
					db.createObjectStore(TXIDS_STORE, { keyPath: 'txid' })
				}
				if (!db.objectStoreNames.contains(STATE_STORE)) {
					db.createObjectStore(STATE_STORE, { keyPath: 'key' })
				}
			}
		})

		return this.dbPromise
	}

	async has(txid: string): Promise<boolean> {
		const db = await this.getDb()
		return new Promise((resolve, reject) => {
			const tx = db.transaction(TXIDS_STORE, 'readonly')
			const request = tx.objectStore(TXIDS_STORE).get(txid)
			request.onsuccess = () => resolve(!!request.result)
			request.onerror = () => reject(request.error)
		})
	}

	async add(txid: string): Promise<void> {
		const db = await this.getDb()
		return new Promise((resolve, reject) => {
			const tx = db.transaction(TXIDS_STORE, 'readwrite')
			tx.objectStore(TXIDS_STORE).put({ txid, createdAt: Date.now() })
			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error)
		})
	}

	async getLastScore(): Promise<number> {
		const db = await this.getDb()
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STATE_STORE, 'readonly')
			const request = tx.objectStore(STATE_STORE).get('lastScore')
			request.onsuccess = () => {
				const result = request.result as
					| { key: string; value: number }
					| undefined
				resolve(result?.value ?? 0)
			}
			request.onerror = () => reject(request.error)
		})
	}

	async setLastScore(score: number): Promise<void> {
		const db = await this.getDb()
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STATE_STORE, 'readwrite')
			tx.objectStore(STATE_STORE).put({ key: 'lastScore', value: score })
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
