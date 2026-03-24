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
	isOutgoing: boolean
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

// Lock data summary
export interface LockDataInfo {
	totalLocked: number
	unlockable: number
	nextUnlock: number
}

// Lock BSV params
export interface LockBsvParams {
	satoshis: number
	until: number
}

// Lock/Unlock result
export interface LockResult {
	txid?: string
	error?: string
}

// Send BSV21 params
export interface SendBsv21Params {
	tokenId: string
	amount: string
	address: string
}

// Send BSV21 result
export interface SendBsv21Result {
	txid?: string
	error?: string
}

// Sweep scan result
export interface SweepScanResult {
	funding: Array<{
		outpoint: string
		satoshis: number
		lockingScript: string
	}>
	ordinals: Array<{
		outpoint: string
		satoshis: number
		lockingScript: string
		contentType?: string
		name?: string
	}>
	tokens: Array<{
		tokenId: string
		symbol?: string
		utxos: Array<{
			outpoint: string
			satoshis: number
			lockingScript: string
			amount: string
		}>
	}>
	totalSats: number
}

// Sweep result
export interface SweepResultInfo {
	txid?: string
	error?: string
}

// Chat message from BMAP API
export interface ChatMessage {
	txid: string
	content: string
	channel: string
	author: string
	authorName?: string
	timestamp: number
	encrypted: boolean
}

// Social post params
export interface CreateSocialPostParams {
	content: string
}

// Social post result
export interface SocialPostResult {
	txid?: string
	error?: string
}

// Identity info
export interface IdentityInfo {
	bapId: string | null
	profile: Record<string, unknown> | null
}

// Publish identity result
export interface PublishIdentityResult {
	txid?: string
	bapId?: string
	error?: string
}

// OpNS register/deregister params
export interface OpnsOperationParams {
	outpoint: string
}

// OpNS operation result
export interface OpnsOperationResult {
	txid?: string
	error?: string
}

// File read result from native file picker
export interface FileReadResult {
	base64Content: string
	contentType: string
	filename: string
	sizeBytes: number
}

// Mint collection params
export interface MintCollectionParams {
	base64Content: string
	contentType: string
	name: string
	description: string
	quantity: number
	traits?: Record<string, { values: string[]; occurancePercentages: string[] }>
	rarityLabels?: Array<Record<string, string>>
	royalties?: Array<{ type: string; destination: string; percentage: string }>
	app?: string
}

// Mint collection result
export interface MintCollectionResult {
	txid?: string
	collectionId?: string
	error?: string
}

// Mint collection item params
export interface MintCollectionItemParams {
	base64Content: string
	contentType: string
	name: string
	collectionId: string
	mintNumber?: number
	rank?: number
	traits?: Array<{ name: string; value: string }>
	app?: string
}

// Mint collection item result
export interface MintCollectionItemResult {
	txid?: string
	error?: string
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
	getLockData: {
		params: undefined
		response: LockDataInfo
	}
	lockBsv: {
		params: LockBsvParams
		response: LockResult
	}
	unlockBsv: {
		params: undefined
		response: LockResult
	}
	sendBsv21: {
		params: SendBsv21Params
		response: SendBsv21Result
	}
	sweepScan: {
		params: { wif: string }
		response: SweepScanResult
	}
	sweepBsv: {
		params: { wif: string; assets: SweepScanResult }
		response: SweepResultInfo
	}
	resolvePermission: {
		params: { requestId: string; approved: boolean; error?: string }
		response: { success: boolean }
	}
	createSocialPost: {
		params: CreateSocialPostParams
		response: SocialPostResult
	}
	getIdentity: {
		params: undefined
		response: IdentityInfo
	}
	publishIdentity: {
		params: undefined
		response: PublishIdentityResult
	}
	opnsRegister: {
		params: OpnsOperationParams
		response: OpnsOperationResult
	}
	opnsDeregister: {
		params: OpnsOperationParams
		response: OpnsOperationResult
	}
	mintCollection: {
		params: MintCollectionParams
		response: MintCollectionResult
	}
	mintCollectionItem: {
		params: MintCollectionItemParams
		response: MintCollectionItemResult
	}
	listOrdinal: {
		params: { outpoint: string; price: number }
		response: { txid?: string; error?: string }
	}
	cancelListing: {
		params: { outpoint: string }
		response: { txid?: string; error?: string }
	}
	purchaseOrdinal: {
		params: { outpoint: string }
		response: { txid?: string; error?: string }
	}
	purchaseBsv21: {
		params: { tokenId: string; outpoint: string; amount: string }
		response: { txid?: string; error?: string }
	}
	toggleDevTools: {
		params: undefined
		response: { success: boolean }
	}
	toggleMaximize: {
		params: undefined
		response: { success: boolean }
	}
	getStackStatus: {
		params: undefined
		response: { running: boolean; url: string }
	}
	openOrdfsContent: {
		params: { path: string }
		response: { success: boolean }
	}
	openBrowserWindow: {
		params: { url: string; title?: string }
		response: { success: boolean }
	}
	getChatMessages: {
		params: { channel: string; limit?: number }
		response: { messages: ChatMessage[] }
	}
	sendChatMessage: {
		params: { channel: string; content: string }
		response: { txid?: string; error?: string }
	}
	getChatChannels: {
		params: undefined
		response: { channels: string[] }
	}
	subscribeChatChannel: {
		params: { channel: string }
		response: { success: boolean }
	}
	unsubscribeChatChannel: {
		params: { channel: string }
		response: { success: boolean }
	}
}

// Permission request from BRC-100 HTTP server
export interface PermissionRequest {
	requestId: string
	method: string
	origin: string
	args: unknown
}

// Messages bun can send to the webview (push notifications)
type BunMessages = {
	walletStateChanged: { status: WalletStatus }
	balanceUpdated: BalanceInfo
	syncEvent: SyncEvent
	ordinalsUpdated: { ordinals: OrdinalInfo[] }
	permissionRequest: PermissionRequest
	chatMessageReceived: ChatMessage
	stackOnboardingRequired: { adminUrl: string }
	stackOnboardingComplete: {}
	navigateToUrl: { url: string }
	toggleSyncLog: {}
}

// Tab info for MCP browser automation
export interface TabInfo {
	id: string
	url: string
	title: string
}

// Requests bun can make to the webview (browser tab automation for MCP)
type WebviewRequests = {
	tabList: {
		params: undefined
		response: { tabs: TabInfo[] }
	}
	tabCreate: {
		params: { url?: string }
		response: { tabId: string }
	}
	tabClose: {
		params: { tabId: string }
		response: { success: boolean }
	}
	tabNavigate: {
		params: { tabId: string; url: string }
		response: { success: boolean }
	}
	tabActivate: {
		params: { tabId: string }
		response: { success: boolean }
	}
	tabGoBack: {
		params: { tabId: string }
		response: { success: boolean }
	}
	tabGoForward: {
		params: { tabId: string }
		response: { success: boolean }
	}
	tabReload: {
		params: { tabId: string }
		response: { success: boolean }
	}
}

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
