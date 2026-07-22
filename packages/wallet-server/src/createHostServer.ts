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
	mountMessageBoxRoutes,
	type MessageBoxContext,
} from '@bopen-io/messagebox-server'
import { createAuthMiddleware } from '@bsv/auth-express-middleware'
import type { WalletInterface } from '@bsv/sdk'
import { createLogger } from 'evlog'
import { evlog, useLogger } from 'evlog/express'
import express, { type Express } from 'express'
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

	// --- messagebox (auth on its own router) ----------------------------------
	if (config.messagebox) {
		const ctx = createMessageBoxContext({
			wallet,
			knex: config.messagebox.knex,
			enableWebSockets: config.messagebox.websockets ?? true,
		})
		mountMessageBoxRoutes(app, ctx)

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
			useLogger().error(err)
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
