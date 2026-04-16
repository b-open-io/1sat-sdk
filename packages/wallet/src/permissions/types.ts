import type {
	CounterpartyPermissionRequest,
	CounterpartyPermissions,
	GroupedPermissionRequest,
	GroupedPermissions,
	PermissionRequest,
	PermissionToken,
} from '@bsv/wallet-toolbox'

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
 * action history on every cap check via `WalletPermissionsManager.querySpentSince`
 * — the same mechanism WPM uses natively, so spent accounting remains exact
 * and cross-device consistent.
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
 * Storage backend for permission grants.
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

/** User decision returned from a single-permission prompt. */
export type PermissionPromptDecision =
	| {
			approved: true
			/** Optional override for the grant expiry in UNIX seconds. */
			expiry?: number
			/** DSAP only — override the authorized amount (e.g. user chose a larger cap). */
			authorizedAmount?: number
	  }
	| { approved: false }

/** User decision returned from a BRC-73 grouped-permission prompt. */
export type GroupedPermissionPromptDecision =
	| {
			approved: true
			/** Subset of the requested permissions that the user agreed to. */
			granted: Partial<GroupedPermissions>
			expiry?: number
	  }
	| { approved: false }

/**
 * User decision returned from a level-2 counterparty pact prompt.
 *
 * `granted` is a `Partial<CounterpartyPermissions>` because users typically
 * approve a subset of the requested protocols, matching WPM's
 * `grantCounterpartyPermission` signature.
 */
export type CounterpartyPermissionPromptDecision =
	| {
			approved: true
			granted: Partial<CounterpartyPermissions>
			expiry?: number
	  }
	| { approved: false }

/**
 * Prompt callbacks supplied by the consumer (the host app).
 *
 * The adapter calls these when a grant is needed after the store lookup
 * comes back empty. Counterparty prompts are optional — if omitted, the
 * adapter auto-denies counterparty requests so the dApp call fails cleanly
 * instead of hanging forever.
 */
export interface PermissionPromptHandler {
	onPermissionRequested(
		request: PermissionRequest & { requestID: string },
	): Promise<PermissionPromptDecision>
	onGroupedPermissionRequested(
		request: GroupedPermissionRequest,
	): Promise<GroupedPermissionPromptDecision>
	onCounterpartyPermissionRequested?(
		request: CounterpartyPermissionRequest,
	): Promise<CounterpartyPermissionPromptDecision>
}

/** The source a permission record was loaded from when listing all permissions. */
export type PermissionRecordSource = 'ledger' | 'onchain'

/**
 * Unified record returned by the adapter's `listAllPermissions` helper.
 *
 * `source: 'ledger'` records are local `StoredGrant`s; `source: 'onchain'`
 * records are WPM `PermissionToken` shapes surfaced for level-2 counterparty
 * pacts (and any pre-migration on-chain tokens that still exist).
 */
export type PermissionRecord =
	| ({ source: 'ledger' } & StoredGrant)
	| {
			source: 'onchain'
			type: PermissionType
			token: PermissionToken
	  }
