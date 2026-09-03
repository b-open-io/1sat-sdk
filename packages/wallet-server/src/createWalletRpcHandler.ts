import {
	BINARY_ENCODING,
	BINARY_ENCODING_HEADER,
	stringifyJsonRpc,
} from '@bsv/wallet-toolbox/out/src/storage/remoting/BinaryJson.js'
import { dispatch } from './dispatch.js'
import type {
	JsonRpcRequest,
	JsonRpcResponse,
	WalletRpcHandlerConfig,
} from './types.js'

export type WalletRpcHandler = (req: Request) => Promise<Response>

export function createWalletRpcHandler(
	config: WalletRpcHandlerConfig,
): WalletRpcHandler {
	return async (req: Request): Promise<Response> => {
		if (req.method !== 'POST') {
			return methodNotAllowed()
		}

		// Storage results carry Uint8Array fields. The caller advertises whether
		// it can decode base64-tagged binary; we echo the header only when we
		// encode that way, and fall back to number[] for callers that don't ask.
		const useBinary =
			req.headers.get(BINARY_ENCODING_HEADER) === BINARY_ENCODING

		const body = await parseBody(req)
		if (!body.ok) {
			return invalidRequest(body.id, useBinary)
		}

		let identity: Awaited<ReturnType<typeof config.resolveIdentity>>
		try {
			identity = await config.resolveIdentity(req)
		} catch (err) {
			return unauthorized(body.request.id ?? null, err, useBinary)
		}

		if (config.preDispatch) {
			const gate = await config.preDispatch({
				method: body.request.method,
				identity,
				request: req,
				id: body.request.id ?? null,
			})
			if (gate.type === 'blocked') {
				return gate.response
			}
		}

		const response = await dispatch(
			{
				storage: config.storage,
				adminIdentityKeys: config.adminIdentityKeys,
				makeLogger: config.makeLogger,
			},
			{
				method: body.request.method,
				params: body.request.params ?? [],
				id: body.request.id ?? null,
				identity,
			},
		)

		return rpcResponse(response, 200, useBinary)
	}
}

type ParsedBody =
	| { ok: true; request: JsonRpcRequest; id: string | number | null }
	| { ok: false; id: string | number | null }

async function parseBody(req: Request): Promise<ParsedBody> {
	let raw: unknown
	try {
		raw = await req.json()
	} catch {
		return { ok: false, id: null }
	}
	if (!isJsonRpcRequest(raw)) {
		const maybeId = (raw as { id?: string | number | null })?.id ?? null
		return { ok: false, id: maybeId }
	}
	return { ok: true, request: raw, id: raw.id ?? null }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (typeof value !== 'object' || value === null) return false
	const v = value as Record<string, unknown>
	if (v.jsonrpc !== '2.0') return false
	if (typeof v.method !== 'string') return false
	if (v.params !== undefined && !Array.isArray(v.params)) return false
	return true
}

/**
 * Serialize every JSON-RPC response through the toolbox's own codec, the
 * counterpart to `parseJsonRpc` in `StorageClient`. Bare `JSON.stringify`
 * renders a `Uint8Array` as `{"0":..,"1":..}`, which the client cannot
 * decode back to bytes.
 */
function rpcResponse(
	body: JsonRpcResponse,
	status: number,
	useBinary: boolean,
): Response {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
	}
	if (useBinary) headers[BINARY_ENCODING_HEADER] = BINARY_ENCODING
	return new Response(stringifyJsonRpc(body, useBinary), { status, headers })
}

function methodNotAllowed(): Response {
	return new Response('Method Not Allowed', { status: 405 })
}

function invalidRequest(
	id: string | number | null,
	useBinary: boolean,
): Response {
	return rpcResponse(
		{
			jsonrpc: '2.0',
			error: { code: -32600, message: 'Invalid Request' },
			id,
		},
		400,
		useBinary,
	)
}

function unauthorized(
	id: string | number | null,
	err: unknown,
	useBinary: boolean,
): Response {
	const message = err instanceof Error ? err.message : 'Unauthorized'
	return rpcResponse(
		{
			jsonrpc: '2.0',
			error: { code: -32000, message },
			id,
		},
		401,
		useBinary,
	)
}
