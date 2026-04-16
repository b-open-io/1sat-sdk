/** The four BRC-100 permission categories. */
export type PermissionType = 'protocol' | 'basket' | 'certificate' | 'spending'

/** A normalized permission key, uniquely identifying a (originator, category, parameters) tuple. */
export type PermissionKey =
	| {
			type: 'protocol'
			originator: string
			privileged: boolean
			protocolLevel: 0 | 1 | 2
			protocolName: string
			counterparty: string
	  }
	| {
			type: 'basket'
			originator: string
			basket: string
	  }
	| {
			type: 'certificate'
			originator: string
			privileged: boolean
			verifier: string
			certType: string
			fields: string[]
	  }
	| {
			type: 'spending'
			originator: string
	  }

/**
 * A persisted permission grant.
 *
 * For spending (DSAP) grants, the ledger only stores the user-authorized cap
 * (`authorizedAmount`). Actual monthly spend is read from the wallet's
 * action history on every cap check via `WalletPermissionsManager.querySpentSince`.
 */
export interface StoredGrant {
	key: PermissionKey
	/** UNIX seconds, 0 for never expires. */
	expiry: number
	/** UNIX milliseconds when this grant was created. */
	grantedAt: number
	/** Optional human-readable reason captured from the request. */
	reason?: string
	/** DSAP only — monthly spending cap (in satoshis). */
	authorizedAmount?: number
}

/** Filter passed to `IPermissionStore.listGrants`. */
export interface ListGrantsFilter {
	originator?: string
	type?: PermissionType
}

/**
 * Storage backend for permission grants used by `LocalWalletPermissionsManager`.
 *
 * Implementations should be keyed by the canonical string form of the
 * `PermissionKey` (use `permissionKeyToString` from `./key`).
 *
 * All methods are async to allow implementations backed by persistent
 * stores (IndexedDB, chrome.storage, file, etc.).
 */
export interface IPermissionStore {
	findGrant(key: PermissionKey): Promise<StoredGrant | null>
	putGrant(grant: StoredGrant): Promise<void>
	deleteGrant(key: PermissionKey): Promise<void>
	deleteAllForOriginator(originator: string): Promise<number>
	listGrants(filter?: ListGrantsFilter): Promise<StoredGrant[]>
}
