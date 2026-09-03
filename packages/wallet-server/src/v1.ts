/**
 * Go toolbox v0.184+ storage adapter: GET/POST /storage/v1/*.
 * Same provider methods as JSON-RPC `dispatch`; REST envelope and error
 * shape match `bsv-blockchain/go-wallet-toolbox` `pkg/storage/v1adapter`.
 */

import { useLogger } from 'evlog/express'
import {
	type Request,
	type RequestHandler,
	type Response,
	Router,
} from 'express'
import { type DispatchContext, dispatch } from './dispatch.js'

type AuthedRequest = Request & { auth?: { identityKey?: string } }

export interface MountStorageV1Options {
	/** Default `/storage/v1`. */
	basePath?: string
	/**
	 * When set, applied on the V1 router before handlers. Use this on
	 * `createHostServer`, which does not auth the whole app. Omit on
	 * `createWalletServer`, where `app.use(publicPath, authMiddleware)`
	 * already covers these routes.
	 */
	authMiddleware?: RequestHandler
}

export function mountStorageV1(
	app: { use: (path: string, ...handlers: RequestHandler[]) => unknown },
	ctx: DispatchContext,
	options: MountStorageV1Options = {},
): void {
	const basePath = options.basePath ?? '/storage/v1'
	const router = Router()
	if (options.authMiddleware) {
		router.use(options.authMiddleware)
	}
	registerV1Routes(router, ctx)
	app.use(basePath, router)
}

function registerV1Routes(router: Router, ctx: DispatchContext): void {
	router.get('/settings', wrap(ctx, getSettings))
	router.post('/migrate', wrap(ctx, migrate))
	router.post('/users', wrap(ctx, findOrInsertUser))
	router.post('/actions', wrap(ctx, createAction))
	router.post('/actions/process', wrap(ctx, processAction))
	router.post('/actions/abort', wrap(ctx, abortAction))
	router.post('/actions/internalize', wrap(ctx, internalizeAction))
	router.post('/list/actions', wrap(ctx, listActions))
	router.post('/list/outputs', wrap(ctx, listOutputs))
	router.post('/list/certificates', wrap(ctx, listCertificates))
	router.post('/list/transactions', wrap(ctx, listTransactions))
	router.post('/balance', wrap(ctx, getBalance))
	router.post('/certificates', wrap(ctx, insertCertificate))
	router.post('/certificates/relinquish', wrap(ctx, relinquishCertificate))
	router.post('/outputs/relinquish', wrap(ctx, relinquishOutput))
	router.post('/sync/active', wrap(ctx, syncActive))
	router.post('/sync/chunk', wrap(ctx, syncChunk))
	router.post('/sync/state', wrap(ctx, syncState))
	router.use((req, res) => {
		sendError(res, 404, `not found: ${req.method} ${req.path}`)
	})
}

type V1Handler = (
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
) => Promise<void>

function requestLog(): { set: (fields: Record<string, unknown>) => void } {
	try {
		return useLogger()
	} catch {
		return { set() {} }
	}
}

function wrap(ctx: DispatchContext, handler: V1Handler): RequestHandler {
	return async (req, res) => {
		const log = requestLog()
		log.set({ context: 'wallet-server', route: 'storage_v1', path: req.path })
		const identityKey = (req as AuthedRequest).auth?.identityKey
		if (!identityKey || identityKey === 'unknown') {
			log.set({ event: 'auth_failed', reason: 'missing_identity' })
			sendError(res, 401, 'Authentication required')
			return
		}
		log.set({ identityKey })
		try {
			await handler(ctx, req as AuthedRequest, res, identityKey)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			log.set({ event: 'v1_error', error: message })
			sendError(res, 500, message)
		}
	}
}

async function getSettings(
	ctx: DispatchContext,
	_req: AuthedRequest,
	res: Response,
	_identityKey: string,
): Promise<void> {
	const storage = ctx.storage as unknown as {
		makeAvailable?: () => Promise<unknown>
		getSettings?: () => unknown
	}
	try {
		const settings = storage.makeAvailable
			? await storage.makeAvailable()
			: await storage.getSettings?.()
		if (settings == null) {
			sendError(res, 500, 'settings unavailable')
			return
		}
		sendJson(res, 200, settings)
	} catch (err) {
		sendError(res, 500, err instanceof Error ? err.message : String(err))
	}
}

