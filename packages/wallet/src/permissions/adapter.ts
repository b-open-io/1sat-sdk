import type {
	CounterpartyPermissionEventHandler,
	CounterpartyPermissionRequest,
	GroupedPermissionEventHandler,
	GroupedPermissionRequest,
	PermissionEventHandler,
	PermissionRequest,
	PermissionToken,
	WalletPermissionsManager,
	WalletPermissionsManagerCallbacks,
} from '@bsv/wallet-toolbox'
import {
	filterGroupedByMissing,
	isExpired,
	normalizeOriginator,
	permissionKeyFromRequest,
	permissionKeyToString,
	permissionKeysFromGroup,
} from './key'
import type {
	IPermissionStore,
	PermissionKey,
	PermissionPromptHandler,
	PermissionRecord,
	StoredGrant,
} from './types'

export interface PermissionLedgerAdapterOptions {
	/** The WPM instance to attach callbacks to. */
	wallet: WalletPermissionsManager
	/** Persistent store for permission grants. */
	store: IPermissionStore
	/** UI prompt callbacks. */
	prompt: PermissionPromptHandler
}

type CallbackName = keyof WalletPermissionsManagerCallbacks
type AnyPermissionEventHandler =
	| PermissionEventHandler
	| GroupedPermissionEventHandler
	| CounterpartyPermissionEventHandler

/**
 * Bridges an {@link IPermissionStore} to a {@link WalletPermissionsManager}.
 *
 * The adapter owns WPM's permission callbacks. On every permission check:
 *
 *  1. It looks up a stored grant in the supplied store.
 *  2. If a valid unexpired grant exists, it calls
 *     `wallet.grantPermission({ ephemeral: true })` silently. WPM resolves
 *     the pending dApp call without writing anything to the chain.
 *  3. Otherwise it delegates to the host app's prompt handler. On approval,
 *     it writes the grant to the store and calls `grantPermission` ephemerally.
 *
 * BRC-73 grouped permissions are handled via `dismissGroupedPermission` after
 * writing each sub-permission to the store. WPM's downstream per-method checks
 * then find the entries on their individual callback paths. When a site adds
 * a new permission between visits, the prompt receives only the missing
 * subset — already-granted permissions are not re-listed.
 *
 * DSAP (spending) cap enforcement reads actual confirmed spend from the
 * wallet's action history via `WalletPermissionsManager.querySpentSince` —
 * the same mechanism WPM uses natively. No ledger-side counter is
 * maintained, so failed broadcasts cannot cause drift.
 *
 * Level-2 counterparty pacts (`onCounterpartyPermissionRequested`) remain
 * on-chain: the adapter just routes the UI decision to WPM's native
 * `grantCounterpartyPermission` / `denyCounterpartyPermission`. If the
 * consumer omits `prompt.onCounterpartyPermissionRequested`, the adapter
 * auto-denies counterparty requests so the dApp call fails cleanly instead
 * of hanging forever.
 *
 * Call {@link dispose} to unbind callbacks when tearing down the wallet.
 */
export class PermissionLedgerAdapter {
	private readonly wallet: WalletPermissionsManager
	private readonly store: IPermissionStore
	private readonly prompt: PermissionPromptHandler
	private boundCallbacks: Array<[CallbackName, number]> = []

	constructor(options: PermissionLedgerAdapterOptions) {
		this.wallet = options.wallet
		this.store = options.store
		this.prompt = options.prompt
		this.bindCallbacks()
	}

	private bindCallbacks(): void {
		const bind = (name: CallbackName, handler: AnyPermissionEventHandler) => {
			const id = this.wallet.bindCallback(name, handler)
			this.boundCallbacks.push([name, id])
		}

		const single: PermissionEventHandler = (r) => this.handleSingle(r)
		const spending: PermissionEventHandler = (r) => this.handleSpending(r)
		const grouped: GroupedPermissionEventHandler = (r) => this.handleGrouped(r)
		const counterparty: CounterpartyPermissionEventHandler = (r) =>
			this.handleCounterparty(r)

		bind('onProtocolPermissionRequested', single)
		bind('onBasketAccessRequested', single)
		bind('onCertificateAccessRequested', single)
		bind('onSpendingAuthorizationRequested', spending)
		bind('onGroupedPermissionRequested', grouped)
		bind('onCounterpartyPermissionRequested', counterparty)
	}

