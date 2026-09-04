import type { WalletProtocol } from '@bsv/sdk'
import type {
	GroupedPermissions,
	PermissionRequest,
} from '@bsv/wallet-toolbox-client'
import type { PermissionKey } from './types.js'

/** Default ports stripped from normalized originators (mirrors WPM). */
const DEFAULT_PORTS: Record<string, string> = {
	'http:': '80',
	'https:': '443',
}

/**
 * Normalize an originator to the same canonical form WPM uses internally.
 *
 *  - Lowercase hostname
 *  - Strip default ports (80 for http, 443 for https)
 *  - Preserve non-default ports
 *  - Fall back to lowercase trim on URL-parse failure
 *
 * Kept in sync with `WalletPermissionsManager#normalizeOriginator`. See
 * `WPM-COUPLINGS.md` in this package for the fragility contract.
 */
export function normalizeOriginator(
	originator: string | undefined | null,
): string {
	if (!originator) return ''
	const trimmed = originator.trim()
	if (!trimmed) return ''
	try {
		const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
		const candidate = hasScheme ? trimmed : `https://${trimmed}`
		const url = new URL(candidate)
		if (!url.hostname) return trimmed.toLowerCase()
		const hostname = url.hostname.toLowerCase()
		const needsBrackets = hostname.includes(':')
		const baseHost = needsBrackets ? `[${hostname}]` : hostname
		const port = url.port
		const defaultPort = DEFAULT_PORTS[url.protocol]
		if (port && defaultPort && port === defaultPort) return baseHost
		return port ? `${baseHost}:${port}` : baseHost
	} catch {
		return trimmed.toLowerCase()
	}
}

/** Default the counterparty per WPM's convention (level-1 protocols always use `''`). */
function defaultCounterparty(
	protocolID: WalletProtocol,
	counterparty?: string,
): string {
	if (protocolID[0] === 1) return ''
	return counterparty ?? 'self'
}

/**
 * Build a normalized `PermissionKey` from a WPM `PermissionRequest`.
 *
 * Throws if the request is missing required fields for its type (this should
 * not happen in practice — WPM always populates these before firing callbacks).
 */
export function permissionKeyFromRequest(
	request: PermissionRequest,
): PermissionKey {
	const originator = normalizeOriginator(request.originator)
	switch (request.type) {
		case 'protocol': {
			if (!request.protocolID) {
				throw new Error('Protocol permission request missing protocolID')
			}
			return {
				type: 'protocol',
				originator,
				privileged: !!request.privileged,
				protocolLevel: request.protocolID[0] as 0 | 1 | 2,
				protocolName: request.protocolID[1],
				counterparty: defaultCounterparty(
					request.protocolID,
					request.counterparty,
				),
			}
		}
		case 'basket': {
			if (!request.basket) {
				throw new Error('Basket permission request missing basket')
			}
			return { type: 'basket', originator, basket: request.basket }
		}
		case 'certificate': {
			if (!request.certificate) {
				throw new Error(
					'Certificate permission request missing certificate details',
				)
			}
			return {
				type: 'certificate',
				originator,
				privileged: !!request.privileged,
				verifier: request.certificate.verifier,
				certType: request.certificate.certType,
				fields: [...request.certificate.fields].sort(),
			}
		}
		case 'spending':
			return { type: 'spending', originator }
	}
}

/**
 * Produce a canonical string representation of a `PermissionKey`.
 *
 * Suitable for use as a `Map` key or a storage index. Keys round-trip
 * through `permissionKeyToString` safely — two requests that share the same
 * normalized originator + parameters produce the same string.
 *
 * Certificate fields are sorted before joining so that field order does
 * not affect key identity.
 */
export function permissionKeyToString(key: PermissionKey): string {
	switch (key.type) {
		case 'protocol':
			return `proto:${key.originator}:${key.privileged}:${key.protocolLevel},${key.protocolName}:${key.counterparty}`
		case 'basket':
			return `basket:${key.originator}:${key.basket}`
		case 'certificate':
			return `cert:${key.originator}:${key.privileged}:${key.verifier}:${key.certType}:${[...key.fields].sort().join('|')}`
		case 'spending':
			return `spend:${key.originator}`
	}
}

