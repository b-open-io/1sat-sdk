import type { EnrichedAsset, EnrichedOutput, TrustState } from './enrichIntent'
import type { VerificationServices } from './types'

/** How long any single verification lookup may take before it is abandoned. */
export const VERIFICATION_TIMEOUT_MS = 2000

export interface VerificationResult {
	state: TrustState
	/** Shown alongside a `mismatch`, describing what actually differs. */
	note?: string
	/** Content type confirmed by ORDFS, when it answered. */
	contentType?: string
	/**
	 * True origin as resolved by ORDFS.
	 *
	 * Distinct from whatever was tagged: for a listing the tagged value is the
	 * seller's OrdLock outpoint, not the asset's genesis. Prefer this on the
	 * card when present.
	 */
	origin?: string
	/** Asset name from the inscription's MAP data, when present. */
	name?: string
	/** Content URL for the resolved origin, so the card can show a preview. */
	contentUrl?: string
}

/**
 * Resolve `promise` or give up after `ms`. Never rejects — verification must
 * not be able to break a prompt.
 */
async function withTimeout<T>(
	promise: Promise<T>,
	ms = VERIFICATION_TIMEOUT_MS,
): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise.catch(() => undefined),
			new Promise<undefined>((resolve) => {
				timer = setTimeout(() => resolve(undefined), ms)
			}),
		])
	} catch {
		return undefined
	} finally {
		if (timer) clearTimeout(timer)
	}
}

function tagValue(tags: string[] | undefined, key: string): string | undefined {
	return tags?.find((t) => t.startsWith(`${key}:`))?.slice(key.length + 1)
}

/**
 * Verify an ordinal against ORDFS by origin.
 *
 * A record that disagrees is a mismatch. **No record is `unverified`, never a
 * mismatch** — we cannot tell "wrong" from "the overlay has not indexed it
 * yet", and a backlog is normal.
 */
async function verifyOrdinal(
	services: VerificationServices,
	origin: string,
	claimedTypes: string[] = [],
): Promise<VerificationResult> {
	const ordfs = services.ordfs
	if (typeof ordfs?.bulkMetadata !== 'function') return { state: 'unverified' }

	// `:-2` is only an ORDFS request suffix (resolve tip → origin metadata).
	// It is not part of asset identity and must not be required to match
	// response map keys beyond looking up the bulk result.
	const key = `${origin}:-2`
	const res = await withTimeout(ordfs.bulkMetadata([key]))
	// Prefer exact key, then bare origin, then any record that carried content.
	const meta =
		res?.[key] ??
		res?.[origin] ??
		Object.values(res ?? {}).find(
			(m): m is NonNullable<typeof m> => !!m?.contentType,
		)

	// An empty record means "nothing inscribed here", not a description of the
	// asset — treat it as no answer rather than as evidence.
	if (!meta?.contentType) return { state: 'unverified' }

	const resolved = {
		contentType: meta.contentType,
		// ORDFS resolves the true genesis; the tagged value is usually the
		// seller's listing outpoint. Not treated as a mismatch — the claimed
		// value is an outpoint by construction, not a competing assertion.
		origin: meta.origin,
		name:
			typeof meta.map?.name === 'string' ? (meta.map.name as string) : undefined,
	}

	// `type:` is hierarchical — `image` and `image/png` both describe the same
	// asset. Only a *specific* claim can contradict, and only against the base
	// type; a category-only claim can never disagree.
	const specific = claimedTypes.find((t) => t.includes('/'))
	if (specific && specific !== meta.contentType) {
		return {
			state: 'mismatch',
			note: `Content type is ${meta.contentType}, not ${specific}`,
			...resolved,
		}
	}

	return { state: 'verified', ...resolved }
}

/** Verify that an OpNS name still resolves to the origin being acquired. */
async function verifyOpns(
	services: VerificationServices,
	name: string,
	origin: string,
): Promise<VerificationResult> {
	const opns = services.opns
	if (typeof opns?.getOrigin !== 'function') return { state: 'unverified' }

	const res = await withTimeout(opns.getOrigin(name))
	if (!res?.outpoint) return { state: 'unverified' }

	if (res.outpoint !== origin) {
		return {
			state: 'mismatch',
			note: `“${name}” currently resolves to a different output`,
		}
	}
	return { state: 'verified' }
}

