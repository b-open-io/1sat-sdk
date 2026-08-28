import type { PermissionSchemeId } from '@1sat/types'
import { nameFromMap } from '@1sat/types'
import type { IPermissionStore } from '@1sat/wallet'
import type { InternalizeActionArgs, ListOutputsArgs } from '@bsv/sdk'
import type {
	BasketAccessRequest,
	PromptHandler,
	VerificationServices,
} from './types'
import { axisTagValues, parseViewBasket, viewGrantKey } from './viewScope'

/** Deps needed for basket / view-scope gating (no createAction pipeline). */
export interface BasketAccessDeps {
	schemeId: PermissionSchemeId
	ownedBaskets: ReadonlySet<string>
	promptHandler: PromptHandler
	adminOriginator?: string
	permissionStore?: IPermissionStore
	services?: VerificationServices
}

/**
 * Gate access to storage baskets (internalize / plain owned basket).
 * Admin bypasses. Grants keyed by storage basket name.
 */
export async function ensureBasketAccess(
	deps: BasketAccessDeps,
	originator: string,
	baskets: Iterable<string>,
): Promise<void> {
	if (deps.adminOriginator && originator === deps.adminOriginator) return

	const unique = new Set<string>()
	for (const b of baskets) {
		if (typeof b !== 'string') continue
		const n = b.trim().toLowerCase()
		if (deps.ownedBaskets.has(n)) unique.add(n)
	}
	if (unique.size === 0) return

	await ensureGrants(deps, originator, [...unique], 'basket')
}

/**
 * Gate view under `p <scheme> <scope>`.
 *
 * Grant keys:
 * - `p <scheme> all` covers every scope/value
 * - bare `p <scheme> collection` (etc.) = legacy whole-axis
 * - `p <scheme> collection <value>` = one allowed axis tag value
 */
export async function ensureViewScopeAccess(
	deps: BasketAccessDeps,
	originator: string,
	grantBasket: string,
	axisValues: string[] = [],
): Promise<void> {
	if (deps.adminOriginator && originator === deps.adminOriginator) return

	const allGrant = `p ${deps.schemeId} all`
	const keysToEnsure: string[] =
		axisValues.length === 0
			? [grantBasket]
			: axisValues.map((v) => viewGrantKey(grantBasket, v))

	if (deps.permissionStore) {
		const all = await deps.permissionStore.findGrant({
			type: 'basket',
			originator,
			basket: allGrant,
		})
		if (all && !isGrantExpired(all.expiry)) return

		// Legacy whole-axis grant covers any value on that axis
		const whole = await deps.permissionStore.findGrant({
			type: 'basket',
			originator,
			basket: grantBasket,
		})
		if (whole && !isGrantExpired(whole.expiry)) return

		const missing: string[] = []
		for (const key of keysToEnsure) {
			const g = await deps.permissionStore.findGrant({
				type: 'basket',
				originator,
				basket: key,
			})
			if (!g || isGrantExpired(g.expiry)) missing.push(key)
		}
		if (missing.length === 0) return
		await ensureGrants(deps, originator, missing, 'view')
		return
	}

	await ensureGrants(deps, originator, keysToEnsure, 'view')
}

async function ensureGrants(
	deps: BasketAccessDeps,
	originator: string,
	grantKeys: string[],
	kind: 'basket' | 'view',
): Promise<void> {
	const toPrompt: string[] = []
	if (deps.permissionStore) {
		for (const basket of grantKeys) {
			const grant = await deps.permissionStore.findGrant({
				type: 'basket',
				originator,
				basket,
			})
			if (!grant || isGrantExpired(grant.expiry)) {
				toPrompt.push(basket)
			}
		}
	} else {
		toPrompt.push(...grantKeys)
	}

	if (toPrompt.length === 0) return

	const label = kind === 'view' ? 'view' : 'access'
	const baskets = await enrichBasketAccessRequests(deps, toPrompt)
	const approved = await deps.promptHandler({
		kind: 'basketAccess',
		originator,
		payload: { baskets },
		summary:
			toPrompt.length === 1
				? `Grant ${label} to ${toPrompt[0]}`
				: `Grant ${label} to ${toPrompt.length} baskets`,
	})
	if (!approved) {
		throw new Error(
			`Permission module (${deps.schemeId}): user denied ${label} (${toPrompt.join(', ')}).`,
		)
	}

	if (deps.permissionStore) {
		const now = Date.now()
		for (const basket of toPrompt) {
			await deps.permissionStore.putGrant({
				key: { type: 'basket', originator, basket },
				expiry: 0,
				grantedAt: now,
			})
		}
	}
}

function isGrantExpired(expiry: number): boolean {
	if (!expiry) return false
	return expiry < Math.floor(Date.now() / 1000)
}

