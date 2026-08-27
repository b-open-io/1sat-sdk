import { WalletError } from '@bsv/wallet-toolbox/out/src/sdk/WalletError.js'
import { WERR_UNAUTHORIZED } from '@bsv/wallet-toolbox/out/src/sdk/WERR_errors.js'
import type {
	JsonRpcResponse,
	MakeWalletLogger,
	ResolvedIdentity,
	WalletLoggerInterface,
	WalletStorageProvider,
} from './types'

export interface DispatchContext {
	storage: WalletStorageProvider
	adminIdentityKeys?: string[]
	makeLogger?: MakeWalletLogger
}

export interface DispatchInput {
	method: string
	params: unknown[]
	id: string | number | null
	identity: ResolvedIdentity
}

const METHODS_NO_AUTH = new Set(['getSettings'])
const METHODS_IGNORED = new Set(['destroy'])
const METHODS_ADMIN = new Set(['adminStats'])

/**
 * Methods that grow persisted wallet state. The accounts middleware uses this
 * to decide whether a request is subject to metering. All other methods
 * (reads, sync, shrink) stay free.
 */
export const BILLABLE_METHODS: ReadonlySet<string> = new Set([
	'createAction',
	'processAction',
	'internalizeAction',
	'insertCertificateAuth',
	'processSyncChunk',
])

export function isBillableMethod(method: string): boolean {
	return BILLABLE_METHODS.has(method)
}

export async function dispatch(
	ctx: DispatchContext,
	input: DispatchInput,
): Promise<JsonRpcResponse> {
	const { method, id } = input
	const storage = ctx.storage as unknown as Record<
		string,
		(...args: unknown[]) => unknown
	>

	if (typeof storage[method] !== 'function') {
		return methodNotFound(method, id)
	}

	if (METHODS_IGNORED.has(method)) {
		return { jsonrpc: '2.0', result: undefined, id }
	}

	try {
		const preparedParams = await prepareParams(ctx, input)

		const logger = attachLoggerIfRequested(
			ctx,
			method,
			input.identity,
			preparedParams,
		)

		try {
			const result = await storage[method](...preparedParams)
			attachLoggerTail(logger, result)
			return { jsonrpc: '2.0', result, id }
		} catch (err) {
			logger?.flush?.()
			throw err
		}
	} catch (err) {
		return marshalError(err, id)
	}
}

async function prepareParams(
	ctx: DispatchContext,
	input: DispatchInput,
): Promise<unknown[]> {
	const { method, identity } = input
	const params = [...input.params]

	if (METHODS_NO_AUTH.has(method)) {
		return params
	}

	if (method === 'findOrInsertUser') {
		if (params[0] !== identity.identityKey) {
			throw new WERR_UNAUTHORIZED(
				'function may only access authenticated user.',
			)
		}
		return params
	}

	if (METHODS_ADMIN.has(method)) {
		const arg0 = params[0] as { identityKey?: string } | undefined
		if (!arg0 || arg0.identityKey !== identity.identityKey) {
			throw new WERR_UNAUTHORIZED(
				'function may only access authenticated admin user.',
			)
		}
		if (!ctx.adminIdentityKeys?.includes(identity.identityKey)) {
			throw new WERR_UNAUTHORIZED(
				'function may only be accessed by admin user.',
			)
		}
		return params
	}

	await applyParam0Auth(ctx, identity, params)

	if (method === 'processSyncChunk' && params[1]) {
		normalizeSyncChunk(params[1] as Record<string, unknown>)
	}

	return params
}

async function applyParam0Auth(
	ctx: DispatchContext,
	identity: ResolvedIdentity,
	params: unknown[],
): Promise<void> {
	if (typeof params[0] !== 'object' || params[0] === null) {
		params[0] = {}
	}
	const arg0 = params[0] as {
		identityKey?: string
		userId?: number
		reqAuthUserId?: number
	}

	if (arg0.identityKey && arg0.identityKey !== identity.identityKey) {
		throw new WERR_UNAUTHORIZED('identityKey does not match authentication')
	}

	const { user } = await ctx.storage.findOrInsertUser(identity.identityKey)
	arg0.reqAuthUserId = user.userId
	if (arg0.identityKey) {
		arg0.userId = user.userId
	}
}

function normalizeSyncChunk(chunk: Record<string, unknown>): void {
	const arrayFields = [
		'certificateFields',
		'certificates',
		'commissions',
		'outputBaskets',
		'outputTagMaps',
		'outputTags',
		'outputs',
		'provenTxReqs',
		'provenTxs',
		'transactions',
		'txLabelMaps',
		'txLabels',
	]
	for (const field of arrayFields) {
		const arr = chunk[field]
		if (Array.isArray(arr)) {
			for (let i = 0; i < arr.length; i++) {
				arr[i] = validateEntity(arr[i] as Record<string, unknown>)
			}
		}
	}
	if (chunk.user && typeof chunk.user === 'object') {
		chunk.user = validateEntity(chunk.user as Record<string, unknown>)
	}
}

function validateEntity(
	entity: Record<string, unknown>,
): Record<string, unknown> {
	if ('created_at' in entity)
		entity.created_at = validateDate(
			entity.created_at as Date | string | number,
		)
	if ('updated_at' in entity)
		entity.updated_at = validateDate(
			entity.updated_at as Date | string | number,
		)
	for (const key of Object.keys(entity)) {
		const val = entity[key]
		if (val === null) {
			entity[key] = undefined
		} else if (isBuffer(val)) {
			entity[key] = Array.from(val as Uint8Array)
		}
	}
	return entity
}

function validateDate(date: Date | string | number): Date {
	return date instanceof Date ? date : new Date(date)
}

function isBuffer(val: unknown): boolean {
	if (val == null || typeof val !== 'object') return false
	const buf = (globalThis as { Buffer?: { isBuffer: (v: unknown) => boolean } })
		.Buffer
	return typeof buf?.isBuffer === 'function' && buf.isBuffer(val)
}

function attachLoggerIfRequested(
	ctx: DispatchContext,
	method: string,
	identity: ResolvedIdentity,
	params: unknown[],
): WalletLoggerInterface | undefined {
	if (!ctx.makeLogger) return undefined
	const arg1 = params[1]
	if (typeof arg1 !== 'object' || arg1 === null) return undefined
	const logger = ctx.makeLogger(
		(arg1 as { logger?: WalletLoggerInterface | string }).logger,
	)
	;(arg1 as { logger?: WalletLoggerInterface }).logger = logger
	logger.group?.(`wallet-server ${method}`)
	if (identity.userId) logger.log?.(`userId: ${identity.userId}`)
	logger.log?.(`identityKey: ${identity.identityKey}`)
	return logger
}

function attachLoggerTail(
	logger: WalletLoggerInterface | undefined,
	result: unknown,
): void {
	if (!logger) return
	logger.groupEnd?.()
	logger.flush?.()
	if (logger.isOrigin) return
	if (logger.logs && typeof result === 'object' && result !== null) {
		;(result as Record<string, unknown>).log = { logs: logger.logs }
	}
}

function methodNotFound(
	method: string,
	id: string | number | null,
): JsonRpcResponse {
	return {
		jsonrpc: '2.0',
		error: { code: -32601, message: `Method not found: ${method}` },
		id,
	}
}

function marshalError(
	err: unknown,
	id: string | number | null,
): JsonRpcResponse {
	const json = WalletError.unknownToJson(err)
	return {
		jsonrpc: '2.0',
		error: JSON.parse(json),
		id,
	}
}
