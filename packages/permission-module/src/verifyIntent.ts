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
	/** Content length in bytes confirmed by ORDFS, when it answered. */
	contentLength?: number
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

	// `:-2` resolves the outpoint to its origin before returning metadata.
	// Querying the raw outpoint is wrong for anything already moved or listed —
	// an OrdLock output carries no inscription, so ORDFS answers with an empty
	// record rather than the asset.
	const key = `${origin}:-2`
	// Called on the client, not detached — these are class methods that use `this`.
	const res = await withTimeout(ordfs.bulkMetadata([key]))
	const meta = res?.[key] ?? res?.[origin]

	// An empty record means "nothing inscribed here", not a description of the
	// asset — treat it as no answer rather than as evidence.
	if (!meta?.contentType) return { state: 'unverified' }

	const resolved = {
		contentType: meta.contentType,
		contentLength: meta.contentLength,
		// ORDFS resolves the true genesis; the tagged value is usually the
		// seller's listing outpoint. Not treated as a mismatch — the claimed
		// value is an outpoint by construction, not a competing assertion.
		origin: meta.origin,
		name:
			typeof meta.map?.name === 'string'
				? (meta.map.name as string)
				: undefined,
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
	if (typeof bsv21?.getTokenDetails !== 'function')
		return { state: 'unverified' }

	const res = await withTimeout(bsv21.getTokenDetails(tokenId))
	if (!res) return { state: 'unverified' }

	if (res.status?.is_active === false) {
		return { state: 'mismatch', note: 'Token is not active on the overlay' }
	}
	const sym = res.token?.sym
	if (claimedSym && sym && claimedSym !== sym) {
		return {
			state: 'mismatch',
			note: `Token symbol is ${sym}, not ${claimedSym}`,
		}
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
	p1satIntent: string | undefined,
	inputs: EnrichedAsset[],
	outputs: EnrichedOutput[],
	contentUrlForOrigin?: (origin: string) => string,
): Promise<VerificationResult> {
	if (!services || !p1satIntent) return { state: 'unverified' }

	try {
		const allTags = [
			...inputs.map((i) => i.tags),
			...outputs.map((o) => o.tags),
		]
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

		switch (p1satIntent) {
			case 'ordinal.purchase': {
				const origin = find('origin')
				if (!origin) return { state: 'unverified' }
				const res = await verifyOrdinal(services, origin, findAll('type'))
				// Preview URL follows the *resolved* origin, not the tagged one —
				// a listing outpoint has no content to serve.
				return res.origin && contentUrlForOrigin
					? { ...res, contentUrl: contentUrlForOrigin(res.origin) }
					: res
			}
			case 'opns.purchase': {
				const name = find('name')
				const origin = find('origin')
				if (!name || !origin) return { state: 'unverified' }
				return await verifyOpns(services, name, origin)
			}
			case 'bsv21.purchase': {
				const tokenId = find('bsv21')
				if (!tokenId) return { state: 'unverified' }
				return await verifyBsv21(services, tokenId, find('sym'))
			}
			default:
				return { state: 'unverified' }
		}
	} catch {
		return { state: 'unverified' }
	}
}
