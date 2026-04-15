import { Electroview } from 'electrobun/view'
import type {
	AccountInfo,
	BalanceInfo,
	ChatMessage,
	OrdinalInfo,
	PermissionRequest,
	SyncEvent,
	UpdateStatusPayload,
	WalletDesktopRPC,
	WalletStatus,
} from '../shared/types'
import { getBrowserController } from './lib/browser-controller'

// Pub/sub system for React hooks to subscribe to RPC messages
type Listener<T> = (data: T) => void
type Unsubscribe = () => void

const listeners = new Map<string, Set<Listener<unknown>>>()

function subscribe<T>(event: string, fn: Listener<T>): Unsubscribe {
	if (!listeners.has(event)) listeners.set(event, new Set())
	listeners.get(event)!.add(fn as Listener<unknown>)
	return () => {
		listeners.get(event)?.delete(fn as Listener<unknown>)
	}
}

function emit(event: string, data: unknown) {
	const fns = listeners.get(event)
	if (fns) {
		for (const fn of fns) {
			fn(data)
		}
	}
}

// Define the webview-side RPC with request + message handlers
const rpc = Electroview.defineRPC<WalletDesktopRPC>({
	maxRequestTime: 30_000,
	handlers: {
		requests: {
			tabList: () => {
				const ctrl = getBrowserController()
				if (!ctrl) return { tabs: [] }
				return { tabs: ctrl.listTabs() }
			},
			tabCreate: ({ url }: { url?: string }) => {
				const ctrl = getBrowserController()
				if (ctrl) return { tabId: ctrl.createTab(url) }
				// Browser not mounted — navigate the app to it with the URL
				emit('navigateToUrl', { url: url ?? '1sat://browser/new' })
				return { tabId: 'pending' }
			},
			tabClose: ({ tabId }: { tabId: string }) => {
				const ctrl = getBrowserController()
				if (!ctrl) return { success: false }
				return { success: ctrl.closeTab(tabId) }
			},
			tabNavigate: ({ tabId, url }: { tabId: string; url: string }) => {
				const ctrl = getBrowserController()
				if (!ctrl) return { success: false }
				return { success: ctrl.navigateTab(tabId, url) }
			},
			tabActivate: ({ tabId }: { tabId: string }) => {
				const ctrl = getBrowserController()
				if (!ctrl) return { success: false }
				return { success: ctrl.activateTab(tabId) }
			},
			tabGoBack: ({ tabId }: { tabId: string }) => {
				const ctrl = getBrowserController()
				if (!ctrl) return { success: false }
				return { success: ctrl.goBack(tabId) }
			},
			tabGoForward: ({ tabId }: { tabId: string }) => {
				const ctrl = getBrowserController()
				if (!ctrl) return { success: false }
				return { success: ctrl.goForward(tabId) }
			},
			tabReload: ({ tabId }: { tabId: string }) => {
				const ctrl = getBrowserController()
				if (!ctrl) return { success: false }
				return { success: ctrl.reload(tabId) }
			},
			mainviewEval: ({ code }: { code: string }) => {
				try {
					const fn = new Function(code)
					const raw = fn()
					const result =
						raw === undefined || raw === null
							? String(raw)
							: typeof raw === 'string'
								? raw
								: JSON.stringify(raw, null, 2)
					return { result }
				} catch (err) {
					return {
						result: '',
						error: err instanceof Error ? err.message : String(err),
					}
				}
			},
			mainviewGetUrl: () => {
				return { url: window.location.href }
			},
		},
		messages: {
			walletStateChanged: (payload: { status: WalletStatus }) => {
				emit('walletStateChanged', payload)
			},
			accountsLoaded: (payload: { accounts: AccountInfo[] }) => {
				emit('accountsLoaded', payload)
			},
			activeAccountChanged: (payload: {
				accountId: string
				account: AccountInfo
			}) => {
				emit('activeAccountChanged', payload)
			},
			balanceUpdated: (payload: BalanceInfo) => {
				emit('balanceUpdated', payload)
			},
			syncEvent: (payload: SyncEvent) => {
				emit('syncEvent', payload)
			},
			ordinalsUpdated: (payload: { ordinals: OrdinalInfo[] }) => {
				emit('ordinalsUpdated', payload)
			},
			permissionRequest: (payload: PermissionRequest) => {
				emit('permissionRequest', payload)
			},
			chatMessageReceived: (payload: ChatMessage) => {
				emit('chatMessageReceived', payload)
			},
			stackOnboardingRequired: (payload: { adminUrl: string }) => {
				emit('stackOnboardingRequired', payload)
			},
			stackOnboardingComplete: (_payload: Record<string, never>) => {
				emit('stackOnboardingComplete', {})
			},
			navigateToUrl: (payload: { url: string }) => {
				emit('navigateToUrl', payload)
			},
			toggleSyncLog: (_payload: Record<string, never>) => {
				emit('toggleSyncLog', {})
			},
			menuAction: (payload: { action: string }) => {
				emit('menuAction', payload)
			},
			updateStatus: (payload: UpdateStatusPayload) => {
				emit('updateStatus', payload)
			},
		},
	},
})