	/** Unbinds every callback this adapter registered on the wallet. */
	dispose(): void {
		for (const [name, id] of this.boundCallbacks) {
			this.wallet.unbindCallback(name, id)
		}
		this.boundCallbacks = []
	}

	// ---------------------------------------------------------------------
	// Handlers
	// ---------------------------------------------------------------------

	private async handleSingle(
		request: PermissionRequest & { requestID: string },
	): Promise<void> {
		try {
			const key = permissionKeyFromRequest(request)
			const existing = await this.store.findGrant(key)
			if (existing && !isExpired(existing.expiry)) {
				await this.wallet.grantPermission({
					requestID: request.requestID,
					ephemeral: true,
				})
				return
			}

			const decision = await this.prompt.onPermissionRequested(request)
			if (decision.approved) {
				await this.store.putGrant({
					key,
					expiry: decision.expiry ?? 0,
					grantedAt: Date.now(),
					reason: request.reason,
				})
				await this.wallet.grantPermission({
					requestID: request.requestID,
					ephemeral: true,
				})
			} else {
				await this.wallet.denyPermission(request.requestID)
			}
		} catch (err) {
			await this.safeDeny(request.requestID)
			throw err
		}
	}

	private async handleSpending(
		request: PermissionRequest & { requestID: string },
	): Promise<void> {
		try {
			if (request.type !== 'spending' || !request.spending) {
				await this.wallet.denyPermission(request.requestID)
				return
			}
			const key = permissionKeyFromRequest(request)
			const needed = request.spending.satoshis
			const existing = await this.store.findGrant(key)

			if (
				existing &&
				!isExpired(existing.expiry) &&
				existing.key.type === 'spending' &&
				existing.authorizedAmount != null
			) {
				// Read actual confirmed spend for this originator this month directly
				// from the wallet's action history. WPM's own `querySpentSince` only
				// reads `token.originator` + `token.rawOriginator`, so we can pass a
				// minimal stub rather than reconstruct a full PermissionToken.
				const spent = await this.wallet.querySpentSince({
					originator: existing.key.originator,
				} as PermissionToken)
				if (spent + needed <= existing.authorizedAmount) {
					await this.wallet.grantPermission({
						requestID: request.requestID,
						ephemeral: true,
					})
					return
				}
			}

			const decision = await this.prompt.onPermissionRequested(request)
			if (decision.approved) {
				await this.store.putGrant({
					key,
					expiry: decision.expiry ?? 0,
					grantedAt: Date.now(),
					reason: request.reason,
					authorizedAmount: decision.authorizedAmount ?? needed,
				})
				await this.wallet.grantPermission({
					requestID: request.requestID,
					ephemeral: true,
				})
			} else {
				await this.wallet.denyPermission(request.requestID)
			}
		} catch (err) {
			await this.safeDeny(request.requestID)
			throw err
		}
	}

	private async handleGrouped(
		request: GroupedPermissionRequest,
	): Promise<void> {
		try {
			const neededKeys = permissionKeysFromGroup(
				request.originator,
				request.permissions,
			)
			const lookups = await Promise.all(
				neededKeys.map((k) => this.store.findGrant(k)),
			)
			const missingKeys = new Set<string>()
			for (let i = 0; i < neededKeys.length; i++) {
				const g = lookups[i]
				if (!g || isExpired(g.expiry)) {
					missingKeys.add(permissionKeyToString(neededKeys[i]))
				}
			}

			if (missingKeys.size === 0) {
				await this.wallet.dismissGroupedPermission(request.requestID)
				return
			}

			// Hand the prompt only the sub-permissions that still need approval.
			// On first visit this equals the full bundle; on a revisit where the
			// site has added one new permission, only that new one is shown.
			const trimmedPermissions = filterGroupedByMissing(
				request.originator,
				request.permissions,
				missingKeys,
			)
			const decision = await this.prompt.onGroupedPermissionRequested({
				...request,
				permissions: trimmedPermissions,
			})
			if (!decision.approved) {
				await this.wallet.denyGroupedPermission(request.requestID)
				return
			}

			const normalized = normalizeOriginator(request.originator)
			const grantedKeys = permissionKeysFromGroup(normalized, decision.granted)
			const now = Date.now()
			const expiry = decision.expiry ?? 0

			for (const key of grantedKeys) {
				const grant: StoredGrant = { key, expiry, grantedAt: now }
				if (key.type === 'spending' && decision.granted.spendingAuthorization) {
					grant.authorizedAmount = decision.granted.spendingAuthorization.amount
					grant.reason = decision.granted.spendingAuthorization.description
				}
				await this.store.putGrant(grant)
			}

			await this.wallet.dismissGroupedPermission(request.requestID)
		} catch (err) {
			await this.wallet
				.denyGroupedPermission(request.requestID)
				.catch(() => undefined)
			throw err
		}
	}

