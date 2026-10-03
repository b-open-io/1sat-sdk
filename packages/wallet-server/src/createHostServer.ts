/**
 * Unified host server: accounts + paymail + messagebox in one process with
 * one host identity. Wallet storage RPC is a separate process
 * (`createStorageServer`).
 *
 * Auth zoning:
 * - public: paymail bsvalias, OpenAPI docs
 * - BRC-100: /account/*, messagebox
 */

import type { Server } from 'node:http'
import { createServer } from 'node:http'
import {
	type MessageBoxContext,
	attachMessageBoxWebSockets,
	createMessageBoxContext,
	registerMessageBoxPostAuthRoutes,
	registerMessageBoxPreAuthRoutes,
} from '@bopen-io/messagebox-server'
import type { WalletInterface } from '@bsv/sdk'
import { createLogger } from 'evlog'
import { evlog } from 'evlog/express'
import express, {
	type Express,
	type NextFunction,
	type Request,
	type Response,
	Router,
} from 'express'
import {
	type WalletServerAccounts,
	mountPaymentRoute,
	mountRegistrationRoutes,
} from './accounts/index.js'
import { mountStatusRoute } from './accounts/statusRoute.js'
import type { AccountStore } from './accounts/store.js'
import { mountTerminalErrorHandler } from './errorHandler.js'
import { mountOpenApiRoutes } from './openapi/index.js'
import { mountPaymailRoutes } from './paymail/routes.js'
import type { PaymailDeps } from './paymail/types.js'
import { buildAuthMiddleware } from './sessions/redisSessionManager.js'
import type { WalletStorageProvider } from './types.js'

export interface HostServerMessageboxConfig {
	/** Knex instance for message tables */
	knex: MessageBoxContext['knex']
	/** Enable authenticated WebSocket delivery. Default true. */
	websockets?: boolean
}

export interface HostServerConfig {
	wallet: WalletInterface
	/** Wallet storage the account routes meter usage against. */
	storage: WalletStorageProvider
	serverIdentityKey: string
	listen: { port: number; host?: string }
	accounts?: WalletServerAccounts
	/**
	 * Host account registry. Enables POST /account/register and
	 * PUT /account/profile, reports the account on GET /account/status, and
	 * gates messagebox delivery on the recipient holding an account. Pass the
	 * same store as `paymail.accountStore` so paymail resolution is gated the
	 * same way.
	 */
	accountStore?: AccountStore
	handleCertStore?: import('./accounts/certs.js').HandleCertStore
	paymail?: PaymailDeps
	messagebox?: HostServerMessageboxConfig
	/**
	 * Redis-shared BRC-104 sessions for multi-instance deployments behind a
	 * load balancer. Unset = in-memory sessions (single instance).
	 */
	sessionStore?: { redisUrl: string; ttlSeconds?: number }
	bodyLimit?: string
	/** Last BSV/USD quote. Unset = GET /exchange-rate 404s. */
	getExchangeRate?: () => {
		bsvUsd: number
		timestamp: number
		source: string
	} | null
}

export interface HostServerHandle {
	app: Express
	port: number
	start(): Promise<number>
	stop(): Promise<void>
}

