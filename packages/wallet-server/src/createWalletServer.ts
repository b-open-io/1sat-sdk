import type { Server } from 'node:http'
import { createAuthMiddleware } from '@bsv/auth-express-middleware'
import type { WalletInterface } from '@bsv/sdk'
import { createLogger } from 'evlog'
import { evlog, useLogger } from 'evlog/express'
import express, {
	type Express,
	type NextFunction,
	type Request as ExpressRequest,
	type Response as ExpressResponse,
} from 'express'
import {
	type AccountsMiddlewareDeps,
	accountsCapacityGate,
	latestActivePaymentForPayer,
	mountPaymentRoute,
	nextPaymentDerivation,
} from './accounts'
import type { AccountsConfig } from './accounts/types'
import { createWalletRpcHandler } from './createWalletRpcHandler'
import { dispatch } from './dispatch'
import { bearerResolver } from './resolvers/bearer'
import type {
	MakeWalletLogger,
	PreDispatchHook,
	WalletStorageProvider,
} from './types'

export interface WalletServerAccounts {
	config: AccountsConfig
	currentBlock: () => Promise<number>
}

export interface WalletServerConfig {
	/**
	 * The wallet-toolbox `WalletInterface` this server fronts. The server
	 * exposes this wallet's storage to remote BRC-100 callers, uses the
	 * wallet for mutual-auth signing, and calls `internalizeAction` on it to
	 * record received payments. The server's identity key is this wallet's
	 * identity key.
	 */
	wallet: WalletInterface
	storage: WalletStorageProvider
	/** Identity public key (hex) of the wallet. Used for mutual-auth and the
	 * accounts gate validator. */
	serverIdentityKey: string
	listen: { port: number; host?: string }
	publicPath?: string | null
	internalPath?: string | null
	internalAPIKey?: string
	internalIdentityHeader?: string
	adminIdentityKeys?: string[]
	makeLogger?: MakeWalletLogger
	bodyLimit?: string
	accounts?: WalletServerAccounts
}

export interface WalletServerHandle {
	app: Express
	start(): Promise<number>
	stop(): Promise<void>
}

export function createWalletServer(
	config: WalletServerConfig,
): WalletServerHandle {
	const publicPath = config.publicPath === undefined ? '/' : config.publicPath
	const internalPath =
		config.internalPath === undefined ? '/internal' : config.internalPath

	if (!publicPath && !internalPath) {
		throw new Error(
			'createWalletServer requires at least one of publicPath or internalPath',
		)
	}
	if (internalPath && !config.internalAPIKey) {
		throw new Error('internalAPIKey is required when internalPath is enabled')
	}

	const app = express()
	app.use(evlog())
	app.use(express.json({ limit: config.bodyLimit ?? '30mb' }))
	app.use(corsMiddleware)

	const { wallet, serverIdentityKey } = config

	const accountsDeps: AccountsMiddlewareDeps | undefined = config.accounts
		? {
				config: config.accounts.config,
				walletStorage: config.storage,
				wallet,
				serverIdentityKey,
				currentBlock: config.accounts.currentBlock,
			}
		: undefined

	if (publicPath) {
		mountPublicRoute(app, publicPath, config, wallet, accountsDeps)
		mountStatusRoute(app, publicPath, config, serverIdentityKey, wallet)
		if (accountsDeps) {
			mountPaymentRoute(app, publicPath, {
				config: accountsDeps.config,
				wallet: accountsDeps.wallet,
				walletStorage: accountsDeps.walletStorage as unknown as {
					findOrInsertUser(identityKey: string): Promise<{
						user: { userId: number }
					}>
					measureUsedBytes(userId: number): Promise<number>
				},
				serverIdentityKey: accountsDeps.serverIdentityKey,
				currentBlock: accountsDeps.currentBlock,
			})
		}
	}
	if (internalPath) {
		mountInternalRoute(app, internalPath, config)
	}

	let server: Server | undefined
	const lifecycleLog = createLogger({ context: 'wallet-server' })

	return {
		app,
		start() {
			return new Promise<number>((resolve, reject) => {
				server = app.listen(
					config.listen.port,
					config.listen.host ?? '0.0.0.0',
					() => {
						const address = server?.address()
						const port =
							typeof address === 'object' && address
								? address.port
								: config.listen.port
						lifecycleLog.set({
							event: 'server_listening',
							host: config.listen.host ?? '0.0.0.0',
							port,
							publicPath,
							internalPath,
							accountsEnabled: !!config.accounts,
						})
						lifecycleLog.emit()
						resolve(port)
					},
				)
				server.on('error', (err: Error) => {
					lifecycleLog.set({
						event: 'server_start_failed',
						host: config.listen.host ?? '0.0.0.0',
						port: config.listen.port,
					})
					lifecycleLog.error(err)
					reject(err)
				})
			})
		},
		stop() {
			return new Promise<void>((resolve, reject) => {
				if (!server) return resolve()
				server.close((err) => {
					if (err) {
						lifecycleLog.set({ event: 'server_shutdown_failed' })
						lifecycleLog.error(err)
						reject(err)
						return
					}
					lifecycleLog.set({ event: 'server_shutdown' })
					lifecycleLog.emit()
					resolve()
				})
			})
		},
	}
}

