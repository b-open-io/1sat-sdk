export { createWalletRpcHandler } from './createWalletRpcHandler'
export type { WalletRpcHandler } from './createWalletRpcHandler'

export { createBearerServer } from './createBearerServer'
export type {
	BearerServerConfig,
	BearerServerHandle,
} from './createBearerServer'

export { createWalletServer } from './createWalletServer'
export type {
	WalletServerConfig,
	WalletServerHandle,
} from './createWalletServer'

export { WalletServerClient } from './client'
export { topUpStorage } from './topUp'
export type { TopUpResult } from './topUp'

export { BILLABLE_METHODS, dispatch, isBillableMethod } from './dispatch'
export type { DispatchContext, DispatchInput } from './dispatch'

export * from './resolvers'
export * from './accounts'

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
} from './types'

export type { WalletServerAccounts } from './createWalletServer'
export { createHostServer } from './createHostServer'
export type {
	HostServerConfig,
	HostServerHandle,
	HostServerMessageboxConfig,
} from './createHostServer'
export { mountPaymailRoutes } from './paymail/routes'
export { KnexPendingStore, DEFAULT_TTL_MS } from './paymail/pending'
export { checkHostingEntitlement } from './paymail/entitlement'
export type {
	PaymailDeps,
	PendingPayment,
	PendingStore,
	ResolvedBind,
} from './paymail/types'
export {
	mountHostingRoutes,
	type HostingConfig,
	type HostingConfigProvider,
} from './hosting/routes'
export {
	HostingClient,
	type HostingPrice,
	type HostingStatus,
	type HostingSubscribeResult,
} from './hosting/client'
export { buildOpenApiSpec, mountOpenApiRoutes } from './openapi'
export type { OpenApiOptions, OpenApiSurfaces } from './openapi'
export {
	RedisSessionManager,
	buildAuthMiddleware,
	createSessionRedis,
	wrapAuthWithSessionHydration,
} from './sessions/redisSessionManager'
export type {
	RedisSessionManagerOptions,
	SessionRedis,
	SessionStoreConfig,
} from './sessions/redisSessionManager'
