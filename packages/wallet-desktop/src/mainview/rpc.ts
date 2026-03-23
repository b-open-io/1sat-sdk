import { Electroview } from 'electrobun/view'
import type {
	BalanceInfo,
	ChatMessage,
	OrdinalInfo,
	PermissionRequest,
	SyncEvent,
	WalletDesktopRPC,
	WalletStatus,
} from '../shared/types'

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

// Define the webview-side RPC with message handlers that emit to subscribers
const rpc = Electroview.defineRPC<WalletDesktopRPC>({
	maxRequestTime: 30_000,
	handlers: {
		messages: {
			walletStateChanged: (payload: { status: WalletStatus }) => {
				emit('walletStateChanged', payload)
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
		},
	},
})

// Create the Electroview instance which connects the RPC to the native transport
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
}