function mountPublicRoute(
	app: Express,
	path: string,
	config: WalletServerConfig,
	wallet: WalletInterface,
	accountsDeps: AccountsMiddlewareDeps | undefined,
): void {
	const authMiddleware = createAuthMiddleware({ wallet })
	app.use(path, authMiddleware)

	// JSON-RPC endpoint. The capacity gate sits between auth and dispatch:
	// over-capacity billable calls return 507 unless they carry a valid
	// inline self-payment (label + BRC-29 output) that the gate recognises.
	const postHandlers: Array<
		(req: ExpressRequest, res: ExpressResponse, next: NextFunction) => unknown
	> = []
	if (accountsDeps) {
		postHandlers.push(accountsCapacityGate(accountsDeps))
	}
	postHandlers.push(dispatchHandler(config))

	app.post(path, ...postHandlers)
}

function dispatchHandler(config: WalletServerConfig) {
	return async (req: AuthenticatedRequest, res: ExpressResponse) => {
		const log = useLogger()
		log.set({ context: 'wallet-server', route: 'rpc' })

		const identityKey = req.auth?.identityKey
		if (!identityKey || identityKey === 'unknown') {
			log.set({ event: 'auth_failed', reason: 'missing_identity' })
			return res.status(401).json({
				jsonrpc: '2.0',
				error: { code: -32000, message: 'Unauthenticated' },
				id: req.body?.id ?? null,
			})
		}
		log.set({ identityKey })

		const body = req.body
		if (!isJsonRpcLike(body)) {
			log.set({ event: 'invalid_request', reason: 'not_jsonrpc' })
			return res.status(400).json({
				jsonrpc: '2.0',
				error: { code: -32600, message: 'Invalid Request' },
				id: body?.id ?? null,
			})
		}

		log.set({ event: 'rpc_request', method: body.method })

		const response = await dispatch(
			{
				storage: config.storage,
				adminIdentityKeys: config.adminIdentityKeys,
				makeLogger: config.makeLogger,
			},
			{
				method: body.method,
				params: Array.isArray(body.params) ? body.params : [],
				id: normalizeJsonRpcId(body.id),
				identity: { identityKey },
			},
		)

		const errorObj = (
			response as { error?: { code?: number; message?: string } }
		).error
		if (errorObj) {
			log.set({
				event: 'rpc_error',
				rpcErrorCode: errorObj.code,
				rpcErrorMessage: errorObj.message,
			})
		}

		res.status(200).json(response)
	}
}

