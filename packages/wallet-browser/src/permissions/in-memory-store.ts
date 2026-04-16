import { permissionKeyToString } from './key'
import type {
	IPermissionStore,
	ListGrantsFilter,
	PermissionKey,
	StoredGrant,
} from './types'

/**
 * Reference `IPermissionStore` that keeps grants in a JS `Map`.
 *
 * Useful for tests, for apps that don't need persistence, and as a
 * template for custom backends (IndexedDB, chrome.storage, etc.).
 */
export class InMemoryPermissionStore implements IPermissionStore {
	private grants = new Map<string, StoredGrant>()

	async findGrant(key: PermissionKey): Promise<StoredGrant | null> {
		return this.grants.get(permissionKeyToString(key)) ?? null
	}

	async putGrant(grant: StoredGrant): Promise<void> {
		this.grants.set(permissionKeyToString(grant.key), grant)
	}

	async deleteGrant(key: PermissionKey): Promise<void> {
		this.grants.delete(permissionKeyToString(key))
	}

	async deleteAllForOriginator(originator: string): Promise<number> {
		let removed = 0
		for (const [id, grant] of this.grants) {
			if (grant.key.originator === originator) {
				this.grants.delete(id)
				removed++
			}
		}
		return removed
	}

	async listGrants(filter?: ListGrantsFilter): Promise<StoredGrant[]> {
		const out: StoredGrant[] = []
		for (const grant of this.grants.values()) {
			if (filter?.originator && grant.key.originator !== filter.originator)
				continue
			if (filter?.type && grant.key.type !== filter.type) continue
			out.push(grant)
		}
		return out
	}
}
