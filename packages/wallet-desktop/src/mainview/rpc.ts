import { Electroview } from "electrobun/view";
import type {
	BalanceInfo,
	SyncEvent,
	WalletDesktopRPC,
	WalletStatus,
} from "../shared/types";

// Pub/sub system for React hooks to subscribe to RPC messages
type Listener<T> = (data: T) => void;
type Unsubscribe = () => void;

const listeners = new Map<string, Set<Listener<unknown>>>();

function subscribe<T>(event: string, fn: Listener<T>): Unsubscribe {
	if (!listeners.has(event)) listeners.set(event, new Set());
	listeners.get(event)!.add(fn as Listener<unknown>);
	return () => {
		listeners.get(event)?.delete(fn as Listener<unknown>);
	};
}

function emit(event: string, data: unknown) {
	listeners.get(event)?.forEach((fn) => fn(data));
}

// Define the webview-side RPC with message handlers that emit to subscribers
const rpc = Electroview.defineRPC<WalletDesktopRPC>({
	maxRequestTime: 30_000,
	handlers: {
		messages: {
			walletStateChanged: (payload: { status: WalletStatus }) => {
				emit("walletStateChanged", payload);
			},
			balanceUpdated: (payload: BalanceInfo) => {
				emit("balanceUpdated", payload);
			},
			syncEvent: (payload: SyncEvent) => {
				emit("syncEvent", payload);
			},
		},
	},
});

// Create the Electroview instance which connects the RPC to the native transport
const electroview = new Electroview({ rpc });

// Convenience subscription functions for each message type
function onWalletStateChanged(
	fn: Listener<{ status: WalletStatus }>,
): Unsubscribe {
	return subscribe("walletStateChanged", fn);
}

function onBalanceUpdated(fn: Listener<BalanceInfo>): Unsubscribe {
	return subscribe("balanceUpdated", fn);
}

function onSyncEvent(fn: Listener<SyncEvent>): Unsubscribe {
	return subscribe("syncEvent", fn);
}

export {
	electroview,
	rpc,
	subscribe,
	onWalletStateChanged,
	onBalanceUpdated,
	onSyncEvent,
};