	private async handleCounterparty(
		request: CounterpartyPermissionRequest,
	): Promise<void> {
		// Level-2 counterparty pacts stay on-chain. The adapter does not consult
		// the local store for these; it just routes the consumer's UI decision
		// to WPM's native grant/deny (which writes the token to the chain).
		const handler = this.prompt.onCounterpartyPermissionRequested
		if (!handler) {
			await this.wallet.denyCounterpartyPermission(request.requestID)
			return
		}
		try {
			const decision = await handler(request)
			if (decision.approved) {
				await this.wallet.grantCounterpartyPermission({
					requestID: request.requestID,
					granted: decision.granted,
					expiry: decision.expiry,
				})
			} else {
				await this.wallet.denyCounterpartyPermission(request.requestID)
			}
		} catch (err) {
			await this.wallet
				.denyCounterpartyPermission(request.requestID)
				.catch(() => undefined)
			throw err
		}
	}

	private async safeDeny(requestID: string): Promise<void> {
		await this.wallet.denyPermission(requestID).catch(() => undefined)
	}

	// ---------------------------------------------------------------------
	// Management helpers (for consumers to rebuild UIs)
	// ---------------------------------------------------------------------

	/**
	 * Return the full union of local (ledger) grants and on-chain WPM tokens.
	 *
	 * Under the default setup, the on-chain side contains only level-2
	 * counterparty pacts (and any pre-migration tokens that still exist).
	 * Records are tagged with `source: 'ledger' | 'onchain'` so the revoke
	 * handler can route correctly.
	 */
	async listAllPermissions(): Promise<PermissionRecord[]> {
		const [ledger, protocols, baskets, spending, certs] = await Promise.all([
			this.store.listGrants(),
			this.wallet.listProtocolPermissions({}),
			this.wallet.listBasketAccess({}),
			this.wallet.listSpendingAuthorizations({}),
			this.wallet.listCertificateAccess({}),
		])
		const ledgerRecords: PermissionRecord[] = ledger.map((g) => ({
			source: 'ledger',
			...g,
		}))
		const onChain: PermissionRecord[] = [
			...protocols.map((t) => ({
				source: 'onchain' as const,
				type: 'protocol' as const,
				token: t,
			})),
			...baskets.map((t) => ({
				source: 'onchain' as const,
				type: 'basket' as const,
				token: t,
			})),
			...spending.map((t) => ({
				source: 'onchain' as const,
				type: 'spending' as const,
				token: t,
			})),
			...certs.map((t) => ({
				source: 'onchain' as const,
				type: 'certificate' as const,
				token: t,
			})),
		]
		return [...ledgerRecords, ...onChain]
	}

	/**
	 * Revoke a single ledger-backed grant.
	 *
	 * To revoke an on-chain (counterparty) token, call
	 * `wallet.revokePermission(token)` directly with the raw WPM token.
	 */
	async revokeLedgerGrant(key: PermissionKey): Promise<void> {
		await this.store.deleteGrant(key)
	}

	/**
	 * Revoke every grant for an originator across both stores.
	 *
	 * Returns counts of what was removed from each side.
	 */
	async revokeAllForOriginator(
		originator: string,
	): Promise<{ ledger: number; onchain: number }> {
		const normalized = normalizeOriginator(originator)
		const ledgerCount = await this.store.deleteAllForOriginator(normalized)
		const onchainRevoked = await this.wallet.revokeAllForOriginator(normalized)
		return { ledger: ledgerCount, onchain: onchainRevoked.length }
	}

	/**
	 * Return the satoshi amount spent against the given DSAP grant in the
	 * current UTC month, read from the wallet's action history.
	 *
	 * Delegates to `WalletPermissionsManager.querySpentSince` for accuracy and
	 * cross-device consistency — the ledger does not track spend itself.
	 */
	async querySpent(key: PermissionKey): Promise<number> {
		if (key.type !== 'spending') return 0
		return this.wallet.querySpentSince({
			originator: key.originator,
		} as PermissionToken)
	}
}
