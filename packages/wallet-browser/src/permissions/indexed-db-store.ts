import {
	type IPermissionStore,
	type ListGrantsFilter,
	type PermissionKey,
	permissionKeyToString,
	type StoredGrant,
} from '@1sat/wallet'

const DEFAULT_DATABASE_NAME = '1sat-wallet-permissions'
const DEFAULT_STORE_NAME = 'grants'
const ORIGINATOR_INDEX = 'by-originator'
const TYPE_INDEX = 'by-type'

interface IndexedDbPermissionStoreOptions {
	/** Database name. Defaults to `1sat-wallet-permissions`. */
	databaseName?: string
	/**
	 * Scope suffix appended to the database name (e.g. an identity key hash
	 * or chain tag). Useful when a single browser profile needs isolated
	 * grant stores per identity.
	 */
	scope?: string
}

/**
 * `IPermissionStore` backed by IndexedDB.
 *
 * Schema: one object store (`grants`) keyed by the canonical permission key
 * string. Secondary indexes on `originator` and `type` back the filtered
 * listing and delete-by-originator paths.
 *
 * Default store for `createWebWallet` when `permissions` is supplied.
 */
export class IndexedDbPermissionStore implements IPermissionStore {
	private readonly databaseName: string
	private dbPromise: Promise<IDBDatabase> | null = null

	constructor(options: IndexedDbPermissionStoreOptions = {}) {
		const base = options.databaseName ?? DEFAULT_DATABASE_NAME
		this.databaseName = options.scope ? `${base}:${options.scope}` : base
	}

	private openDatabase(): Promise<IDBDatabase> {
		if (this.dbPromise) return this.dbPromise
		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(this.databaseName, 1)
			request.onupgradeneeded = () => {
				const db = request.result
				if (!db.objectStoreNames.contains(DEFAULT_STORE_NAME)) {
					const store = db.createObjectStore(DEFAULT_STORE_NAME, {
						keyPath: 'id',
					})
					store.createIndex(ORIGINATOR_INDEX, 'originator', { unique: false })
					store.createIndex(TYPE_INDEX, 'type', { unique: false })
				}
			}
			request.onsuccess = () => resolve(request.result)
			request.onerror = () =>
				reject(request.error ?? new Error('IDB open failed'))
		})
		return this.dbPromise
	}

	private async withStore<T>(
		mode: IDBTransactionMode,
		fn: (store: IDBObjectStore) => Promise<T> | T,
	): Promise<T> {
		const db = await this.openDatabase()
		return new Promise<T>((resolve, reject) => {
			const tx = db.transaction(DEFAULT_STORE_NAME, mode)
			const store = tx.objectStore(DEFAULT_STORE_NAME)
			let result: T
			Promise.resolve(fn(store))
				.then((value) => {
					result = value
				})
				.catch((err) => {
					tx.abort()
					reject(err)
				})
			tx.oncomplete = () => resolve(result)
			tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'))
			tx.onabort = () =>
				reject(tx.error ?? new Error('IDB transaction aborted'))
		})
	}

	private toRecord(grant: StoredGrant) {
		return {
			id: permissionKeyToString(grant.key),
			originator: grant.key.originator,
			type: grant.key.type,
			grant,
		}
	}

	private fromRequest<T>(request: IDBRequest<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result)
			request.onerror = () =>
				reject(request.error ?? new Error('IDB request failed'))
		})
	}

	async findGrant(key: PermissionKey): Promise<StoredGrant | null> {
		return this.withStore('readonly', async (store) => {
			const id = permissionKeyToString(key)
			const record = await this.fromRequest<{ grant: StoredGrant } | undefined>(
				store.get(id),
			)
			return record?.grant ?? null
		})
	}

	async putGrant(grant: StoredGrant): Promise<void> {
		await this.withStore('readwrite', async (store) => {
			await this.fromRequest(store.put(this.toRecord(grant)))
		})
	}

	async deleteGrant(key: PermissionKey): Promise<void> {
		await this.withStore('readwrite', async (store) => {
			await this.fromRequest(store.delete(permissionKeyToString(key)))
		})
	}

	async deleteAllForOriginator(originator: string): Promise<number> {
		return this.withStore('readwrite', async (store) => {
			const index = store.index(ORIGINATOR_INDEX)
			const keys = await this.fromRequest<IDBValidKey[]>(
				index.getAllKeys(IDBKeyRange.only(originator)),
			)
			await Promise.all(keys.map((id) => this.fromRequest(store.delete(id))))
			return keys.length
		})
	}

	async listGrants(filter?: ListGrantsFilter): Promise<StoredGrant[]> {
		return this.withStore('readonly', async (store) => {
			const source = filter?.originator
				? store.index(ORIGINATOR_INDEX)
				: filter?.type
					? store.index(TYPE_INDEX)
					: store
			const range = filter?.originator
				? IDBKeyRange.only(filter.originator)
				: filter?.type
					? IDBKeyRange.only(filter.type)
					: undefined
			const records = await this.fromRequest<Array<{ grant: StoredGrant }>>(
				range ? source.getAll(range) : source.getAll(),
			)
			return records.map((r) => r.grant)
		})
	}

	/** Release the open database handle (future operations will reopen). */
	async close(): Promise<void> {
		if (!this.dbPromise) return
		const db = await this.dbPromise
		db.close()
		this.dbPromise = null
	}
}
