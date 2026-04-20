import { createWalletRpcHandler } from './createWalletRpcHandler'
import { bearerResolver } from './resolvers/bearer'
import type { WalletStorageProvider } from './types'

export interface BearerServerConfig {
	storage: WalletStorageProvider
	token: string
	port: number
	hostname?: string
	identityHeader?: string
	adminIdentityKeys?: string[]
}

export interface BearerServerHandle {
	port: number
	stop(): Promise<void>
}

/**
 * Bearer-only RPC server. Native Bun.serve, no Express, no BRC-100.
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

	const server = Bun.serve({
		port: config.port,
		hostname: config.hostname,
		fetch: handler,
	})

	return {
		port: server.port ?? config.port,
		async stop() {
			await server.stop()
		},
	}
}
