import type { WalletInterface, WalletProtocol } from '@bsv/sdk'
import {
	type CounterpartyPermissionEventHandler,
	type GroupedPermissionEventHandler,
	type GroupedPermissionRequest,
	type GroupedPermissions,
	type PermissionEventHandler,
	type PermissionRequest,
	type PermissionToken,
	type PermissionsManagerConfig,
	WalletPermissionsManager,
	type WalletPermissionsManagerCallbacks,
} from '@bsv/wallet-toolbox-client'
import {
	isExpired,
	normalizeOriginator,
	permissionKeyFromRequest,
	permissionKeyToString,
} from './key'
import type {
	IPermissionStore,
	ListGrantsFilter,
	PermissionKey,
	StoredGrant,
} from './types'

const IDB_TXID_PREFIX = 'idb:'

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
 * Reads:
 *  - `ensure*Access` checks the local store first; on miss it delegates to
 *    super (which then consults its own cache, on-chain tokens, and falls
 *    through to firing a prompt). Existing on-chain grants are honored.
 *  - Because super's grouped-permission filter calls back through
 *    `this.has*Access` → `this.ensure*Access`, our overrides are picked up
 *    polymorphically and the connect-time grouped prompt only requests
 *    permissions still missing from the store.
 *
 * Writes:
 *  - `grantPermission` writes to the store and resolves super's pending
 *    request via `super.grantPermission({ ephemeral: true })` (no on-chain
 *    mint, no cache write).
 *  - `grantGroupedPermission` writes each granted sub-permission to the
 *    store and resolves super's pending request via
 *    `super.dismissGroupedPermission` (no on-chain mint).
 *
 * Counterparty pact grants pass through to super unchanged — those still go
 * on-chain by design.
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
		// biome-ignore lint/style/useDefaultParameterLast: keeps signature aligned with WalletPermissionsManager
		config: PermissionsManagerConfig = {},
		options: LocalWalletPermissionsManagerOptions,
	) {
		super(underlyingWallet, adminOriginator, config)
		this.permissionStore = options.store
	}

	// -----------------------------------------------------------------
	// Callback binding — capture the request so grant overrides can
	// look it up by requestID later.
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
				return userHandler(request)
			}
			return super.bindCallback(eventName, wrapped)
		}

		const userHandler = handler as PermissionEventHandler
		const wrapped: PermissionEventHandler = async (request) => {
			this.pendingSingle.set(request.requestID, request)
			return userHandler(request)
		}
		return super.bindCallback(eventName, wrapped)
	}

	// -----------------------------------------------------------------
	// Read overrides — store-first, then delegate to super.
	//
	// Admin-restricted resources (admin originator, admin basket, admin
	// protocol) MUST go through super. Short-circuiting on a stored
	// grant would bypass super's admin-basket / admin-protocol throw
	// and let any dApp with a stored grant reach the default basket or
	// admin-prefixed protocols. See `isAdminBasketUpstream` /
	// `isAdminProtocolUpstream` below.
	// -----------------------------------------------------------------

	public override async ensureProtocolPermission(args: {
		originator: string
		privileged: boolean
		protocolID: WalletProtocol
		counterparty: string
		reason?: string
		seekPermission?: boolean
		usageType:
			| 'signing'
			| 'encrypting'
			| 'hmac'
			| 'publicKey'
			| 'identityKey'
			| 'linkageRevelation'
			| 'generic'
	}): Promise<boolean> {
		if (this.isAdminProtocolUpstream(args.protocolID)) {
			return super.ensureProtocolPermission(args)
		}
		const counterparty =
			args.protocolID[0] === 1 ? '' : (args.counterparty ?? 'self')
		const key: PermissionKey = {
			type: 'protocol',
			originator: normalizeOriginator(args.originator),
			privileged: !!args.privileged,
			protocolLevel: args.protocolID[0] as 0 | 1 | 2,
			protocolName: args.protocolID[1],
			counterparty,
		}
		if (await this.storeHit(key)) return true
		return super.ensureProtocolPermission(args)
	}

	public override async ensureBasketAccess(args: {
		originator: string
		basket: string
		reason?: string
		seekPermission?: boolean
		usageType: 'insertion' | 'removal' | 'listing'
	}): Promise<boolean> {
		if (this.isAdminBasketUpstream(args.basket)) {
			return super.ensureBasketAccess(args)
		}
		const key: PermissionKey = {
			type: 'basket',
			originator: normalizeOriginator(args.originator),
			basket: args.basket,
		}
		if (await this.storeHit(key)) return true
		return super.ensureBasketAccess(args)
	}

	public override async ensureCertificateAccess(args: {
		originator: string
		privileged: boolean
		verifier: string
		certType: string
		fields: string[]
		reason?: string
		seekPermission?: boolean
		usageType: 'disclosure'
	}): Promise<boolean> {
		const key: PermissionKey = {
			type: 'certificate',
			originator: normalizeOriginator(args.originator),
			privileged: !!args.privileged,
			verifier: args.verifier,
			certType: args.certType,
			fields: [...args.fields].sort(),
		}
		if (await this.storeHit(key)) return true
		return super.ensureCertificateAccess(args)
	}

	public override async ensureSpendingAuthorization(args: {
		originator: string
		satoshis: number
		lineItems?: Array<{
			type: 'input' | 'output' | 'fee'
			description: string
			satoshis: number
		}>
		reason?: string
		seekPermission?: boolean
	}): Promise<boolean> {
		const key: PermissionKey = {
			type: 'spending',
			originator: normalizeOriginator(args.originator),
		}
		const grant = await this.permissionStore.findGrant(key)
		if (grant && !isExpired(grant.expiry) && grant.authorizedAmount != null) {
			// authorizedAmount is a monthly budget, not a per-payment ceiling.
			// Comparing it against this request alone would approve it again on
			// every payment of that size. Month-to-date spend comes from the
			// labeled action history the base class writes on every createAction;
			// the grant itself holds no running total.
			const token = grantToToken(grant)
			token.rawOriginator = args.originator
			const spent = await this.querySpentSince(token)
			if (spent + args.satoshis <= grant.authorizedAmount) return true
		}
		return super.ensureSpendingAuthorization(args)
	}

	private async storeHit(key: PermissionKey): Promise<boolean> {
		const grant = await this.permissionStore.findGrant(key)
		return !!grant && !isExpired(grant.expiry)
	}

	// Reach into super for the BRC-100 admin-reservation rules. They're
	// declared `private` upstream (TypeScript-private, not `#`-private),
	// so they exist on the prototype. Duplicating the rules here would
	// silently drift if upstream ever extends them; the loud-throw guard
	// below trips fast on rename so we don't quietly regress to bypass.
	private isAdminBasketUpstream(basket: string): boolean {
		const fn = (this as unknown as { isAdminBasket?: (b: string) => boolean })
			.isAdminBasket
		if (typeof fn !== 'function') {
			throw new Error(
				'LocalWalletPermissionsManager: super.isAdminBasket is unavailable; admin-basket checks would silently bypass',
			)
		}
		return fn.call(this, basket)
	}

	private isAdminProtocolUpstream(proto: WalletProtocol): boolean {
		const fn = (
			this as unknown as {
				isAdminProtocol?: (p: WalletProtocol) => boolean
			}
		).isAdminProtocol
		if (typeof fn !== 'function') {
			throw new Error(
				'LocalWalletPermissionsManager: super.isAdminProtocol is unavailable; admin-protocol checks would silently bypass',
			)
		}
		return fn.call(this, proto)
	}

	// -----------------------------------------------------------------
	// Grant / deny overrides — write store, resolve super's pending
	// without minting on chain.
	// -----------------------------------------------------------------

	public override async grantPermission(params: {
		requestID: string
		expiry?: number
		ephemeral?: boolean
		amount?: number
	}): Promise<void> {
		const request = this.pendingSingle.get(params.requestID)
		if (request) {
			const key = permissionKeyFromRequest(request)
			// A spending prompt raised here is reactive: the manager asked because
			// this payment was not covered, and the user answered about this
			// payment. Persisting a cap would silently turn that into a standing
			// monthly allowance nobody asked for, so the approval covers the
			// request in flight and nothing is stored. Standing allowances come
			// only from grantGroupedPermission, where the app declared an amount
			// in its manifest and the user approved it as an allowance.
			if (key.type !== 'spending') {
				await this.permissionStore.putGrant({
					key,
					expiry: params.expiry ?? 0,
					grantedAt: Date.now(),
					reason: request.reason,
				})
			}
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
		granted: Partial<GroupedPermissions>
		expiry?: number
	}): Promise<void> {
		const request = this.pendingGrouped.get(params.requestID)
		if (request) {
			const originator = normalizeOriginator(request.originator)
			const now = Date.now()
			const expiry = params.expiry ?? 0

			if (params.granted.spendingAuthorization) {
				await this.permissionStore.putGrant({
					key: { type: 'spending', originator },
					expiry,
					grantedAt: now,
					authorizedAmount: params.granted.spendingAuthorization.amount,
					reason: params.granted.spendingAuthorization.description,
				})
			}

			for (const p of params.granted.protocolPermissions ?? []) {
				if (p.counterparty === '') continue
				// Never persist grants for admin-reserved protocols. A dApp
				// manifest could otherwise smuggle in admin-prefixed protocols
				// and survive the read-side admin guard via stored grants.
				if (this.isAdminProtocolUpstream(p.protocolID)) continue
				const level = p.protocolID[0] as 0 | 1 | 2
				const counterparty = level === 1 ? '' : (p.counterparty ?? 'self')
				await this.permissionStore.putGrant({
					key: {
						type: 'protocol',
						originator,
						privileged: false,
						protocolLevel: level,
						protocolName: p.protocolID[1],
						counterparty,
					},
					expiry,
					grantedAt: now,
					reason: p.description,
				})
			}

			for (const b of params.granted.basketAccess ?? []) {
				// Never persist grants for admin-reserved baskets (default,
				// admin-prefixed). A dApp manifest including basket "default"
				// would otherwise leave a stored grant that future bugs could
				// honor.
				if (this.isAdminBasketUpstream(b.basket)) continue
				await this.permissionStore.putGrant({
					key: { type: 'basket', originator, basket: b.basket },
					expiry,
					grantedAt: now,
					reason: b.description,
				})
			}

			for (const c of params.granted.certificateAccess ?? []) {
				await this.permissionStore.putGrant({
					key: {
						type: 'certificate',
						originator,
						privileged: false,
						verifier: c.verifierPublicKey,
						certType: c.type,
						fields: [...c.fields].sort(),
					},
					expiry,
					grantedAt: now,
					reason: c.description,
				})
			}

			this.pendingGrouped.delete(params.requestID)
		}
		return super.dismissGroupedPermission(params.requestID)
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
	// Listing — IDB-only.
	//
	// Earlier this manager merged IDB grants with `super.list*` on-chain
	// tokens. That coupling is the wrong default for the local flavor:
	// any stale on-chain reference (e.g. a token whose source tx isn't
	// known to local wallet storage) throws inside the base wallet's
	// `listOutputs`, which propagates up and blocks the IDB list too.
	//
	// LocalWalletPermissionsManager exists specifically because grants
	// belong in IDB, not on chain. Listing returns just IDB grants now;
	// the base WPM's on-chain listing is bypassed entirely.
	// -----------------------------------------------------------------

	public override async listProtocolPermissions(
		filter: {
			originator?: string
			privileged?: boolean
			protocolName?: string
			protocolSecurityLevel?: number
			counterparty?: string
		} = {},
	): Promise<PermissionToken[]> {
		return this.idbTokensFor('protocol', filter.originator, (g) => {
			if (g.key.type !== 'protocol') return false
			if (
				filter.privileged !== undefined &&
				g.key.privileged !== filter.privileged
			) {
				return false
			}
			if (
				filter.protocolName !== undefined &&
				g.key.protocolName !== filter.protocolName
			) {
				return false
			}
			if (
				filter.protocolSecurityLevel !== undefined &&
				g.key.protocolLevel !== filter.protocolSecurityLevel
			) {
				return false
			}
			if (
				filter.counterparty !== undefined &&
				g.key.counterparty !== filter.counterparty
			) {
				return false
			}
			return true
		})
	}

	public override async listBasketAccess(
		params: { originator?: string; basket?: string } = {},
	): Promise<PermissionToken[]> {
		return this.idbTokensFor('basket', params.originator, (g) => {
			if (g.key.type !== 'basket') return false
			if (params.basket !== undefined && g.key.basket !== params.basket) {
				return false
			}
			return true
		})
	}

	public override async listSpendingAuthorizations(params: {
		originator?: string
	}): Promise<PermissionToken[]> {
		return this.idbTokensFor(
			'spending',
			params.originator,
			(g) => g.key.type === 'spending',
		)
	}

	public override async listCertificateAccess(
		params: {
			originator?: string
			privileged?: boolean
			certType?: string
			verifier?: string
		} = {},
	): Promise<PermissionToken[]> {
		return this.idbTokensFor('certificate', params.originator, (g) => {
			if (g.key.type !== 'certificate') return false
			if (
				params.privileged !== undefined &&
				g.key.privileged !== params.privileged
			) {
				return false
			}
			if (params.certType !== undefined && g.key.certType !== params.certType) {
				return false
			}
			if (params.verifier !== undefined && g.key.verifier !== params.verifier) {
				return false
			}
			return true
		})
	}

	private async idbTokensFor(
		type: ListGrantsFilter['type'],
		originator: string | undefined,
		predicate: (g: StoredGrant) => boolean,
	): Promise<PermissionToken[]> {
		const filter: ListGrantsFilter = { type }
		if (originator) filter.originator = normalizeOriginator(originator)
		const grants = await this.permissionStore.listGrants(filter)
		return grants.filter(predicate).map(grantToToken)
	}

	// -----------------------------------------------------------------
	// Revocation — IDB-only. Symmetric with the IDB-only listing above:
	// since we no longer surface on-chain tokens, revoking them via
	// super (which would try to spend them) is unnecessary and would
	// fail on stale references.
	// -----------------------------------------------------------------

	public override async revokeAllForOriginator(
		originator: string,
	): Promise<PermissionToken[]> {
		const normalized = normalizeOriginator(originator)
		await this.permissionStore.deleteAllForOriginator(normalized)
		this.clearPermissionCache()
		return []
	}

	public override async revokePermission(
		oldToken: PermissionToken,
	): Promise<void> {
		const idbKey = idbKeyFromToken(oldToken)
		if (idbKey) {
			await this.permissionStore.deleteGrant(idbKey)
		}
		this.clearPermissionCache()
	}

	/**
	 * Clear the parent WPM's in-memory permission cache so revoked grants
	 * aren't served from cache for up to 5 minutes after revocation.
	 * `permissionCache` is declared `private` upstream (TypeScript-private,
	 * not `#`-private) so it exists on the prototype at runtime.
	 */
	private clearPermissionCache(): void {
		const cache = (this as unknown as { permissionCache: Map<string, unknown> })
			.permissionCache
		if (cache instanceof Map) {
			cache.clear()
		}
	}
}

