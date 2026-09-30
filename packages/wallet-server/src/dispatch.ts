import { createRequire } from 'node:module'
import type {
	TableProvenTx,
	StorageProvider as ToolboxStorage,
	sdk,
} from '@bsv/wallet-toolbox'
import {
	WERR_INTERNAL,
	WERR_NOT_ACTIVE,
	WERR_UNAUTHORIZED,
	WalletError,
} from '@bsv/wallet-toolbox/out/src/sdk'
import { enforceRpcBudgets } from './rpcBudgets.js'
import type {
	JsonRpcResponse,
	MakeWalletLogger,
	ResolvedIdentity,
	WalletLoggerInterface,
	WalletStorageProvider,
} from './types.js'

export interface DispatchContext {
	storage: WalletStorageProvider
	adminIdentityKeys?: string[]
	makeLogger?: MakeWalletLogger
	/**
	 * Receives the original error before it is reduced to its public form.
	 * Clients only see WalletError subclasses; internal errors become WERR_INTERNAL.
	 */
	onError?: (err: unknown, method: string) => void
}

// The toolbox's RPC-side sync validators are not re-exported from its entry
// points; its exports map serves ./out/src/* to require() only.
const toolboxRequire = createRequire(import.meta.url)
const { validateSyncChunkEntities } = toolboxRequire(
	'@bsv/wallet-toolbox/out/src/storage/remoting/entityValidationHelpers',
) as { validateSyncChunkEntities: (chunk: sdk.SyncChunk) => sdk.SyncChunk }
const { validateSyncProofs } = toolboxRequire(
	'@bsv/wallet-toolbox/out/src/storage/remoting/validateRpcSyncProofs',
) as {
	validateSyncProofs: (
		storage: ToolboxStorage,
		candidates: TableProvenTx[],
	) => Promise<void>
}

/** dbtype values a toolbox client accepts in remote settings. */
const CLIENT_DBTYPES: ReadonlySet<string> = new Set([
	'SQLite',
	'MySQL',
	'IndexedDB',
])

export interface DispatchInput {
	method: string
	params: unknown[]
	id: string | number | null
	identity: ResolvedIdentity
}

/**
 * The storage methods a remote client may call. Mirrors wallet-toolbox
 * StorageServer's `storageRpcMethods` (2.14.4); anything else is "method not
 * found", whatever the storage object exposes.
 */
const STORAGE_RPC_METHODS: ReadonlySet<string> = new Set([
	'abortAction',
	'abortActionBatch',
	'activateNoSendExpiry',
	'armNoSendExpiry',
	'adminStats',
	'beginActionBatch',
	'commitActionBatch',
	'commitActionBatchByDigest',
	'createAction',
	'destroy',
	'extendActionBatch',
	'findCertificatesAuth',
	'findOrInsertSyncStateAuth',
	'getSyncCheckpoint',
	'findOrInsertUser',
	'findOutputBaskets',
	'findOutputBasketsAuth',
	'findOutputsAuth',
	'findProvenTxReqs',
	'getCapabilities',
	'getSettings',
	'getSyncChunk',
	'insertCertificateAuth',
	'internalizeAction',
	'listActions',
	'listCertificates',
	'listOutputs',
	'makeAvailable',
	'migrate',
	'prepareActionBatchCommit',
	'prepareNoSendExpiry',
	'processAction',
	'processSyncChunk',
	'relinquishCertificate',
	'relinquishOutput',
	'renewActionBatch',
	'resumeActionBatch',
	'setActive',
	'updateProvenTxReqWithNewProvenTx',
])

/**
 * Methods whose first argument is an AuthId. It is rebuilt from the
 * authenticated identity; client-supplied userId/isActive are not trusted.
 * Mirrors the toolbox's `authIdRpcMethods`.
 */
const AUTH_ID_METHODS: ReadonlySet<string> = new Set([
	'abortAction',
	'abortActionBatch',
	'activateNoSendExpiry',
	'armNoSendExpiry',
	'beginActionBatch',
	'commitActionBatch',
	'commitActionBatchByDigest',
	'createAction',
	'extendActionBatch',
	'findCertificatesAuth',
	'findOrInsertSyncStateAuth',
	'getSyncCheckpoint',
	'findOutputBaskets',
	'findOutputBasketsAuth',
	'findOutputsAuth',
	'insertCertificateAuth',
	'internalizeAction',
	'listActions',
	'listCertificates',
	'listOutputs',
	'prepareActionBatchCommit',
	'prepareNoSendExpiry',
	'processAction',
	'relinquishCertificate',
	'relinquishOutput',
	'renewActionBatch',
	'resumeActionBatch',
	'setActive',
])

/** AuthId methods that require this store to be the user's active storage (toolbox `activeStorageRpcMethods`). */
const ACTIVE_STORAGE_METHODS: ReadonlySet<string> = new Set([
	'abortActionBatch',
	'activateNoSendExpiry',
	'armNoSendExpiry',
	'beginActionBatch',
	'commitActionBatch',
	'commitActionBatchByDigest',
	'extendActionBatch',
	'prepareActionBatchCommit',
	'prepareNoSendExpiry',
	'renewActionBatch',
	'resumeActionBatch',
	'updateProvenTxReqWithNewProvenTx',
])

