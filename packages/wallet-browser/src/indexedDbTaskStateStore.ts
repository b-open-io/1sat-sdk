import type { TaskStateStore } from '@1sat/wallet'

const DEFAULT_DATABASE_NAME = '1sat-wallet-task-state'
const STORE_NAME = 'state'
const RECORD_KEY = 'monitor-tasks'

interface IndexedDbTaskStateStoreOptions {
	/** Database name. Defaults to `1sat-wallet-task-state`. */
	databaseName?: string
	/**
	 * Optional scope suffix appended to the database name (e.g. an identity
	 * key hash) when a single browser profile needs isolated stores per
	 * wallet identity.
	 */
	scope?: string
}

/**
 * IndexedDB-backed `TaskStateStore`. Works in main-thread browser contexts
 * AND in service workers (extension or web) — IDB is one of the few storage
 * APIs available in both. Single object store, single record holding the
 * full taskName -> timestamp map; bulk read/write each call.
 */
export function createIndexedDbTaskStateStore(
	options: IndexedDbTaskStateStoreOptions = {},
): TaskStateStore {
	const base = options.databaseName ?? DEFAULT_DATABASE_NAME
	const databaseName = options.scope ? `${base}:${options.scope}` : base

	let dbPromise: Promise<IDBDatabase> | null = null
	const openDatabase = (): Promise<IDBDatabase> => {
		if (dbPromise) return dbPromise
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName, 1)
			request.onupgradeneeded = () => {
				const db = request.result
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME)
				}
			}
			request.onsuccess = () => resolve(request.result)
			request.onerror = () =>
				reject(request.error ?? new Error('IDB open failed'))
		})
		return dbPromise
	}

	const withStore = async <T>(
		mode: IDBTransactionMode,
		op: (store: IDBObjectStore) => IDBRequest<T>,
	): Promise<T> => {
		const db = await openDatabase()
		return new Promise<T>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, mode)
			const store = tx.objectStore(STORE_NAME)
			const request = op(store)
			request.onsuccess = () => resolve(request.result)
			request.onerror = () =>
				reject(request.error ?? new Error('IDB request failed'))
			tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'))
		})
	}

	return {
		async load() {
			const value = await withStore<unknown>('readonly', (store) =>
				store.get(RECORD_KEY),
			)
			if (!value || typeof value !== 'object') return {}
			const out: Record<string, number> = {}
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
			}
			return out
		},
		async save(state) {
			await withStore('readwrite', (store) => store.put(state, RECORD_KEY))
		},
	}
}
