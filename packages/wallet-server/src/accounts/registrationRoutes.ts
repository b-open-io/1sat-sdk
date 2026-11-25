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

import { OneSatServices } from '@1sat/client'
import { isValidOutpoint, normalizeOutpoint } from '@1sat/types'
import type { PrivateKey } from '@bsv/sdk'
import type { Express, Request, Response } from 'express'
import { resolvePaymailBind } from '../paymail/resolve.js'
import type { HandleCertStore } from './certs.js'
import { toDirectAcquireArgs } from './certs.js'
import {
	DISABLED_REVOCATION_OUTPOINT,
	HandleCertConflictError,
	ensureUserDomainCert,
	issueHandleCert,
} from './issueCert.js'
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

export interface RegistrationCertDeps {
	store: HandleCertStore
	hostPrivateKey: PrivateKey
	userDomain?: string
	stackUrl: string
}

export interface RegistrationRouteDeps {
	store: AccountStore
	certs?: RegistrationCertDeps
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

/**
 * Registration facet of /account/status.
 *
 * With `issuer`, an account registered before its certificate could be
 * issued (the host ran without a user domain) gets it here, so the name
 * becomes payable and listed without registering again.
 */
export async function registrationStatus(
	store: AccountStore | undefined,
	identityKey: string,
	certs?: HandleCertStore,
	issuer?: RegistrationCertDeps,
): Promise<RegistrationStatus> {
	if (!store) return { registrationEnabled: false }
	const account = await store.getByIdentity(identityKey)
	const userDomain = issuer?.userDomain
	if (account && issuer && userDomain) {
		try {
			await ensureUserDomainCert(
				issuer,
				userDomain,
				identityKey,
				account.username,
			)
		} catch (err) {
			console.error(
				`[accounts] ${account.username}@${userDomain}: could not issue the missing handle certificate: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}
	const handles = certs
		? (await certs.listBySubject(identityKey)).map((c) => ({
				handle: c.handle,
				domain: c.domain,
				revocationOutpoint: c.revocationOutpoint,
			}))
		: undefined
	return {
		registrationEnabled: true,
		account: account ? accountView(account) : null,
		...(handles && { handles }),
	}
}

/**
 * Message for a host that issues handle certs but has no user domain to
 * issue them on. Registering there would claim a name nobody can pay.
 */
export const NO_USER_DOMAIN_ERROR =
	'handle registration is unavailable: this host has no paymail user domain (server.paymail.userDomain)'

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
			const certs = deps.certs
			if (certs && !certs.userDomain) {
				// Never claim a name the host can't certify: it would be
				// permanently reserved yet unpayable.
				console.error(
					`[accounts] refused to register ${username}: no user domain`,
				)
				return res.status(503).json({ error: NO_USER_DOMAIN_ERROR })
			}
			if (certs?.userDomain) {
				// Don't claim a name whose cert this host would have to replace.
				const held = await certs.store.get(username, certs.userDomain)
				if (
					held &&
					(held.subject !== identityKey ||
						held.revocationOutpoint !== DISABLED_REVOCATION_OUTPOINT)
				) {
					const conflict = new HandleCertConflictError(
						username,
						certs.userDomain,
					)
					console.error(`[accounts] ${conflict.message}`)
					return res.status(409).json({ error: conflict.message })
				}
			}

			try {
				const account = await deps.store.register(
					identityKey,
					username,
					parsed.profile,
				)
				const certificate = certs?.userDomain
					? toDirectAcquireArgs(
							await ensureUserDomainCert(
								certs,
								certs.userDomain,
								identityKey,
								account.username,
							),
						)
					: undefined
				return res.json({
					identityKey,
					...accountView(account),
					...(certificate && { certificate }),
				})
			} catch (err) {
				if (err instanceof UsernameTakenError) {
					return res.status(409).json({ error: err.message })
				}
				if (err instanceof AlreadyRegisteredError) {
					return res.status(409).json({ error: err.message })
				}
				if (err instanceof HandleCertConflictError) {
					console.error(`[accounts] ${err.message}`)
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

	app.post(
		`${root}/account/certify`,
		async (req: AuthedRequest, res: Response) => {
			const identityKey = req.auth?.identityKey
			if (!identityKey || identityKey === 'unknown') {
				return res.status(401).json({ error: 'unauthenticated' })
			}
			if (!deps.certs) {
				return res.status(404).json({ error: 'certify is not enabled' })
			}
			const account = await deps.store.getByIdentity(identityKey)
			if (!account) {
				return res.status(403).json({ error: 'account required' })
			}

			const body = req.body as Record<string, unknown> | undefined
			const name = normalizeAlias(body?.name)
			const domain = normalizeDomain(body?.domain)
			const outpoint = outpointFromBody(body?.outpoint)
			if (!name || !domain || !outpoint) {
				return res.status(400).json({
					error: 'name, domain, and outpoint are required',
				})
			}
			if (
				deps.certs.userDomain &&
				domain === deps.certs.userDomain.toLowerCase()
			) {
				return res.status(400).json({
					error: 'use /account/register for this domain',
				})
			}

			try {
				const services = new OneSatServices('main', deps.certs.stackUrl)
				const bind = await resolvePaymailBind(services, name)
				if (bind.identityKey !== identityKey) {
					return res.status(403).json({ error: 'bind is not this identity' })
				}
				if (normalizeOutpoint(bind.outpoint) !== outpoint) {
					return res
						.status(400)
						.json({ error: 'outpoint is not the current tip' })
				}
				const issued = await issueHandleCert({
					store: deps.certs.store,
					hostPrivateKey: deps.certs.hostPrivateKey,
					subject: identityKey,
					handle: name,
					domain,
					revocationOutpoint: outpoint,
				})
				return res.json({
					handle: name,
					domain,
					revocationOutpoint: outpoint,
					certificate: toDirectAcquireArgs(issued),
				})
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				return res.status(400).json({ error: message })
			}
		},
	)
}

function normalizeAlias(input: unknown): string | null {
	if (typeof input !== 'string') return null
	const name = input.trim().toLowerCase()
	return name.length > 0 ? name : null
}

function normalizeDomain(input: unknown): string | null {
	if (typeof input !== 'string') return null
	const domain = input.trim().toLowerCase()
	if (!domain.includes('.') || domain.includes('@')) return null
	return domain
}

function outpointFromBody(input: unknown): string | null {
	if (typeof input !== 'string' || !isValidOutpoint(input.trim())) return null
	return normalizeOutpoint(input)
}