async function migrate(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	_identityKey: string,
): Promise<void> {
	const storage = ctx.storage as unknown as {
		migrate?: (name: string, key: string) => Promise<string>
	}
	if (typeof storage.migrate !== 'function') {
		sendError(res, 400, 'Method not found: migrate')
		return
	}
	const body = asRecord(req.body)
	if (!body) {
		sendError(res, 400, 'invalid JSON body')
		return
	}
	const storageName = body.storageName
	const storageIdentityKey = body.storageIdentityKey
	if (
		typeof storageName !== 'string' ||
		typeof storageIdentityKey !== 'string'
	) {
		sendError(res, 400, 'invalid JSON body')
		return
	}
	try {
		const name = await storage.migrate(storageName, storageIdentityKey)
		sendJson(res, 200, { storageName: name })
	} catch (err) {
		sendError(res, 500, err instanceof Error ? err.message : String(err))
	}
}

async function findOrInsertUser(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const body = asRecord(req.body)
	if (!body || typeof body.identityKey !== 'string') {
		sendError(res, 400, 'invalid JSON body for findOrInsertUser')
		return
	}
	if (body.identityKey !== identityKey) {
		sendError(res, 401, 'identityKey does not match authentication')
		return
	}
	await invoke(ctx, res, identityKey, 'findOrInsertUser', [body.identityKey])
}

async function createAction(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const body = asRecord(req.body)
	if (!body || !('args' in body)) {
		sendError(res, 400, 'args is required')
		return
	}
	await invoke(ctx, res, identityKey, 'createAction', [{}, body.args])
}

async function processAction(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'processAction', res)
	if (args === undefined) return
	await invoke(ctx, res, identityKey, 'processAction', [{}, args])
}

async function abortAction(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'abortAction', res)
	if (args === undefined) return
	await invoke(ctx, res, identityKey, 'abortAction', [{}, args])
}

async function internalizeAction(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const verified = verifyBodyIdentity(req.body, identityKey, res)
	if (!verified) return
	const args = decodeArgs(req.body, 'internalizeAction', res)
	if (args === undefined) return
	await invoke(ctx, res, identityKey, 'internalizeAction', [{}, args])
}

async function listActions(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'listActions', res)
	if (args === undefined) return
	await invoke(ctx, res, identityKey, 'listActions', [{}, args])
}

async function listOutputs(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'listOutputs', res)
	if (args === undefined) return
	await invoke(ctx, res, identityKey, 'listOutputs', [{}, args])
}

async function listCertificates(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'listCertificates', res)
	if (args === undefined) return
	await invoke(ctx, res, identityKey, 'listCertificates', [{}, args])
}

async function listTransactions(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'listTransactions', res)
	if (args === undefined) return
	await invoke(ctx, res, identityKey, 'listTransactions', [{}, args])
}

async function getBalance(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'getBalance', res)
	if (args === undefined) return
	const basket =
		typeof args === 'object' && args !== null && 'basket' in args
			? (args as { basket?: unknown }).basket
			: ''
	await invoke(
		ctx,
		res,
		identityKey,
		'getBalance',
		[{}, basket ?? ''],
		(result) =>
			typeof result === 'object' && result !== null && 'balance' in result
				? result
				: { balance: result },
	)
}

async function insertCertificate(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'insertCertificate', res)
	if (args === undefined) return
	await invoke(
		ctx,
		res,
		identityKey,
		'insertCertificateAuth',
		[{}, args],
		(result) =>
			typeof result === 'object' && result !== null && 'certificateId' in result
				? result
				: { certificateId: result },
	)
}

async function relinquishCertificate(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'relinquishCertificate', res)
	if (args === undefined) return
	await invoke(
		ctx,
		res,
		identityKey,
		'relinquishCertificate',
		[{}, args],
		() => ({
			updated: 1,
		}),
	)
}

async function relinquishOutput(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'relinquishOutput', res)
	if (args === undefined) return
	const output =
		typeof args === 'object' && args !== null
			? (args as { output?: unknown }).output
			: undefined
	if (typeof output !== 'string' || !isValidOutpoint(output)) {
		sendError(res, 400, 'invalid outpoint format')
		return
	}
	await invoke(ctx, res, identityKey, 'relinquishOutput', [{}, args], () => ({
		updated: 1,
	}))
}