export async function createHostServer(
	config: HostServerConfig,
): Promise<HostServerHandle> {
	const app = express()
	app.use(evlog())
	app.use(express.json({ limit: config.bodyLimit ?? '30mb' }))
	app.use(corsMiddleware)

	const { wallet } = config
	// One authMiddleware instance for every authed surface (account,
	// messagebox), so a single /.well-known/auth handshake authenticates a
	// client everywhere. With a session store, sessions live in Redis, so any
	// instance — including a storage server sharing the store — can validate
	// any session.
	const authMiddleware = buildAuthMiddleware(wallet, config.sessionStore)

	// --- public surface -------------------------------------------------------
	if (config.paymail) {
		await mountPaymailRoutes(app, config.paymail)
	}
	app.get('/exchange-rate', (_req, res) => {
		const quote = config.getExchangeRate?.() ?? null
		if (!quote) {
			return res.status(404).json({ error: 'no exchange rate' })
		}
		res.json(quote)
	})
	mountOpenApiRoutes(app, {
		serverIdentityKey: config.serverIdentityKey,
		surfaces: {
			accounts: config.accounts != null,
			registration: config.accountStore != null,
			paymail: config.paymail != null,
			messagebox: config.messagebox != null,
		},
	})

	// --- auth surface ----------------------------------------------------------
	// BRC-104 handshake endpoint. The middleware keys on
	// `req.path === '/.well-known/auth'`, so mount it route-level — an
	// `app.use('/.well-known/auth', …)` would strip the path and break the
	// check.
	app.post('/.well-known/auth', authMiddleware)

	// Account routes need auth; scope it to /account/*
	app.use('/account', authMiddleware)
	mountStatusRoute(app, {
		storage: config.storage,
		serverIdentityKey: config.serverIdentityKey,
		wallet,
		accounts: config.accounts,
		accountStore: config.accountStore,
		handleCertStore: config.handleCertStore,
	})
	if (config.accounts) {
		mountPaymentRoute(app, '/', {
			getConfig: config.accounts.getConfig,
			wallet,
			walletStorage: config.storage as never,
			serverIdentityKey: config.serverIdentityKey,
			currentBlock: config.accounts.currentBlock,
			accountStore: config.accountStore,
		})
	}

	if (config.accountStore) {
		const paymail = config.paymail
		mountRegistrationRoutes(app, '/', {
			store: config.accountStore,
			...(paymail?.hostPrivateKey &&
				config.handleCertStore && {
					certs: {
						store: config.handleCertStore,
						hostPrivateKey: paymail.hostPrivateKey,
						userDomain: paymail.userDomain,
						stackUrl: paymail.stackUrl,
					},
				}),
		})
	}

	// --- messagebox (own router; host owns the auth) --------------------------
	if (config.messagebox) {
		const ctx = createMessageBoxContext({
			wallet,
			knex: config.messagebox.knex,
			enableWebSockets: config.messagebox.websockets ?? true,
		})

		const mbRouter = Router()
		registerMessageBoxPreAuthRoutes(mbRouter)

		// Account gate: recipients must hold an account on this host before it
		// stores messages for them. Runs before auth — it only inspects the
		// request body.
		const accountStore = config.accountStore
		if (accountStore) {
			mbRouter.post('/sendMessage', async (req, res, next) => {
				try {
					const message = (req.body as { message?: Record<string, unknown> })
						?.message
					const raw = message?.recipients ?? message?.recipient
					const recipients = Array.isArray(raw) ? raw : raw != null ? [raw] : []
					for (const recipient of recipients) {
						if (typeof recipient !== 'string') continue
						const account = await accountStore.getByIdentity(recipient)
						if (!account) {
							return res.status(403).json({
								status: 'error',
								code: 'ERR_ACCOUNT_REQUIRED',
								description: 'Recipient has no account on this host',
							})
						}
					}
					next()
				} catch (err) {
					next(err)
				}
			})
		}

		// Host owns auth: the same authMiddleware as /.well-known/auth, so a
		// client authenticated there is recognized here without a second
		// handshake.
		mbRouter.use(authMiddleware)
		registerMessageBoxPostAuthRoutes(mbRouter, ctx)
		// Canonical mount. The root mount is a deprecated alias kept for
		// clients that predate the /messagebox prefix (yours-wallet); remove it
		// once they've migrated.
		app.use('/messagebox', mbRouter)
		app.use(mbRouter)

		mountTerminalErrorHandler(app)
		const server = createServer(app)
		const io = attachMessageBoxWebSockets(server, ctx)

		return {
			app,
			port: config.listen.port,
			start() {
				return listenWithLog(server, config, io != null)
			},
			async stop() {
				await new Promise<void>((resolve, reject) => {
					server.close((err) => (err ? reject(err) : resolve()))
				})
			},
		}
	}

	mountTerminalErrorHandler(app)
	const server = createServer(app)
	return {
		app,
		port: config.listen.port,
		start() {
			return listenWithLog(server, config, false)
		},
		async stop() {
			await new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()))
			})
		},
	}
}

function listenWithLog(
	server: Server,
	config: HostServerConfig,
	websockets: boolean,
): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		server.on('error', (err: Error) => {
			const log = createLogger({ context: 'host-server' })
			log.set({ event: 'server_start_failed' })
			log.error(err)
			reject(err)
		})
		server.listen(config.listen.port, config.listen.host ?? '0.0.0.0', () => {
			const address = server.address()
			const port =
				typeof address === 'object' && address
					? address.port
					: config.listen.port
			const log = createLogger({ context: 'host-server' })
			log.set({
				event: 'server_listening',
				host: config.listen.host ?? '0.0.0.0',
				port,
				paymail: config.paymail != null,
				registration: config.accountStore != null,
				messagebox: config.messagebox != null,
				websockets,
			})
			log.emit()
			resolve(port)
		})
	})
}

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
	res.header('Access-Control-Allow-Origin', '*')
	res.header('Access-Control-Allow-Headers', '*')
	res.header('Access-Control-Allow-Methods', '*')
	res.header('Access-Control-Expose-Headers', '*')
	if (req.method === 'OPTIONS') {
		res.sendStatus(200)
		return
	}
	next()
}