function mountStatusRoute(
	app: Express,
	basePath: string,
	config: WalletServerConfig,
	serverIdentityKey: string,
	serverWallet: WalletInterface,
): void {
	const statusPath = joinPath(basePath, 'account/status')
	app.get(
		statusPath,
		async (req: AuthenticatedRequest, res: ExpressResponse) => {
			const log = useLogger()
			log.set({ context: 'wallet-server', route: 'account_status' })

			const identityKey = req.auth?.identityKey
			if (!identityKey || identityKey === 'unknown') {
				log.set({ event: 'auth_failed', reason: 'missing_identity' })
				return res.status(401).json({ error: 'Unauthenticated' })
			}
			log.set({ identityKey })

			const accounts = config.accounts
			if (!accounts) {
				return res.status(200).json({
					identityKey,
					serverIdentityKey,
					accountsEnabled: false,
				})
			}

			const currentBlock = await accounts.currentBlock()
			const userResult = await config.storage.findOrInsertUser(identityKey)
			const userId = userResult?.user?.userId
			const usedBytes =
				userId == null
					? 0
					: await (
							config.storage as unknown as {
								measureUsedBytes(userId: number): Promise<number>
							}
						).measureUsedBytes(userId)

			if (!accounts.config.enabled) {
				return res.status(200).json({
					identityKey,
					serverIdentityKey,
					accountsEnabled: false,
					currentBlock,
					usedBytes,
				})
			}

			const currentPayment = await latestActivePaymentForPayer(
				serverWallet,
				identityKey,
				currentBlock,
			)
			const paidBytes = currentPayment?.bytesCovered ?? 0
			const capacityBytes = accounts.config.baselineBytes + paidBytes
			const deficitBytes = Math.max(0, usedBytes - capacityBytes)

			const nextPayment = await nextPaymentDerivation(identityKey, serverWallet)

			return res.status(200).json({
				identityKey,
				serverIdentityKey,
				accountsEnabled: true,
				currentBlock,
				usedBytes,
				baselineBytes: accounts.config.baselineBytes,
				paidBytes,
				capacityBytes,
				deficitBytes,
				paidThroughBlock: currentPayment?.paidThroughBlock ?? null,
				pricing: {
					purchaseUnitBytes: accounts.config.purchaseUnitBytes,
					satsPerUnit: accounts.config.satsPerUnit,
					durationBlocks: accounts.config.durationBlocks,
				},
				nextPayment,
			})
		},
	)
}

function joinPath(basePath: string, sub: string): string {
	const trimmedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
	const trimmedSub = sub.startsWith('/') ? sub.slice(1) : sub
	return trimmedBase === '' ? `/${trimmedSub}` : `${trimmedBase}/${trimmedSub}`
}

function mountInternalRoute(
	app: Express,
	path: string,
	config: WalletServerConfig,
): void {
	const preDispatch: PreDispatchHook | undefined = undefined
	const handler = createWalletRpcHandler({
		storage: config.storage,
		resolveIdentity: bearerResolver({
			token: config.internalAPIKey!,
			identityHeader: config.internalIdentityHeader,
		}),
		adminIdentityKeys: config.adminIdentityKeys,
		makeLogger: config.makeLogger,
		preDispatch,
	})

	app.post(path, async (req: ExpressRequest, res: ExpressResponse) => {
		const fetchReq = expressToFetchRequest(req)
		const fetchRes = await handler(fetchReq)
		res.status(fetchRes.status)
		fetchRes.headers.forEach((v, k) => res.set(k, v))
		const buf = Buffer.from(await fetchRes.arrayBuffer())
		res.send(buf)
	})
}

interface AuthenticatedRequest extends ExpressRequest {
	auth?: { identityKey: string }
}

function corsMiddleware(
	_req: ExpressRequest,
	res: ExpressResponse,
	next: NextFunction,
): void {
	res.header('Access-Control-Allow-Origin', '*')
	res.header('Access-Control-Allow-Headers', '*')
	res.header('Access-Control-Allow-Methods', '*')
	res.header('Access-Control-Expose-Headers', '*')
	next()
}

function isJsonRpcLike(
	body: unknown,
): body is { jsonrpc: string; method: string; params?: unknown; id?: unknown } {
	if (typeof body !== 'object' || body === null) return false
	const b = body as Record<string, unknown>
	return b.jsonrpc === '2.0' && typeof b.method === 'string'
}

function normalizeJsonRpcId(id: unknown): string | number | null {
	if (typeof id === 'string' || typeof id === 'number') return id
	return null
}

function expressToFetchRequest(req: ExpressRequest): Request {
	const protocol = (req.headers['x-forwarded-proto'] as string) ?? 'http'
	const host = req.headers.host ?? 'localhost'
	const url = new URL(req.originalUrl || req.url, `${protocol}://${host}`)
	const headers = new Headers()
	for (const [k, v] of Object.entries(req.headers)) {
		if (typeof v === 'string') headers.set(k, v)
		else if (Array.isArray(v)) headers.set(k, v.join(', '))
	}
	const body = req.body !== undefined ? JSON.stringify(req.body) : undefined
	return new Request(url, {
		method: req.method,
		headers,
		body,
	})
}