function grantToToken(grant: StoredGrant): PermissionToken {
	const base: PermissionToken = {
		txid: `${IDB_TXID_PREFIX}${permissionKeyToString(grant.key)}`,
		tx: [],
		outputIndex: 0,
		outputScript: '',
		satoshis: 0,
		originator: grant.key.originator,
		expiry: grant.expiry,
	}
	switch (grant.key.type) {
		case 'protocol':
			base.privileged = grant.key.privileged
			base.protocol = grant.key.protocolName
			base.securityLevel = grant.key.protocolLevel
			base.counterparty = grant.key.counterparty
			break
		case 'basket':
			base.basketName = grant.key.basket
			break
		case 'certificate':
			base.privileged = grant.key.privileged
			base.certType = grant.key.certType
			base.certFields = grant.key.fields
			base.verifier = grant.key.verifier
			break
		case 'spending':
			if (grant.authorizedAmount != null) {
				base.authorizedAmount = grant.authorizedAmount
			}
			break
	}
	return base
}

function idbKeyFromToken(token: PermissionToken): PermissionKey | null {
	if (token.txid.startsWith(IDB_TXID_PREFIX)) {
		return parseIdbKey(token.txid.slice(IDB_TXID_PREFIX.length))
	}
	const originator = normalizeOriginator(token.originator)
	if (token.basketName) {
		return { type: 'basket', originator, basket: token.basketName }
	}
	if (token.protocol && token.securityLevel !== undefined) {
		return {
			type: 'protocol',
			originator,
			privileged: !!token.privileged,
			protocolLevel: token.securityLevel,
			protocolName: token.protocol,
			counterparty: token.counterparty ?? 'self',
		}
	}
	if (token.certType && token.verifier && token.certFields) {
		return {
			type: 'certificate',
			originator,
			privileged: !!token.privileged,
			verifier: token.verifier,
			certType: token.certType,
			fields: [...token.certFields].sort(),
		}
	}
	if (token.authorizedAmount !== undefined) {
		return { type: 'spending', originator }
	}
	return null
}

