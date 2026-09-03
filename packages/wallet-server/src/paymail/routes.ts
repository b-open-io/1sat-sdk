/**
 * Mount bsvalias surface on the host app using @bsv/paymail PaymailRouter.
 * Public routes — no BRC-100 auth. Mounted before auth-scoped surfaces.
 */

import { OneSatServices } from '@1sat/client'
import {
	P2pPaymentDestinationRoute,
	PaymailClient,
	type PaymailRouteParams,
	PaymailRouter,
	PublicKeyInfrastructureRoute,
	PublicProfileRoute,
	ReceiveBeefTransactionRoute,
	ReceiveTransactionRoute,
	RequestSenderValidationCapability,
} from '@bsv/paymail'
import { Transaction, Utils } from '@bsv/sdk'
import type { Express, Request } from 'express'
import {
	createPaymentDestination,
	verifyPaymentOutputs,
} from './destination.js'
import { MessageBoxClient } from './messagebox.js'
import { resolvePaymailBind } from './resolve.js'
import { createAccountResolver } from './resolvers.js'
import type { PaymailDeps } from './types.js'

/**
 * Request bodies as each route hands them to its handler.
 *
 * `@bsv/paymail` types every `domainLogicHandler` body as `unknown` — one
 * signature serves all routes — and each route instead validates its own body
 * with Joi before dispatch, stripping unknown keys. These mirror those
 * schemas, so the shape is what the route guarantees rather than a guess.
 */
interface P2pDestinationBody {
	satoshis: number
}

interface PaymailMetadata {
	sender?: string
	pubkey?: string
	signature?: string
	note?: string | null
}

interface ReceiveBeefBody {
	beef: string
	reference: string
	metadata?: PaymailMetadata
}

interface ReceiveHexBody {
	hex: string
	reference: string
	metadata?: PaymailMetadata
}

class NotFoundError extends Error {
	constructor(message = 'paymail not found') {
		super(message)
		this.name = 'NotFoundError'
	}
}