/** Parse `p 1sat collection <value>` style grant keys. */
function parseViewGrantKey(key: string): {
	scope?: string
	value?: string
} {
	const m =
		/^p\s+[a-z0-9]+\s+(all|collection|app|creator|id)(?:\s+(.+))?$/i.exec(
			key.trim(),
		)
	if (!m) return {}
	return {
		scope: m[1].toLowerCase(),
		...(m[2]?.trim() && { value: m[2].trim() }),
	}
}

/**
 * Attach scope/value and optional OrdFS display (name + image) for collection
 * (and similar) view grants. Never throws — enrichment is best-effort.
 */
async function enrichBasketAccessRequests(
	deps: BasketAccessDeps,
	grantKeys: string[],
): Promise<BasketAccessRequest[]> {
	const base: BasketAccessRequest[] = grantKeys.map((basket) => {
		const { scope, value } = parseViewGrantKey(basket)
		return {
			basket,
			scope,
			value,
			description:
				scope === 'collection' && value
					? 'View items in this collection'
					: scope === 'all'
						? 'View entire 1sat inventory'
						: scope
							? `View ${scope}-scoped items`
							: undefined,
		}
	})

	const collectionIds = base
		.filter((b) => b.scope === 'collection' && b.value)
		.map((b) => b.value as string)
	if (collectionIds.length === 0) return base

	const bulk = deps.services?.ordfs?.bulkMetadata
	const getContentUrl = deps.services?.ordfs?.getContentUrl
	if (typeof bulk !== 'function') return base

	try {
		const meta = await bulk.call(deps.services?.ordfs, collectionIds)
		for (const b of base) {
			if (b.scope !== 'collection' || !b.value) continue
			const m = meta[b.value] ?? meta[b.value.replace('_', '.')]
			if (!m) continue
			const name = nameFromMap(m.map as Record<string, unknown> | undefined)
			if (name) b.name = name
			const ct = m.contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
			if (ct.startsWith('image/') && typeof getContentUrl === 'function') {
				b.imageUrl = getContentUrl.call(deps.services?.ordfs, b.value)
			}
		}
	} catch {
		/* keep id-only rows */
	}
	return base
}

/**
 * listOutputs onRequest:
 * - `p <scheme> <scope>` → parse scope, view grant, normalize to storage
 * - collection/app/creator: force tagQueryMode `all`
 * - id: leave the caller's query mode
 * - plain owned storage basket → ordinary basket access
 */
export async function handleListOutputsRequest(
	deps: BasketAccessDeps,
	args: ListOutputsArgs,
	originator: string,
): Promise<ListOutputsArgs> {
	const raw = args.basket
	if (!raw || typeof raw !== 'string') return args

	const trimmed = raw.trim().toLowerCase()
	const pPrefix = `p ${deps.schemeId}`

	if (deps.ownedBaskets.has(trimmed)) {
		await ensureBasketAccess(deps, originator, [trimmed])
		return args
	}

	if (trimmed !== pPrefix && !trimmed.startsWith(`${pPrefix} `)) {
		return args
	}

	const parsed = parseViewBasket(deps.schemeId, raw)
	if (!parsed.ok) {
		throw new Error(`Permission module (${deps.schemeId}): ${parsed.error}`)
	}

	// Non-all scopes: values live in tags (may contain _ . : illegal in baskets)
	let axisValues: string[] = []
	if (parsed.axisPrefix) {
		axisValues = axisTagValues(args.tags, parsed.axisPrefix)
		if (axisValues.length === 0) {
			throw new Error(
				`Permission module (${deps.schemeId}): basket "${parsed.grantBasket}" requires at least one ${parsed.axisPrefix}* tag`,
			)
		}
	}

	// id lookup: targeted query — do not require standing all/collection grants
	if (!parsed.autoAllowView) {
		await ensureViewScopeAccess(
			deps,
			originator,
			parsed.grantBasket,
			axisValues,
		)
	}

	const next: ListOutputsArgs = {
		...args,
		basket: parsed.storageBasket,
	}

	if (parsed.axisPrefix && !parsed.autoAllowView) {
		next.tagQueryMode = 'all'
	}

	return next
}

/**
 * internalizeAction onRequest: gate basket access for insertion baskets.
 */
export async function handleInternalizeActionRequest(
	deps: BasketAccessDeps,
	args: InternalizeActionArgs,
	originator: string,
): Promise<InternalizeActionArgs> {
	const baskets: string[] = []
	for (const out of args.outputs ?? []) {
		if (
			out.protocol === 'basket insertion' &&
			out.insertionRemittance?.basket
		) {
			baskets.push(out.insertionRemittance.basket)
		}
	}
	await ensureBasketAccess(deps, originator, baskets)
	return args
}
