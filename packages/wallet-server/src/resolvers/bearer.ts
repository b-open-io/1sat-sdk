import type { IdentityResolver } from '../types'

export interface BearerResolverConfig {
	/** Shared secret the caller must present. */
	token: string
	/** Header name carrying the authenticated identity pubkey. Defaults to `X-Identity-Key`. */
	identityHeader?: string
}

export function bearerResolver(config: BearerResolverConfig): IdentityResolver {
	if (!config.token) {
		throw new Error('bearerResolver requires a non-empty token')
	}
	const identityHeader = (
		config.identityHeader ?? 'X-Identity-Key'
	).toLowerCase()

	return async (req: Request) => {
		const auth = req.headers.get('authorization') ?? ''
		const [scheme, value] = auth.split(/\s+/, 2)
		if (scheme?.toLowerCase() !== 'bearer' || !value) {
			throw new BearerAuthError('missing bearer token')
		}
		if (!timingSafeEqual(value, config.token)) {
			throw new BearerAuthError('invalid bearer token')
		}

		const identityKey = req.headers.get(identityHeader)
		if (!identityKey) {
			throw new BearerAuthError(`missing ${identityHeader} header`)
		}
		if (!isHexPubKey(identityKey)) {
			throw new BearerAuthError(`invalid ${identityHeader} header`)
		}

		return { identityKey }
	}
}

export class BearerAuthError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'BearerAuthError'
	}
}

function isHexPubKey(value: string): boolean {
	return /^[0-9a-fA-F]{66}$/.test(value)
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
	}
	return diff === 0
}