async function syncActive(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const body = asRecord(req.body)
	if (!body || typeof body.newActiveStorageIdentityKey !== 'string') {
		sendError(res, 400, 'invalid JSON body for syncActive')
		return
	}
	await invoke(
		ctx,
		res,
		identityKey,
		'setActive',
		[{}, body.newActiveStorageIdentityKey],
		() => ({ updated: 1 }),
	)
}

async function syncChunk(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const args = decodeArgs(req.body, 'syncChunk', res)
	if (args === undefined) return
	if (typeof args !== 'object' || args === null) {
		sendError(res, 400, 'invalid JSON body for syncChunk')
		return
	}
	const chunk = args as { identityKey?: string }
	if (!chunk.identityKey) {
		chunk.identityKey = identityKey
	} else if (chunk.identityKey !== identityKey) {
		sendError(res, 403, 'identityKey does not match authentication')
		return
	}
	await invoke(ctx, res, identityKey, 'getSyncChunk', [chunk])
}

async function syncState(
	ctx: DispatchContext,
	req: AuthedRequest,
	res: Response,
	identityKey: string,
): Promise<void> {
	const body = asRecord(req.body)
	if (
		!body ||
		typeof body.storageIdentityKey !== 'string' ||
		typeof body.storageName !== 'string'
	) {
		sendError(res, 400, 'invalid JSON body for syncState')
		return
	}
	await invoke(ctx, res, identityKey, 'findOrInsertSyncStateAuth', [
		{},
		body.storageIdentityKey,
		body.storageName,
	])
}

async function invoke(
	ctx: DispatchContext,
	res: Response,
	identityKey: string,
	method: string,
	params: unknown[],
	wrapResult?: (result: unknown) => unknown,
): Promise<void> {
	const response = await dispatch(ctx, {
		method,
		params,
		id: null,
		identity: { identityKey },
	})
	if ('error' in response && response.error) {
		sendError(
			res,
			statusForDispatch(response.error),
			errorMessage(response.error),
		)
		return
	}
	const result = (response as { result?: unknown }).result
	sendJson(res, 200, wrapResult ? wrapResult(result) : result)
}

function decodeArgs(
	body: unknown,
	label: string,
	res: Response,
): unknown | undefined {
	if (body == null) return {}
	if (typeof body !== 'object') {
		sendError(res, 400, `invalid JSON body for ${label}`)
		return undefined
	}
	const rec = body as Record<string, unknown>
	if ('args' in rec) return rec.args ?? {}
	return rec
}

function verifyBodyIdentity(
	body: unknown,
	identityKey: string,
	res: Response,
): boolean {
	const rec = asRecord(body)
	if (!rec || rec.identityKey == null || rec.identityKey === '') return true
	if (typeof rec.identityKey !== 'string') {
		sendError(res, 400, 'invalid JSON body')
		return false
	}
	if (rec.identityKey !== identityKey) {
		sendError(res, 401, 'identityKey does not match authentication')
		return false
	}
	return true
}

function asRecord(body: unknown): Record<string, unknown> | null {
	if (typeof body !== 'object' || body === null) return null
	return body as Record<string, unknown>
}

function isValidOutpoint(outpoint: string): boolean {
	const parts = outpoint.split('.')
	if (parts.length !== 2) return false
	if (parts[0].length !== 64) return false
	return /^[0-9]+$/.test(parts[1])
}

function statusForDispatch(error: { code?: number; message?: string }): number {
	const msg = error.message ?? ''
	if (error.code === -32601) return 400
	if (/does not match authentication/i.test(msg)) return 401
	if (/authenticated user/i.test(msg)) return 401
	if (/unauthorized|unauthenticated/i.test(msg)) return 401
	return 500
}

function errorMessage(error: {
	message?: string
	description?: string
}): string {
	return error.message || error.description || 'INTERNAL_ERROR'
}

function sendError(res: Response, status: number, message: string): void {
	sendJson(res, status, { error: message })
}

function sendJson(res: Response, status: number, value: unknown): void {
	res
		.status(status)
		.type('application/json')
		.send(
			JSON.stringify(value, (_key, v) =>
				v instanceof Uint8Array ? Array.from(v) : v,
			),
		)
}
