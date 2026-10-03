/**
 * BRC-169 handle resolution client (§5.1, §5.2, §5.7).
 *
 * Resolves `@handle@domain` / `handle@domain` to the handle's identity key and
 * messagebox: fetch `https://<domain>/manifest.json`, read
 * `metanet.handles.resolve`, then `GET <resolve>?handle=<handle>`.
 *
 * Out of scope here (§5.7 steps 5–6): verifying the BRC-52 certificate
 * signature against the domain's certifier key, the revocation-outpoint check
 * of §4.2, and the key-change check of §4.4. The only certificate check made
 * is that `certificate.subject` equals `identityKey` (§5.2). Aliases (§5.5)
 * and same-ecosystem shorthand (§2.2) are not resolved.
 */

import { HttpError } from './errors.js'

/** The BRC-52 handle certificate, as returned by the resolution endpoint. */
export interface HandleCertificate {
	subject: string
	[field: string]: unknown
}

/** A §5.2 resolution response, plus the `+tag` stripped from the input. */
export interface HandleResolution {
	metanetHandles: string
	handle: string
	domain: string
	/** 66-char compressed secp256k1 public key, hex */
	identityKey: string
	certificate: HandleCertificate
	/** HTTPS URL of the handle's messagebox */
	messagebox: string
	/** Seconds the response may be cached */
	ttl: number
	revoked: boolean
	/** The `+tag` from the input, kept for the envelope's `recipient.tag` (§3.1) */
	tag?: string
}

export interface ResolveHandleOptions {
	/** fetch implementation (defaults to the global fetch) */
	fetch?: typeof fetch
}

/** Default resolution path when `metanet.handles.resolve` is absent (§5.1) */
export const DEFAULT_HANDLE_RESOLVE_PATH =
	'/.well-known/metanet-handles/resolve'

/**
 * Split a recipient into normalized handle, tag and domain: lowercase,
 * paymail-style input accepted, leading `@` optional, `+tag` stripped.
 */
export function parseHandle(recipient: string): {
	handle: string
	tag?: string
	domain: string
} {
	const normalized = recipient.trim().toLowerCase().replace(/^@/, '')
	const at = normalized.indexOf('@')
	if (at < 0) {
		throw new Error(`handle has no domain: ${recipient}`)
	}
	const local = normalized.slice(0, at)
	const domain = normalized.slice(at + 1)
	if (!domain.includes('.')) {
		// §2.1 rule 5: a dotless ecosystem is an alias, never a hostname.
		throw new Error(`ecosystem aliases are not supported: ${domain}`)
	}
	const plus = local.indexOf('+')
	if (plus < 0) return { handle: local, domain }
	return {
		handle: local.slice(0, plus),
		tag: local.slice(plus + 1),
		domain,
	}
}

/**
 * Resolve a BRC-169 handle to its identity key, certificate and messagebox.
 *
 * @throws when the domain does not offer handle resolution, an endpoint
 * answers with an error status, or `certificate.subject !== identityKey`.
 */
export async function resolveHandle(
	recipient: string,
	options: ResolveHandleOptions = {},
): Promise<HandleResolution> {
	const doFetch = options.fetch ?? fetch
	const { handle, tag, domain } = parseHandle(recipient)

	const manifestRes = await doFetch(`https://${domain}/manifest.json`)
	if (!manifestRes.ok) {
		throw new HttpError(
			manifestRes.status,
			`manifest fetch failed for ${domain}: ${manifestRes.status}`,
		)
	}
	const manifest = (await manifestRes.json()) as {
		metanet?: { handles?: { version?: string; resolve?: string } }
	}
	const handles = manifest.metanet?.handles
	if (!handles) {
		// §5.1: a trust anchor without metanet.handles offers no resolution.
		throw new Error(`${domain} does not offer handle resolution`)
	}
	if (handles.version?.split('.')[0] !== '1') {
		// §5.7 step 3: reject unsupported major versions.
		throw new Error(
			`${domain} metanet.handles version ${handles.version} is not supported`,
		)
	}

	const resolveUrl =
		handles.resolve ?? `https://${domain}${DEFAULT_HANDLE_RESOLVE_PATH}`
	const res = await doFetch(
		`${resolveUrl}?handle=${encodeURIComponent(handle)}`,
	)
	if (!res.ok) {
		let code = ''
		try {
			const body = (await res.json()) as { error?: { code?: string } }
			code = body.error?.code ?? ''
		} catch {
			// error body is optional to read
		}
		throw new HttpError(
			res.status,
			`resolve ${handle}@${domain} failed: ${res.status}${code ? ` ${code}` : ''}`,
		)
	}
	const resolution = (await res.json()) as HandleResolution
	if (resolution.certificate?.subject !== resolution.identityKey) {
		throw new Error(
			`certificate subject does not match identity key for ${handle}@${domain}`,
		)
	}
	return tag === undefined ? resolution : { ...resolution, tag }
}
