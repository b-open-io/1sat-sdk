import type { MakeWalletLogger, WalletLoggerInterface } from '@bsv/sdk'
import type { sdk as walletSdk } from '@bsv/wallet-toolbox'

export type WalletStorageProvider = walletSdk.WalletStorageProvider

export interface ResolvedIdentity {
	identityKey: string
	userId?: number
}

export type IdentityResolver = (req: Request) => Promise<ResolvedIdentity>

export interface PreDispatchContext {
	method: string
	identity: ResolvedIdentity
	request: Request
	id: string | number | null
}

export type PreDispatchResult =
	| { type: 'allow' }
	| { type: 'blocked'; response: Response }

export type PreDispatchHook = (
	ctx: PreDispatchContext,
) => Promise<PreDispatchResult>

export interface WalletRpcHandlerConfig {
	storage: WalletStorageProvider
	resolveIdentity: IdentityResolver
	adminIdentityKeys?: string[]
	makeLogger?: MakeWalletLogger
	/** Optional gate that runs after identity resolution and before dispatch. */
	preDispatch?: PreDispatchHook
}

export interface JsonRpcRequest {
	jsonrpc: '2.0'
	method: string
	params?: unknown[]
	id?: string | number | null
}

export interface JsonRpcResponseOk {
	jsonrpc: '2.0'
	result: unknown
	id: string | number | null
}

export interface JsonRpcResponseErr {
	jsonrpc: '2.0'
	error: { code: number; message: string; data?: unknown }
	id: string | number | null
}

export type JsonRpcResponse = JsonRpcResponseOk | JsonRpcResponseErr

export type { MakeWalletLogger, WalletLoggerInterface }
