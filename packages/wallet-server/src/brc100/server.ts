/**
 * Node HTTP server for the BRC-100 application-facing endpoints.
 *
 * Wraps createBRC100Router (Web Request/Response) in a plain node:http server
 * so headless wallets can expose `POST /<walletMethod>` on 127.0.0.1 without
 * Bun, Express, or any desktop dependency.
 */

import {
	type IncomingMessage,
	type Server,
	type ServerResponse,
	createServer,
} from 'node:http'
import { type BRC100RouterConfig, createBRC100Router } from './router.js'

const MAX_BODY_BYTES = 32 * 1024 * 1024

async function toWebRequest(
	req: IncomingMessage,
	protocol: string,
): Promise<Request> {
	const url = `${protocol}://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`
	const method = req.method ?? 'GET'
	const headers = new Headers()
	for (const [key, value] of Object.entries(req.headers)) {
		if (Array.isArray(value)) {
			for (const v of value) headers.append(key, v)
		} else if (value !== undefined) {
			headers.set(key, value)
		}
	}

	let body: Uint8Array | undefined
	if (method !== 'GET' && method !== 'HEAD') {
		const chunks: Buffer[] = []
		let size = 0
		for await (const chunk of req) {
			size += (chunk as Buffer).length
			if (size > MAX_BODY_BYTES) {
				throw new Error('request body too large')
			}
			chunks.push(chunk as Buffer)
		}
		body = Buffer.concat(chunks)
	}

	// Attach a body only for non-empty payloads; the ArrayBuffer view keeps
	// the type compatible across lib.dom / undici BodyInit definitions.
	const init: RequestInit = { method, headers }
	if (body && body.length > 0) {
		init.body = body.buffer.slice(
			body.byteOffset,
			body.byteOffset + body.byteLength,
		) as ArrayBuffer
		// duplex required by undici for stream/byte bodies
		;(init as RequestInit & { duplex?: string }).duplex = 'half'
	}
	return new Request(url, init)
}

function sendWebResponse(res: ServerResponse, webRes: Response): void {
	res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()))
	webRes
		.arrayBuffer()
		.then((buf) => {
			res.end(Buffer.from(buf))
		})
		.catch(() => {
			res.statusCode = 500
			res.end()
		})
}

export interface BRC100ServerHandle {
	server: Server
	host: string
	port: number
	close: () => Promise<void>
}

/** Start the BRC-100 HTTP endpoint on host:port. */
export async function startBRC100Server(
	config: BRC100RouterConfig & { host?: string; port?: number },
): Promise<BRC100ServerHandle> {
	const router = createBRC100Router(config)
	const host = config.host ?? '127.0.0.1'
	const port = config.port ?? 3321

	const server = createServer((req, res) => {
		toWebRequest(req, 'http')
			.then((webReq) => router(webReq))
			.then((webRes) => sendWebResponse(res, webRes))
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err)
				res.statusCode = 400
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ error: message }))
			})
	})

	await new Promise<void>((resolve) => {
		server.listen(port, host, resolve)
	})

	return {
		server,
		host,
		port,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()))
			}),
	}
}
