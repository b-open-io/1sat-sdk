import type { Server } from 'node:http'
import { createAuthMiddleware } from '@bsv/auth-express-middleware'
import type { WalletInterface } from '@bsv/sdk'
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
	nextPaymentDerivation,
} from './accounts'
import type { AccountsRepo } from './accounts/repo'
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
	/** Accounts repo running against the wallet's own connection. */
	repo: AccountsRepo
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
	app.use(express.json({ limit: config.bodyLimit ?? '30mb' }))
	app.use(corsMiddleware)

	const { wallet, serverIdentityKey } = config

	const accountsDeps: AccountsMiddlewareDeps | undefined = config.accounts
		? {
				config: config.accounts.config,
				walletStorage: config.storage,
				repo: config.accounts.repo,
				wallet,
				serverIdentityKey,
				currentBlock: config.accounts.currentBlock,
			}
		: undefined

	if (publicPath) {
		mountPublicRoute(app, publicPath, config, wallet, accountsDeps)
		mountStatusRoute(app, publicPath, config, serverIdentityKey, wallet)
	}
	if (internalPath) {
		mountInternalRoute(app, internalPath, config)
	}

	let server: Server | undefined

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
						resolve(port)
					},
				)
				server.on('error', reject)
			})
		},
		stop() {
			return new Promise<void>((resolve, reject) => {
				if (!server) return resolve()
				server.close((err) => (err ? reject(err) : resolve()))
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

	// JSON-RPC endpoint. Payment middleware sits between auth and dispatch
	// so billable methods can drive 402 auto-payment via BRC-0121.
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
		const identityKey = req.auth?.identityKey
		if (!identityKey || identityKey === 'unknown') {
			return res.status(401).json({
				jsonrpc: '2.0',
				error: { code: -32000, message: 'Unauthenticated' },
				id: req.body?.id ?? null,
			})
		}

		const body = req.body
		if (!isJsonRpcLike(body)) {
			return res.status(400).json({
				jsonrpc: '2.0',
				error: { code: -32600, message: 'Invalid Request' },
				id: body?.id ?? null,
			})
		}

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
			const identityKey = req.auth?.identityKey
			if (!identityKey || identityKey === 'unknown') {
				return res.status(401).json({ error: 'Unauthenticated' })
			}

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
				userId == null ? 0 : await accounts.repo.measureUsedBytes(userId)

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

			const nextPayment = await nextPaymentDerivation(
				identityKey,
				serverWallet,
			)

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
