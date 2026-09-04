import { permissionKeyToString } from './key.js'
import type {
	IPermissionStore,
	ListGrantsFilter,
	PermissionKey,
	StoredGrant,
} from './types.js'

/**
 * Reference `IPermissionStore` that keeps grants in a JS `Map`.
 *
 * Useful for tests, Node/server environments, and as a template for custom
 * backends. Browser apps should prefer `IndexedDbPermissionStore` from
 * `@1sat/wallet-browser` — it's the default for `createWebWallet`.
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