// Create the Electroview instance — registers the electrobun-webview custom element
// and connects the RPC to the native transport
const electroview = new Electroview({ rpc })

// Convenience subscription functions for each message type
function onWalletStateChanged(
	fn: Listener<{ status: WalletStatus }>,
): Unsubscribe {
	return subscribe('walletStateChanged', fn)
}

function onBalanceUpdated(fn: Listener<BalanceInfo>): Unsubscribe {
	return subscribe('balanceUpdated', fn)
}

function onSyncEvent(fn: Listener<SyncEvent>): Unsubscribe {
	return subscribe('syncEvent', fn)
}

function onOrdinalsUpdated(
	fn: Listener<{ ordinals: OrdinalInfo[] }>,
): Unsubscribe {
	return subscribe('ordinalsUpdated', fn)
}

function onPermissionRequest(fn: Listener<PermissionRequest>): Unsubscribe {
	return subscribe('permissionRequest', fn)
}

function onChatMessageReceived(fn: Listener<ChatMessage>): Unsubscribe {
	return subscribe('chatMessageReceived', fn)
}

function onStackOnboardingRequired(
	fn: Listener<{ adminUrl: string }>,
): Unsubscribe {
	return subscribe('stackOnboardingRequired', fn)
}

function onStackOnboardingComplete(
	fn: Listener<Record<string, never>>,
): Unsubscribe {
	return subscribe('stackOnboardingComplete', fn)
}

function onNavigateToUrl(fn: Listener<{ url: string }>): Unsubscribe {
	return subscribe('navigateToUrl', fn)
}

function onToggleSyncLog(fn: Listener<Record<string, never>>): Unsubscribe {
	return subscribe('toggleSyncLog', fn)
}

function onMenuAction(fn: Listener<{ action: string }>): Unsubscribe {
	return subscribe('menuAction', fn)
}

function onUpdateStatus(fn: Listener<UpdateStatusPayload>): Unsubscribe {
	return subscribe('updateStatus', fn)
}

function onAccountsLoaded(
	fn: Listener<{ accounts: AccountInfo[] }>,
): Unsubscribe {
	return subscribe('accountsLoaded', fn)
}

function onActiveAccountChanged(
	fn: Listener<{ accountId: string; account: AccountInfo }>,
): Unsubscribe {
	return subscribe('activeAccountChanged', fn)
}

export {
	electroview,
	rpc,
	subscribe,
	onWalletStateChanged,
	onBalanceUpdated,
	onSyncEvent,
	onOrdinalsUpdated,
	onPermissionRequest,
	onChatMessageReceived,
	onStackOnboardingRequired,
	onStackOnboardingComplete,
	onNavigateToUrl,
	onToggleSyncLog,
	onUpdateStatus,
	onMenuAction,
	onAccountsLoaded,
	onActiveAccountChanged,
}