/**
 * Build the list of `PermissionKey`s implied by a BRC-73 grouped-permission bundle.
 *
 * Used by the adapter to check whether every sub-permission in a grouped
 * request is already present in the store before deciding whether to prompt.
 *
 * Counterparty-less (`counterparty: ''`) protocol entries are skipped —
 * they belong to a separate counterparty-pact flow and should not be
 * matched as regular grants.
 */
export function permissionKeysFromGroup(
	originator: string,
	permissions: GroupedPermissions,
): PermissionKey[] {
	const normalized = normalizeOriginator(originator)
	const keys: PermissionKey[] = []

	if (permissions.spendingAuthorization) {
		keys.push({ type: 'spending', originator: normalized })
	}

	for (const p of permissions.protocolPermissions ?? []) {
		if (p.counterparty === '') continue
		const level = p.protocolID[0] as 0 | 1 | 2
		const counterparty = level === 1 ? '' : (p.counterparty ?? 'self')
		keys.push({
			type: 'protocol',
			originator: normalized,
			privileged: false,
			protocolLevel: level,
			protocolName: p.protocolID[1],
			counterparty,
		})
	}

	for (const b of permissions.basketAccess ?? []) {
		keys.push({ type: 'basket', originator: normalized, basket: b.basket })
	}

	for (const c of permissions.certificateAccess ?? []) {
		keys.push({
			type: 'certificate',
			originator: normalized,
			privileged: false,
			verifier: c.verifierPublicKey,
			certType: c.type,
			fields: [...c.fields].sort(),
		})
	}

	return keys
}

/** True if `expiry` (UNIX seconds, 0 = never) has passed. */
export function isExpired(expiry: number, now: number = Date.now()): boolean {
	if (!expiry) return false
	return expiry * 1000 < now
}

/**
 * Build a new `GroupedPermissions` bundle containing only the sub-permissions
 * whose canonical key string is present in `missingKeys`.
 *
 * Used by the adapter to trim an already-partially-granted bundle before
 * handing it to the consumer's prompt handler — the user should only see
 * permissions that still need approval, not ones they've already granted.
 */
export function filterGroupedByMissing(
	originator: string,
	permissions: GroupedPermissions,
	missingKeys: Set<string>,
): GroupedPermissions {
	const normalized = normalizeOriginator(originator)
	const out: GroupedPermissions = { description: permissions.description }

	if (permissions.spendingAuthorization) {
		const key = permissionKeyToString({
			type: 'spending',
			originator: normalized,
		})
		if (missingKeys.has(key)) {
			out.spendingAuthorization = permissions.spendingAuthorization
		}
	}

	const protocolPermissions: NonNullable<
		GroupedPermissions['protocolPermissions']
	> = []
	for (const p of permissions.protocolPermissions ?? []) {
		if (p.counterparty === '') continue
		const level = p.protocolID[0] as 0 | 1 | 2
		const counterparty = level === 1 ? '' : (p.counterparty ?? 'self')
		const key = permissionKeyToString({
			type: 'protocol',
			originator: normalized,
			privileged: false,
			protocolLevel: level,
			protocolName: p.protocolID[1],
			counterparty,
		})
		if (missingKeys.has(key)) protocolPermissions.push(p)
	}
	if (protocolPermissions.length > 0)
		out.protocolPermissions = protocolPermissions

	const basketAccess: NonNullable<GroupedPermissions['basketAccess']> = []
	for (const b of permissions.basketAccess ?? []) {
		const key = permissionKeyToString({
			type: 'basket',
			originator: normalized,
			basket: b.basket,
		})
		if (missingKeys.has(key)) basketAccess.push(b)
	}
	if (basketAccess.length > 0) out.basketAccess = basketAccess

	const certificateAccess: NonNullable<
		GroupedPermissions['certificateAccess']
	> = []
	for (const c of permissions.certificateAccess ?? []) {
		const key = permissionKeyToString({
			type: 'certificate',
			originator: normalized,
			privileged: false,
			verifier: c.verifierPublicKey,
			certType: c.type,
			fields: [...c.fields].sort(),
		})
		if (missingKeys.has(key)) certificateAccess.push(c)
	}
	if (certificateAccess.length > 0) out.certificateAccess = certificateAccess

	return out
}
