import type { ElectrobunRPCSchema, RPCSchema } from 'electrobun/view'

// Wallet status lifecycle
export type WalletStatus = 'initializing' | 'no-wallet' | 'locked' | 'unlocked'

// Balance info
export interface BalanceInfo {
	confirmed: number
	unconfirmed: number
}

// Receive address info
export interface ReceiveInfo {
	address: string
}

// Sync event from wallet operations
export interface SyncEvent {
	timestamp: number
	source: string
	level: 'log' | 'warn' | 'error' | 'success'
	message: string
}

// Send BSV params
export interface SendBsvParams {
	address: string
	amount: number
}

// Send BSV result
export interface SendBsvResult {
	txid: string
}

// Ordinal info for display
export interface OrdinalInfo {
	outpoint: string
	tags: string[]
	satoshis: number
}

// Token balance info
export interface TokenBalance {
	id: string
	sym?: string
	icon?: string
	dec: number
	amt: string
}

// Transaction history entry
export interface HistoryEntry {
	txid: string
	description: string
	satoshis: number
	status: string
	dateCreated: string
}

// OpNS name info
export interface OpnsNameInfo {
	outpoint: string
	name: string
	tags: string[]
}

// Inscribe file params
export interface InscribeFileParams {
	base64Content: string
	contentType: string
	map?: Record<string, string>
}

// File read result from native file picker
export interface FileReadResult {
	base64Content: string
	contentType: string
	filename: string
	sizeBytes: number
}

// ---- RPC Schema ----
// Requests the webview can make to bun
type BunRequests = {
	createWallet: {
		params: { mnemonic: string; passphrase?: string }
		response: { success: boolean; error?: string }
	}
	importWallet: {
		params: { mnemonic: string; passphrase?: string }
		response: { success: boolean; error?: string }
	}
	unlockWallet: {
		params: { passphrase?: string }
		response: { success: boolean; error?: string }
	}
	lockWallet: {
		params: undefined
		response: { success: boolean }
	}
	deleteWallet: {
		params: undefined
		response: { success: boolean; error?: string }
	}
	generateMnemonic: {
		params: undefined
		response: { mnemonic: string }
	}
	getBalance: {
		params: undefined
		response: BalanceInfo
	}
	getReceiveInfo: {
		params: undefined
		response: ReceiveInfo
	}
	sendBsv: {
		params: SendBsvParams
		response: SendBsvResult
	}
	getWalletStatus: {
		params: undefined
		response: { status: WalletStatus }
	}
	getOrdinals: {
		params: { limit?: number; offset?: number }
		response: { ordinals: OrdinalInfo[] }
	}
	getTokenBalances: {
		params: undefined
		response: { balances: TokenBalance[] }
	}
	getTransactionHistory: {
		params: { limit?: number; offset?: number }
		response: { entries: HistoryEntry[] }
	}
	inscribeFile: {
		params: InscribeFileParams
		response: { txid?: string; error?: string }
	}
	getOpnsNames: {
		params: undefined
		response: { names: OpnsNameInfo[] }
	}
	pickFile: {
		params: { allowedFileTypes?: string }
		response: FileReadResult | { error: string }
	}
}

// Messages bun can send to the webview (push notifications)
type BunMessages = {
	walletStateChanged: { status: WalletStatus }
	balanceUpdated: BalanceInfo
	syncEvent: SyncEvent
	ordinalsUpdated: { ordinals: OrdinalInfo[] }
}

// Requests bun can make to the webview (currently none)
type WebviewRequests = Record<never, never>

// Messages webview can send to bun (currently none)
type WebviewMessages = Record<never, never>

// Combined RPC schema
// bun.requests = what the bun process handles (webview calls these)
// bun.messages = what the bun process receives as messages (webview sends these)
// webview.requests = what the webview handles (bun calls these)
// webview.messages = what the webview receives as messages (bun sends these)
export interface WalletDesktopRPC extends ElectrobunRPCSchema {
	bun: RPCSchema<{
		requests: BunRequests
		messages: WebviewMessages
	}>
	webview: RPCSchema<{
		requests: WebviewRequests
		messages: BunMessages
	}>
}
