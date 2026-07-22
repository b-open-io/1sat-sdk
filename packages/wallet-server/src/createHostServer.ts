/**
 * Unified host server: wallet storage RPC + hosting + paymail + messagebox
 * in one process with one host identity.
 *
 * Auth zoning:
 * - public: paymail bsvalias, GET /hosting/price
 * - BRC-100: storage RPC, /account/*, /hosting/status|subscribe, messagebox
 */

import type { Server } from 'node:http'
import { createServer } from 'node:http'
import {
	attachMessageBoxWebSockets,
	createMessageBoxContext,
	registerMessageBoxPostAuthRoutes,
	registerMessageBoxPreAuthRoutes,
	type MessageBoxContext,
} from '@bopen-io/messagebox-server'
import { createAuthMiddleware } from '@bsv/auth-express-middleware'
import type { WalletInterface } from '@bsv/sdk'
import { createLogger } from 'evlog'
import { evlog } from 'evlog/express'
import express, { type Express, Router } from 'express'
import {
	type AccountsMiddlewareDeps,
	accountsCapacityGate,
	mountPaymentRoute,
} from './accounts'
import type { AccountsConfigProvider } from './accounts/types'
import {
	corsMiddleware,
	dispatchHandler,
	mountStatusRoute,
	type WalletServerAccounts,
	type WalletServerConfig,
} from './createWalletServer'
import { mountHostingRoutes, type HostingConfigProvider } from './hosting/routes'
import { checkHostingEntitlement } from './paymail/entitlement'
import { mountPaymailRoutes } from './paymail/routes'
import type { PaymailDeps } from './paymail/types'

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
	hosting?: { getConfig: HostingConfigProvider }
	paymail?: PaymailDeps
	messagebox?: HostServerMessageboxConfig
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
	// One authMiddleware instance for every authed surface (storage, account,
	// hosting, messagebox), so a single /.well-known/auth handshake authenticates
	// a client everywhere.
	const authMiddleware = createAuthMiddleware({ wallet })

	// --- public surface -------------------------------------------------------
	if (config.paymail) {
		await mountPaymailRoutes(app, config.paymail)
	}
	if (config.hosting) {
		app.get('/hosting/price', (_req, res) => {
			const cfg = config.hosting!.getConfig()
			if (!cfg.enabled) return res.status(404).json({ error: 'hosting disabled' })
			return res.json({
				priceSats: cfg.priceSats,
				periodSeconds: cfg.periodSeconds,
			})
		})
	}

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

	// Wallet storage JSON-RPC: auth + optional capacity gate + dispatch
	const postHandlers: Array<
		(req: never, res: never, next: never) => unknown
	> = []
	if (accountsDeps) {
		postHandlers.push(accountsCapacityGate(accountsDeps) as never)
	}
	postHandlers.push(
		dispatchHandler(config as unknown as WalletServerConfig) as never,
	)
	app.post('/', authMiddleware as never, ...(postHandlers as never[]))

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
		})
	}

	if (config.hosting) {
		mountHostingRoutes(app, '/', {
			wallet,
			getConfig: config.hosting.getConfig,
			authMiddleware,
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

		// Host pack gate: when hosting is enabled, recipients must hold an active
		// receipt before this server stores messages for them. Runs before auth —
		// it only inspects the request body.
		if (config.hosting?.getConfig().enabled) {
			mbRouter.post('/sendMessage', async (req, res, next) => {
				try {
					const message = (req.body as { message?: Record<string, unknown> })
						?.message
					const raw = message?.recipients ?? message?.recipient
					const recipients = Array.isArray(raw) ? raw : raw != null ? [raw] : []
					for (const recipient of recipients) {
						if (typeof recipient !== 'string') continue
						const ent = await checkHostingEntitlement(wallet, recipient)
						if (!ent.active) {
							return res.status(403).json({
								status: 'error',
								code: 'ERR_HOSTING_REQUIRED',
								description:
									'Recipient does not have an active hosting subscription',
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
		app.use(mbRouter)

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
				hosting: config.hosting != null,
				messagebox: config.messagebox != null,
				websockets,
			})
			log.emit()
			resolve(port)
		})
	})
}