/** RPC methods served by the user-scoped storage method rather than the unscoped one. */
const AUTH_SCOPED_TARGETS: Readonly<Record<string, string>> = {
	findOutputBaskets: 'findOutputBasketsAuth',
	findProvenTxReqs: 'findProvenTxReqsAuth',
	updateProvenTxReqWithNewProvenTx: 'updateProvenTxReqWithNewProvenTxAuth',
}

const METHODS_NO_AUTH = new Set(['getSettings'])
const METHODS_IGNORED = new Set(['destroy', 'migrate'])
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

	if (!STORAGE_RPC_METHODS.has(method)) {
		return methodNotFound(method, id)
	}
	const target = AUTH_SCOPED_TARGETS[method] ?? method
	if (typeof storage[target] !== 'function') {
		return methodNotFound(method, id)
	}

	if (METHODS_IGNORED.has(method)) {
		return { jsonrpc: '2.0', result: null, id }
	}

	try {
		enforceRpcBudgets(method, input.params)
		const preparedParams = await prepareParams(ctx, input)

		const logger = attachLoggerIfRequested(
			ctx,
			method,
			input.identity,
			preparedParams,
		)

		try {
			let result = await storage[target](...preparedParams)
			if (method === 'makeAvailable' || method === 'getSettings') {
				result = settingsForWire(result as Record<string, unknown>, storage)
			}
			attachLoggerTail(logger, result)
			return { jsonrpc: '2.0', result: result ?? null, id }
		} catch (err) {
			logger?.flush?.()
			throw err
		}
	} catch (err) {
		ctx.onError?.(err, method)
		return marshalError(err, id)
	}
}

/**
 * Settings as a toolbox client expects them. Engine-specific dbtype values
 * (StoragePg stores 'Postgres') are omitted rather than rejected by the
 * client, and the compact sync checkpoint is advertised when the engine has
 * it, as the toolbox StorageServer does. The persisted settings are unchanged.
 */
function settingsForWire(
	settings: Record<string, unknown>,
	storage: Record<string, unknown>,
): Record<string, unknown> {
	const { dbtype, ...rest } = settings
	return {
		...rest,
		...(typeof dbtype === 'string' && CLIENT_DBTYPES.has(dbtype)
			? { dbtype }
			: {}),
		...(typeof storage.getSyncCheckpoint === 'function'
			? { syncCheckpointVersion: 1 }
			: {}),
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

	if (method in AUTH_SCOPED_TARGETS && !AUTH_ID_METHODS.has(method)) {
		const auth = await authenticatedAuth(
			ctx,
			identity,
			ACTIVE_STORAGE_METHODS.has(method),
		)
		return [auth, params[0]]
	}

	if (AUTH_ID_METHODS.has(method)) {
		await bindAuthenticatedAuth(
			ctx,
			identity,
			params,
			ACTIVE_STORAGE_METHODS.has(method),
		)
		return params
	}

	await applyParam0Auth(ctx, identity, params)

	if (method === 'processSyncChunk') {
		const chunk = validateSyncChunkEntities(params[1] as sdk.SyncChunk)
		await validateSyncProofs(
			ctx.storage as unknown as ToolboxStorage,
			chunk.provenTxs ?? [],
		)
	}

	return params
}

async function authenticatedAuth(
	ctx: DispatchContext,
	identity: ResolvedIdentity,
	requireActive: boolean,
): Promise<{ identityKey: string; userId: number; isActive: boolean }> {
	const { user } = await ctx.storage.findOrInsertUser(identity.identityKey)
	const isActive =
		user.activeStorage != null &&
		user.activeStorage === ctx.storage.getSettings().storageIdentityKey
	if (requireActive && !isActive) {
		throw new WERR_NOT_ACTIVE(
			"this method requires the authenticated user's active storage provider",
		)
	}
	return { identityKey: identity.identityKey, userId: user.userId, isActive }
}

async function bindAuthenticatedAuth(
	ctx: DispatchContext,
	identity: ResolvedIdentity,
	params: unknown[],
	requireActive: boolean,
): Promise<void> {
	const claimed =
		typeof params[0] === 'object' && params[0] !== null
			? (params[0] as { identityKey?: string })
			: {}
	if (
		claimed.identityKey != null &&
		claimed.identityKey !== identity.identityKey
	) {
		throw new WERR_UNAUTHORIZED('identityKey does not match authentication')
	}
	const auth = await authenticatedAuth(ctx, identity, requireActive)
	params[0] = { ...claimed, ...auth, reqAuthUserId: auth.userId }
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
	if (arg0.identityKey || arg0.userId != null) {
		arg0.userId = user.userId
	}
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
	const json =
		err instanceof WalletError &&
		err.name !== 'WERR_INTERNAL' &&
		err.name !== 'WERR_UNKNOWN'
			? WalletError.unknownToJson(err)
			: WalletError.unknownToJson(new WERR_INTERNAL())
	return {
		jsonrpc: '2.0',
		error: JSON.parse(json),
		id,
	}
}
