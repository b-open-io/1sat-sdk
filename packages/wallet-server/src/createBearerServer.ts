import { type IncomingMessage, createServer } from 'node:http'
import { createWalletRpcHandler } from './createWalletRpcHandler.js'
import { bearerResolver } from './resolvers/bearer.js'
import type { WalletStorageProvider } from './types.js'

export interface BearerServerConfig {
	storage: WalletStorageProvider
	token: string
	port: number
	hostname?: string
	identityHeader?: string
	adminIdentityKeys?: string[]
}

export interface BearerServerHandle {
	/** Bound port once `ready` resolves; the configured port before that. */
	readonly port: number
	/** Resolves with the bound port once the socket is listening. */
	ready: Promise<number>
	stop(): Promise<void>
}

/**
 * Bearer-only RPC server on `node:http`, no Express, no BRC-100. Runs under
 * Node or Bun.
 *
 * Intended for firewalled internal deployments where an upstream has already
 * authenticated the caller (e.g. 1sat-stack's `/internal` consumer path).
 */
export function createBearerServer(
	config: BearerServerConfig,
): BearerServerHandle {
	const handler = createWalletRpcHandler({
		storage: config.storage,
		resolveIdentity: bearerResolver({
			token: config.token,
			identityHeader: config.identityHeader,
		}),
		adminIdentityKeys: config.adminIdentityKeys,
	})

	const server = createServer(async (req, res) => {
		try {
			const response = await handler(await toFetchRequest(req))
			res.writeHead(
				response.status,
				Object.fromEntries(response.headers.entries()),
			)
			res.end(new Uint8Array(await response.arrayBuffer()))
		} catch (err) {
			res.writeHead(500, { 'content-type': 'application/json' })
			res.end(
				JSON.stringify({
					error: err instanceof Error ? err.message : 'internal error',
				}),
			)
		}
	})
	let boundPort = config.port
	const ready = new Promise<number>((resolve, reject) => {
		server.once('error', reject)
		server.listen(config.port, config.hostname ?? '0.0.0.0', () => {
			const address = server.address()
			if (typeof address === 'object' && address) boundPort = address.port
			resolve(boundPort)
		})
	})

	return {
		get port() {
			return boundPort
		},
		ready,
		async stop() {
			await new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()))
			})
		},
	}
}

async function toFetchRequest(req: IncomingMessage): Promise<Request> {
	const host = req.headers.host ?? 'localhost'
	const url = new URL(req.url ?? '/', `http://${host}`)
	const headers = new Headers()
	for (const [k, v] of Object.entries(req.headers)) {
		if (typeof v === 'string') headers.set(k, v)
		else if (Array.isArray(v)) headers.set(k, v.join(', '))
	}
	const method = req.method ?? 'GET'
	if (method === 'GET' || method === 'HEAD') {
		return new Request(url, { method, headers })
	}
	const chunks: Uint8Array[] = []
	for await (const chunk of req) chunks.push(chunk as Uint8Array)
	const total = chunks.reduce((n, c) => n + c.length, 0)
	const body = new Uint8Array(total)
	let offset = 0
	for (const c of chunks) {
		body.set(c, offset)
		offset += c.length
	}
	return new Request(url, { method, headers, body })
}
