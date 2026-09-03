/**
 * Account registration on the host.
 *
 * POST {base}/account/register  — claim a username (+ optional profile)
 * PUT  {base}/account/profile   — edit display name / avatar
 *
 * Both sit under the /account auth scope the caller has already applied;
 * this module only reads `req.auth.identityKey`. Registration is free and
 * permanent (see ./store.ts).
 */

import type { Express, Request, Response } from 'express'
import {
	type Account,
	type AccountProfile,
	type AccountStore,
	AlreadyRegisteredError,
	NotRegisteredError,
	UsernameTakenError,
	normalizeAvatarOrigin,
	normalizeDisplayName,
	normalizeUsername,
} from './store.js'
import type { RegistrationStatus } from './types.js'

type AuthedRequest = Request & { auth?: { identityKey?: string } }

export interface RegistrationRouteDeps {
	store: AccountStore
}

/** Wire shape of an account on status / register / profile responses. */
export interface AccountView {
	username: string
	displayName?: string
	avatarOrigin?: string
	createdAt: string
}

export function accountView(a: Account): AccountView {
	return {
		username: a.username,
		...(a.displayName && { displayName: a.displayName }),
		...(a.avatarOrigin && { avatarOrigin: a.avatarOrigin }),
		createdAt: a.createdAt.toISOString(),
	}
}

/** Registration facet of /account/status. */
export async function registrationStatus(
	store: AccountStore | undefined,
	identityKey: string,
): Promise<RegistrationStatus> {
	if (!store) return { registrationEnabled: false }
	const account = await store.getByIdentity(identityKey)
	return {
		registrationEnabled: true,
		account: account ? accountView(account) : null,
	}
}

export const USERNAME_RULES =
	'lowercase letters, digits, hyphens; 3-63 chars, no leading/trailing hyphen'

/**
 * Parse profile fields off a request body. Returns an error string for the
 * first invalid field; absent fields are left undefined (unchanged).
 */
function parseProfile(
	body: Record<string, unknown> | undefined,
): { profile: AccountProfile } | { error: string } {
	const profile: AccountProfile = {}
	if (body && 'displayName' in body) {
		const v = normalizeDisplayName(body.displayName)
		if (v === undefined) {
			return { error: 'invalid displayName: string of at most 64 chars' }
		}
		profile.displayName = v
	}
	if (body && 'avatarOrigin' in body) {
		const v = normalizeAvatarOrigin(body.avatarOrigin)
		if (v === undefined) {
			return { error: 'invalid avatarOrigin: expected txid_vout of an ordinal' }
		}
		profile.avatarOrigin = v
	}
	return { profile }
}

export function mountRegistrationRoutes(
	app: Express,
	basePath: string,
	deps: RegistrationRouteDeps,
): void {
	const root = basePath === '/' ? '' : basePath.replace(/\/$/, '')

	app.post(
		`${root}/account/register`,
		async (req: AuthedRequest, res: Response) => {
			const identityKey = req.auth?.identityKey
			if (!identityKey || identityKey === 'unknown') {
				return res.status(401).json({ error: 'unauthenticated' })
			}
			const body = req.body as Record<string, unknown> | undefined
			const username = normalizeUsername(body?.username)
			if (!username) {
				return res
					.status(400)
					.json({ error: `invalid username: ${USERNAME_RULES}` })
			}
			const parsed = parseProfile(body)
			if ('error' in parsed)
				return res.status(400).json({ error: parsed.error })

			try {
				const account = await deps.store.register(
					identityKey,
					username,
					parsed.profile,
				)
				return res.json({ identityKey, ...accountView(account) })
			} catch (err) {
				if (err instanceof UsernameTakenError) {
					return res.status(409).json({ error: err.message })
				}
				if (err instanceof AlreadyRegisteredError) {
					return res.status(409).json({ error: err.message })
				}
				throw err
			}
		},
	)

	app.put(
		`${root}/account/profile`,
		async (req: AuthedRequest, res: Response) => {
			const identityKey = req.auth?.identityKey
			if (!identityKey || identityKey === 'unknown') {
				return res.status(401).json({ error: 'unauthenticated' })
			}
			const parsed = parseProfile(
				req.body as Record<string, unknown> | undefined,
			)
			if ('error' in parsed)
				return res.status(400).json({ error: parsed.error })

			try {
				const account = await deps.store.updateProfile(
					identityKey,
					parsed.profile,
				)
				return res.json({ identityKey, ...accountView(account) })
			} catch (err) {
				if (err instanceof NotRegisteredError) {
					return res.status(404).json({ error: err.message })
				}
				throw err
			}
		},
	)
}