/** Verify a BSV21 token is active on the overlay. */
async function verifyBsv21(
	services: VerificationServices,
	tokenId: string,
	claimedSym?: string,
): Promise<VerificationResult> {
	const bsv21 = services.bsv21
	if (typeof bsv21?.getTokenDetails !== 'function') return { state: 'unverified' }

	const res = await withTimeout(bsv21.getTokenDetails(tokenId))
	if (!res) return { state: 'unverified' }

	if (res.status?.is_active === false) {
		return { state: 'mismatch', note: 'Token is not active on the overlay' }
	}
	const sym = res.token?.sym
	if (claimedSym && sym && claimedSym !== sym) {
		return { state: 'mismatch', note: `Token symbol is ${sym}, not ${claimedSym}` }
	}
	return { state: 'verified' }
}

/**
 * Verify the assets on a purchase intent.
 *
 * Returns `unverified` for anything we cannot positively confirm, including
 * when no services are wired at all. Never throws.
 */
export async function verifyIntent(
	services: VerificationServices | undefined,
	/** Prompt kind from script/heuristic classify, or legacy intent id. */
	kindOrIntent: string | undefined,
	inputs: EnrichedAsset[],
	outputs: EnrichedOutput[],
	contentUrlForOrigin?: (origin: string) => string,
): Promise<VerificationResult> {
	if (!services || !kindOrIntent) return { state: 'unverified' }

	const isPurchase =
		kindOrIntent === 'purchase' || kindOrIntent.endsWith('.purchase')
	if (!isPurchase) return { state: 'unverified' }

	const debug: Record<string, unknown> = {
		kindOrIntent,
		hasOrdfs: !!services.ordfs,
		hasBulk: typeof services.ordfs?.bulkMetadata === 'function',
		inputTagSets: inputs.map((i) => i.tags),
		outputTagSets: outputs.map((o) => o.tags),
	}

	try {
		const allTags = [...inputs.map((i) => i.tags), ...outputs.map((o) => o.tags)]
		const findAll = (key: string) =>
			allTags.flatMap((tags) =>
				tags
					.filter((t) => t.startsWith(`${key}:`))
					.map((t) => t.slice(key.length + 1)),
			)
		const find = (key: string) => {
			for (const tags of allTags) {
				const v = tagValue(tags, key)
				if (v) return v
			}
			return undefined
		}

		// Prefer tag-driven path (script classify only sets kind: 'purchase').
		const tokenId = find('bsv21')
		if (tokenId || kindOrIntent === 'bsv21.purchase') {
			if (!tokenId) return { state: 'unverified' }
			return await verifyBsv21(services, tokenId, find('sym'))
		}

		const name = find('name')
		const origin = find('origin')
		debug.name = name
		debug.origin = origin
		if (
			(name && origin && outputs.some((o) => o.basket?.includes('opns'))) ||
			kindOrIntent === 'opns.purchase'
		) {
			if (!name || !origin) return { state: 'unverified' }
			return await verifyOpns(services, name, origin)
		}

		if (!origin) {
			debug.reason = 'no-origin-tag'
			;(
				globalThis as unknown as { __lastVerify?: unknown }
			).__lastVerify = debug
			return { state: 'unverified' }
		}
		const res = await verifyOrdinal(services, origin, findAll('type'))
		debug.verifyOrdinal = res
		// contentUrl is optional polish — never let a URL helper wipe a verified result
		// (e.g. unbound getContentUrl losing `this` and throwing).
		if (res.origin && contentUrlForOrigin) {
			try {
				res.contentUrl = contentUrlForOrigin(res.origin)
			} catch (e) {
				debug.contentUrlError = String(e)
			}
		}
		;(
			globalThis as unknown as { __lastVerify?: unknown }
		).__lastVerify = debug
		return res
	} catch (e) {
		debug.error = String(e)
		;(globalThis as unknown as { __lastVerify?: unknown }).__lastVerify =
			debug
		return { state: 'unverified' }
	}
}