export async function mountPaymailRoutes(
	app: Express,
	deps: PaymailDeps,
): Promise<void> {
	const services = new OneSatServices('main', deps.stackUrl)
	// Avatars resolve through the same ORDFS host used for name resolution;
	// content lives at /content, matching OrdfsClient.
	const ordfsBaseUrl = `${deps.stackUrl.replace(/\/$/, '')}/content`
	const messageBox =
		deps.messageboxUrl && deps.hostPrivateKey
			? MessageBoxClient.fromPrivateKey(deps.messageboxUrl, deps.hostPrivateKey)
			: null
	if (deps.messageboxUrl && !deps.hostPrivateKey) {
		console.warn(
			'[paymail] messageboxUrl set without hostPrivateKey — inbox delivery disabled',
		)
	}

	const accountResolver =
		deps.userDomain && deps.accountStore
			? createAccountResolver(deps.accountStore)
			: null
	if (deps.userDomain && !deps.accountStore) {
		console.warn(
			`[paymail] userDomain ${deps.userDomain} set without accountStore — resolving it via OpNS`,
		)
	}

	/**
	 * Alias → identity for one domain, then the account gate: whichever
	 * backend resolved it, the identity must hold an account on this host.
	 * The user domain is the accounts table itself, so its gate is implicit.
	 */
	async function resolveAndAuthorize(alias: string, domain: string) {
		try {
			const viaAccounts =
				accountResolver != null &&
				domain.toLowerCase() === deps.userDomain?.toLowerCase()
			if (viaAccounts) {
				const bind = await accountResolver.resolve(alias, domain)
				if (!bind) throw new NotFoundError()
				return bind
			}
			const bind = await resolvePaymailBind(services, alias)
			if (!bind) throw new NotFoundError()
			if (deps.accountStore) {
				const account = await deps.accountStore.getByIdentity(bind.identityKey)
				if (!account) {
					console.warn(
						`[paymail] ${alias}@${domain}: identity ${bind.identityKey} has no account on this host`,
					)
					throw new NotFoundError()
				}
			}
			return bind
		} catch (err) {
			if (err instanceof NotFoundError) throw err
			console.warn(
				`[paymail] ${alias}@${domain}: resolution failed: ${err instanceof Error ? err.message : String(err)}`,
			)
			throw new NotFoundError()
		}
	}

	const paymailClient = new PaymailClient()
	const paymailRoutes = [
		new PublicKeyInfrastructureRoute({
			domainLogicHandler: async (params: PaymailRouteParams) => {
				const { name, domain } =
					PublicKeyInfrastructureRoute.getNameAndDomain(params)
				const bind = await resolveAndAuthorize(name, domain)
				return {
					bsvalias: '1.0' as const,
					handle: `${name}@${domain}`,
					pubkey: bind.identityKey,
				}
			},
		}),
		new PublicProfileRoute({
			domainLogicHandler: async (params: PaymailRouteParams) => {
				const { name, domain } = PublicProfileRoute.getNameAndDomain(params)
				const bind = await resolveAndAuthorize(name, domain)
				return {
					// Presentation only — falls back to the resolved name, which
					// is the unique value for its backend.
					name: bind.profileName || name,
					avatar: bind.avatarOrigin
						? `${ordfsBaseUrl}/${bind.avatarOrigin}`
						: '',
				}
			},
		}),
		new P2pPaymentDestinationRoute({
			domainLogicHandler: async (params, rawBody) => {
				const body = rawBody as P2pDestinationBody
				const { name, domain } =
					P2pPaymentDestinationRoute.getNameAndDomain(params)
				const bind = await resolveAndAuthorize(name, domain)
				const pending = await createPaymentDestination(deps.pendingStore, {
					alias: name,
					domain,
					identityPubKey: bind.identityKey,
					satoshis: Number(body.satoshis ?? 0),
					ttlMs: deps.pendingTtlMs,
				})
				return {
					reference: pending.reference,
					outputs: [
						{ satoshis: pending.satoshis, script: pending.outputScript },
					],
				}
			},
		}),
		new ReceiveBeefTransactionRoute({
			verifySignature: false,
			paymailClient,
			domainLogicHandler: async (params, rawBody) => {
				const body = rawBody as ReceiveBeefBody
				// Senders post plain BEEF per BRC-70; fromBEEF accepts
				// V1, V2, and Atomic. Normalize to atomic for downstream
				// internalization by the recipient wallet.
				const tx = Transaction.fromBEEF(Utils.toArray(body.beef, 'hex'))
				return finishReceive(tx, tx.toAtomicBEEF(), body.reference)
			},
		}),
		new ReceiveTransactionRoute({
			verifySignature: false,
			paymailClient,
			domainLogicHandler: async (params, rawBody) => {
				const body = rawBody as ReceiveHexBody
				const tx = Transaction.fromHex(body.hex)
				await populateAncestors(tx)
				const beefBytes = tx.toAtomicBEEF()
				return finishReceive(tx, beefBytes, body.reference)
			},
		}),
	]

	const router = new PaymailRouter({
		baseUrl: deps.baseUrl,
		basePath: '/bsvalias',
		routes: paymailRoutes,
		errorHandler: (err, req, res, next) => {
			if (err instanceof NotFoundError) {
				console.warn(`[paymail] 404 ${req.method} ${req.path}: ${err.message}`)
				return res.status(404).json({ error: 'paymail not found' })
			}
			// Log here: PaymailRouter appends its own default error handler
			// after this one, so the error never reaches the app-level
			// terminal middleware.
			console.error(
				`[paymail] ${req.method} ${req.path} failed:`,
				err instanceof Error ? (err.stack ?? err.message) : err,
			)
			next(err)
		},
	})

	async function populateAncestors(tx: Transaction): Promise<void> {
		for (const input of tx.inputs) {
			if (input.sourceTransaction) continue
			const sourceTxid = input.sourceTXID
			if (!sourceTxid) throw new Error('input missing sourceTXID')
			const beefBytes = await services.beef.getBeef(sourceTxid)
			input.sourceTransaction = Transaction.fromBEEF(Array.from(beefBytes))
		}
	}

	async function finishReceive(
		tx: Transaction,
		beefBytes: number[],
		reference: string,
	): Promise<{ txid: string; note: string }> {
		const pending = await deps.pendingStore.get(reference)
		if (!pending) throw new NotFoundError('destination not found or expired')

		const scripts = tx.outputs.map((o) => o.lockingScript.toHex())
		const sats = tx.outputs.map((o) => o.satoshis ?? 0)
		const outputIndex = verifyPaymentOutputs(scripts, sats, pending)

		const status = await services.submitToStack(new Uint8Array(beefBytes))
		if (isRejected(status.txStatus)) {
			throw new Error('transaction rejected by network')
		}

		const txid = status.txid || tx.id('hex')
		pending.txid = txid
		await deps.pendingStore.update(pending)

		if (messageBox) {
			try {
				await messageBox.deliverPayment(
					Utils.toHex(beefBytes),
					outputIndex,
					pending,
				)
			} catch (err) {
				console.error('[paymail] messagebox delivery failed', err)
				throw new Error('failed to process payment')
			}
		}

		return { txid, note: 'Payment received' }
	}

	// One process answers several apex domains (e.g. 1sat.app + 1sat.name), so
	// the capability document must reflect the requested Host, not the single
	// baseUrl baked into the PaymailRouter's own well-known route. Registered
	// first, it shadows the router's.
	app.get('/.well-known/bsvalias', (req: Request, res) => {
		const origin = requestOrigin(req, deps.baseUrl)
		const capabilities: Record<string, string | boolean> = {}
		for (const route of paymailRoutes) {
			const endpoint = route
				.getEndpoint()
				.replaceAll(':paymail', '{alias}@{domain.tld}')
				.replaceAll(':pubkey', '{pubkey}')
			capabilities[route.getCode()] = joinUrl(origin, '/bsvalias', endpoint)
		}
		capabilities[RequestSenderValidationCapability.getCode()] = false
		res.type('application/json').send({ bsvalias: '1.0', capabilities })
	})

	app.use(router.getRouter())
}

function requestOrigin(req: Request, fallback: string): string {
	const header = (value: string | string[] | undefined): string | undefined =>
		Array.isArray(value) ? value[0] : value
	const host = header(req.headers['x-forwarded-host']) || req.headers.host
	if (!host) return fallback
	const fwdProto = header(req.headers['x-forwarded-proto'])
	const proto = fwdProto
		? fwdProto.split(',')[0]?.trim() || 'https'
		: (req.socket as { encrypted?: boolean }).encrypted
			? 'https'
			: 'http'
	return `${proto}://${host}`
}

function joinUrl(...parts: string[]): string {
	return parts
		.map((p, i) =>
			i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, ''),
		)
		.filter((p) => p !== '')
		.join('/')
}

function isRejected(txStatus: string | undefined): boolean {
	return ['REJECTED', 'INVALID', 'DOUBLE_SPEND_ATTEMPTED'].includes(
		txStatus?.toUpperCase?.() ?? '',
	)
}
