export { WalletServerClient } from './client.js'
export { topUpStorage } from './topUp.js'
export type { TopUpResult } from './topUp.js'

export * from './accounts/index.js'

export type { WalletStorageProvider } from './types.js'

export { createHostServer } from './createHostServer.js'
export type {
	HostServerConfig,
	HostServerHandle,
	HostServerMessageboxConfig,
} from './createHostServer.js'
export { createStorageServer } from './createStorageServer.js'
export type { StorageServerConfig } from './createStorageServer.js'
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
	createSessionManager,
	createSessionRedis,
} from './sessions/redisSessionManager.js'
export type {
	RedisSessionManagerOptions,
	SessionRedis,
	SessionStoreConfig,
} from './sessions/redisSessionManager.js'
export {
	WALLET_METHODS,
	walletMethodSet,
	NO_ARG_METHODS,
} from './brc100/methods.js'
export type { WalletMethod } from './brc100/methods.js'
export {
	createBRC100Router,
	defaultParseOrigin,
} from './brc100/router.js'
export type {
	BRC100WalletHandle,
	BRC100RouterConfig,
} from './brc100/router.js'
export { startBRC100Server } from './brc100/server.js'
export type { BRC100ServerHandle } from './brc100/server.js'
