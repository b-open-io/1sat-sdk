/**
 * Unified host server: wallet storage RPC + accounts + paymail + messagebox
 * in one process with one host identity.
 *
 * Auth zoning:
 * - public: paymail bsvalias, OpenAPI docs
 * - BRC-100: storage RPC, /storage/v1, /account/*, messagebox
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
import express, { type Express, Router } from 'express'
import {
	type AccountsMiddlewareDeps,
	accountsCapacityGate,
	mountPaymentRoute,
	mountRegistrationRoutes,
} from './accounts/index.js'
import type { AccountStore } from './accounts/store.js'
import {
	type WalletServerAccounts,
	type WalletServerConfig,
	corsMiddleware,
	dispatchHandler,
	mountStatusRoute,
} from './createWalletServer.js'
import { mountTerminalErrorHandler } from './errorHandler.js'
import { mountOpenApiRoutes } from './openapi/index.js'
import { mountPaymailRoutes } from './paymail/routes.js'
import type { PaymailDeps } from './paymail/types.js'
import { buildAuthMiddleware } from './sessions/redisSessionManager.js'
import { mountStorageV1 } from './v1.js'

export interface HostServerMessageboxConfig {
	/** Knex instance for message tables */
	knex: MessageBoxContext['knex']
	/** Enable authenticated WebSocket delivery. Default true. */
	websockets?: boolean
}

export interface HostServerConfig {
	wallet: WalletInterface
	storage: WalletServerConfig['storage']
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
	paymail?: PaymailDeps
	messagebox?: HostServerMessageboxConfig
	/**
	 * Redis-shared BRC-104 sessions for multi-instance deployments behind a
	 * load balancer. Unset = in-memory sessions (single instance).
	 */
	sessionStore?: { redisUrl: string; ttlSeconds?: number }
	bodyLimit?: string
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
	// One authMiddleware instance for every authed surface (storage RPC,
	// /storage/v1, account, messagebox), so a single /.well-known/auth
	// handshake authenticates a client everywhere. With a session store,
	// sessions are mirrored to Redis and hydrated on demand so any instance
	// can validate any session.
	const authMiddleware = buildAuthMiddleware(wallet, config.sessionStore)

	// --- public surface -------------------------------------------------------
	if (config.paymail) {
		await mountPaymailRoutes(app, config.paymail)
	}
	mountOpenApiRoutes(app, {
		serverIdentityKey: config.serverIdentityKey,
		surfaces: {
			storage: true,
			accounts: config.accounts != null,
			registration: config.accountStore != null,
			paymail: config.paymail != null,
			messagebox: config.messagebox != null,
		},
	})

	// --- auth surface ----------------------------------------------------------
	const accountsDeps: AccountsMiddlewareDeps | undefined = config.accounts
		? {
				getConfig: config.accounts.getConfig,
				walletStorage: config.storage,
				wallet,
				serverIdentityKey: config.serverIdentityKey,
				currentBlock: config.accounts.currentBlock,
			}
		: undefined

	// Wallet storage JSON-RPC + Go v1 REST: auth + optional capacity gate + dispatch
	const postHandlers: Array<(req: never, res: never, next: never) => unknown> =
		[]
	if (accountsDeps) {
		postHandlers.push(accountsCapacityGate(accountsDeps) as never)
	}
	postHandlers.push(
		dispatchHandler(config as unknown as WalletServerConfig) as never,
	)
	app.post('/', authMiddleware as never, ...(postHandlers as never[]))
	mountStorageV1(app, config, {
		authMiddleware: authMiddleware as never,
	})

	// BRC-104 handshake endpoint. The middleware keys on
	// `req.path === '/.well-known/auth'`, so mount it route-level — an
	// `app.use('/.well-known/auth', …)` would strip the path and break the
	// check. Same authMiddleware instance as POST / → shared peer session.
	app.post('/.well-known/auth', authMiddleware)

	// Account routes need auth; scope it to /account/*
	app.use('/account', authMiddleware)
	mountStatusRoute(
		app,
		'/',
		config as unknown as WalletServerConfig,
		config.serverIdentityKey,
		wallet,
	)
	if (accountsDeps) {
		mountPaymentRoute(app, '/', {
			getConfig: accountsDeps.getConfig,
			wallet: accountsDeps.wallet,
			walletStorage: accountsDeps.walletStorage as never,
			serverIdentityKey: accountsDeps.serverIdentityKey,
			currentBlock: accountsDeps.currentBlock,
			accountStore: config.accountStore,
		})
	}

	if (config.accountStore) {
		mountRegistrationRoutes(app, '/', { store: config.accountStore })
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

		// Host owns auth: the same authMiddleware as the wallet-storage RPC, so a
		// client authenticated at /.well-known/auth is recognized here without a
		// second handshake.
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
