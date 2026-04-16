import type { WalletInterface } from '@bsv/sdk'
import {
	type CounterpartyPermissionEventHandler,
	type GroupedPermissionEventHandler,
	type GroupedPermissionRequest,
	type PermissionEventHandler,
	type PermissionRequest,
	type PermissionsManagerConfig,
	WalletPermissionsManager,
	type WalletPermissionsManagerCallbacks,
} from '@bsv/wallet-toolbox/out/src/index.client.js'
import {
	isExpired,
	normalizeOriginator,
	permissionKeyFromRequest,
	permissionKeysFromGroup,
} from './key'
import type { IPermissionStore, StoredGrant } from './types'

export interface LocalWalletPermissionsManagerOptions {
	/** Store grants are persisted into and read from. */
	store: IPermissionStore
}

type AnyPermissionEventHandler =
	| PermissionEventHandler
	| GroupedPermissionEventHandler
	| CounterpartyPermissionEventHandler

/**
 * `WalletPermissionsManager` variant that persists grants to an injected
 * `IPermissionStore` instead of minting on-chain PushDrop tokens.
 *
 * Interface-compatible with `WalletPermissionsManager` — swap the class name
 * and keep every other call the same (`bindCallback`, `grantPermission`,
 * `denyPermission`, etc.).
 *
 * Behavior:
 *  - Store-hit short-circuits the prompt callback: `grantPermission` is
 *    invoked silently with `ephemeral: true` and the user's handler never
 *    runs.
 *  - Store-miss falls through to the user's handler as normal. When the
 *    handler calls `grantPermission(...)` on approve, the grant is written
 *    to the store and forwarded to the base class with `ephemeral: true`
 *    so nothing is minted on chain.
 *  - Counterparty pact grants pass through unchanged — those still go
 *    on-chain by design.
 */
export class LocalWalletPermissionsManager extends WalletPermissionsManager {
	private readonly permissionStore: IPermissionStore
	private readonly pendingSingle = new Map<
		string,
		PermissionRequest & { requestID: string }
	>()
	private readonly pendingGrouped = new Map<string, GroupedPermissionRequest>()

	constructor(
		underlyingWallet: WalletInterface,
		adminOriginator: string,
		config: PermissionsManagerConfig = {},
		options: LocalWalletPermissionsManagerOptions,
	) {
		super(underlyingWallet, adminOriginator, config)
		this.permissionStore = options.store
	}

	// -----------------------------------------------------------------
	// Callback binding — wrap user handlers with a store-first check
	// -----------------------------------------------------------------

	public override bindCallback(
		eventName: keyof WalletPermissionsManagerCallbacks,
		handler: AnyPermissionEventHandler,
	): number {
		if (eventName === 'onCounterpartyPermissionRequested') {
			return super.bindCallback(eventName, handler)
		}
		if (eventName === 'onGroupedPermissionRequested') {
			const userHandler = handler as GroupedPermissionEventHandler
			const wrapped: GroupedPermissionEventHandler = async (request) => {
				this.pendingGrouped.set(request.requestID, request)
				const keys = permissionKeysFromGroup(
					request.originator,
					request.permissions,
				)
				if (keys.length > 0) {
					const grants = await Promise.all(
						keys.map((k) => this.permissionStore.findGrant(k)),
					)
					const allHit =
						grants.length === keys.length &&
						grants.every((g) => g != null && !isExpired(g.expiry))
					if (allHit) {
						await super.dismissGroupedPermission(request.requestID)
						this.pendingGrouped.delete(request.requestID)
						return
					}
				}
				return userHandler(request)
			}
			return super.bindCallback(eventName, wrapped)
		}

		const userHandler = handler as PermissionEventHandler
		const wrapped: PermissionEventHandler = async (request) => {
			this.pendingSingle.set(request.requestID, request)
			const key = permissionKeyFromRequest(request)
			const existing = await this.permissionStore.findGrant(key)
			if (existing && !isExpired(existing.expiry)) {
				await super.grantPermission({
					requestID: request.requestID,
					ephemeral: true,
				})
				this.pendingSingle.delete(request.requestID)
				return
			}
			return userHandler(request)
		}
		return super.bindCallback(eventName, wrapped)
	}

	// -----------------------------------------------------------------
	// Grant / deny overrides — write store + force ephemeral
	// -----------------------------------------------------------------

	public override async grantPermission(params: {
		requestID: string
		expiry?: number
		ephemeral?: boolean
	}): Promise<void> {
		const request = this.pendingSingle.get(params.requestID)
		if (request) {
			const key = permissionKeyFromRequest(request)
			const grant: StoredGrant = {
				key,
				expiry: params.expiry ?? 0,
				grantedAt: Date.now(),
				reason: request.reason,
			}
			if (
				request.type === 'spending' &&
				request.spending?.satoshis != null
			) {
				grant.authorizedAmount = request.spending.satoshis
			}
			await this.permissionStore.putGrant(grant)
			this.pendingSingle.delete(params.requestID)
		}
		return super.grantPermission({ ...params, ephemeral: true })
	}

	public override async denyPermission(requestID: string): Promise<void> {
		this.pendingSingle.delete(requestID)
		return super.denyPermission(requestID)
	}

	public override async grantGroupedPermission(params: {
		requestID: string
		granted: Partial<import('@bsv/wallet-toolbox/out/src/index.client.js').GroupedPermissions>
		expiry?: number
	}): Promise<void> {
		const request = this.pendingGrouped.get(params.requestID)
		if (request) {
			const normalized = normalizeOriginator(request.originator)
			const grantedKeys = permissionKeysFromGroup(normalized, params.granted)
			const now = Date.now()
			const expiry = params.expiry ?? 0
			for (const key of grantedKeys) {
				const grant: StoredGrant = { key, expiry, grantedAt: now }
				if (
					key.type === 'spending' &&
					params.granted.spendingAuthorization
				) {
					grant.authorizedAmount = params.granted.spendingAuthorization.amount
					grant.reason = params.granted.spendingAuthorization.description
				}
				await this.permissionStore.putGrant(grant)
			}
			this.pendingGrouped.delete(params.requestID)
		}
		return super.grantGroupedPermission(params)
	}

	public override async denyGroupedPermission(
		requestID: string,
	): Promise<void> {
		this.pendingGrouped.delete(requestID)
		return super.denyGroupedPermission(requestID)
	}

	public override async dismissGroupedPermission(
		requestID: string,
	): Promise<void> {
		this.pendingGrouped.delete(requestID)
		return super.dismissGroupedPermission(requestID)
	}

	// -----------------------------------------------------------------
	// Revocation — remove from store in addition to on-chain
	// -----------------------------------------------------------------

	public override async revokeAllForOriginator(
		originator: string,
	): Promise<import('@bsv/wallet-toolbox/out/src/index.client.js').PermissionToken[]> {
		const normalized = normalizeOriginator(originator)
		await this.permissionStore.deleteAllForOriginator(normalized)
		return super.revokeAllForOriginator(normalized)
	}
}