function parseIdbKey(serialized: string): PermissionKey | null {
	const idx = serialized.indexOf(':')
	if (idx < 0) return null
	const tag = serialized.slice(0, idx)
	const rest = serialized.slice(idx + 1)
	if (tag === 'basket') {
		const sep = rest.indexOf(':')
		if (sep < 0) return null
		return {
			type: 'basket',
			originator: rest.slice(0, sep),
			basket: rest.slice(sep + 1),
		}
	}
	if (tag === 'spend') {
		return { type: 'spending', originator: rest }
	}
	if (tag === 'proto') {
		const parts = rest.split(':')
		if (parts.length < 4) return null
		const [originator, privileged, levelAndName, counterparty] = parts
		const commaIdx = levelAndName.indexOf(',')
		if (commaIdx < 0) return null
		const level = Number(levelAndName.slice(0, commaIdx)) as 0 | 1 | 2
		const protocolName = levelAndName.slice(commaIdx + 1)
		return {
			type: 'protocol',
			originator,
			privileged: privileged === 'true',
			protocolLevel: level,
			protocolName,
			counterparty,
		}
	}
	if (tag === 'cert') {
		const parts = rest.split(':')
		if (parts.length < 5) return null
		const [originator, privileged, verifier, certType, fieldsJoined] = parts
		return {
			type: 'certificate',
			originator,
			privileged: privileged === 'true',
			verifier,
			certType,
			fields: fieldsJoined ? fieldsJoined.split('|') : [],
		}
	}
	return null
}
