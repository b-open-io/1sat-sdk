export { createWalletRpcHandler } from './createWalletRpcHandler.js'
export type { WalletRpcHandler } from './createWalletRpcHandler.js'

export { createBearerServer } from './createBearerServer.js'
export type {
	BearerServerConfig,
	BearerServerHandle,
} from './createBearerServer.js'

export { createWalletServer } from './createWalletServer.js'
export type {
	WalletServerConfig,
	WalletServerHandle,
} from './createWalletServer.js'

export { WalletServerClient } from './client.js'
export { topUpStorage } from './topUp.js'
export type { TopUpResult } from './topUp.js'

export { BILLABLE_METHODS, dispatch, isBillableMethod } from './dispatch.js'
export type { DispatchContext, DispatchInput } from './dispatch.js'

export * from './resolvers/index.js'
export * from './accounts/index.js'

export type {
	IdentityResolver,
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcResponseErr,
	JsonRpcResponseOk,
	PreDispatchContext,
	PreDispatchHook,
	PreDispatchResult,
	ResolvedIdentity,
	WalletRpcHandlerConfig,
	WalletStorageProvider,
} from './types.js'

export type { WalletServerAccounts } from './createWalletServer.js'
export { mountStorageV1 } from './v1.js'
export type { MountStorageV1Options } from './v1.js'
export { createHostServer } from './createHostServer.js'
export type {
	HostServerConfig,
	HostServerHandle,
	HostServerMessageboxConfig,
} from './createHostServer.js'
export { mountPaymailRoutes } from './paymail/routes.js'
export { KnexPendingStore, DEFAULT_TTL_MS } from './paymail/pending.js'
export { createAccountResolver } from './paymail/resolvers.js'
export type {
	PaymailDeps,
	PaymailResolver,
	PendingPayment,
	PendingStore,
	ResolvedBind,
} from './paymail/types.js'
export { buildOpenApiSpec, mountOpenApiRoutes } from './openapi/index.js'
export type { OpenApiOptions, OpenApiSurfaces } from './openapi/index.js'
export {
	RedisSessionManager,
	buildAuthMiddleware,
	createSessionRedis,
	wrapAuthWithSessionHydration,
} from './sessions/redisSessionManager.js'
export type {
	RedisSessionManagerOptions,
	SessionRedis,
	SessionStoreConfig,
} from './sessions/redisSessionManager.js'
