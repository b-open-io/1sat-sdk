import type { ElectrobunRPCSchema, RPCSchema } from "electrobun/view";

// Wallet status lifecycle
export type WalletStatus = "initializing" | "no-wallet" | "locked" | "unlocked";

// Balance info
export interface BalanceInfo {
	confirmed: number;
	unconfirmed: number;
}

// Receive address info
export interface ReceiveInfo {
	address: string;
}

// Sync event from wallet operations
export interface SyncEvent {
	timestamp: number;
	source: string;
	level: "log" | "warn" | "error";
	message: string;
}

// Send BSV params
export interface SendBsvParams {
	address: string;
	amount: number;
}

// Send BSV result
export interface SendBsvResult {
	txid: string;
}

// ---- RPC Schema ----
// Requests the webview can make to bun
type BunRequests = {
	createWallet: {
		params: { mnemonic: string; passphrase: string };
		response: { success: boolean; error?: string };
	};
	importWallet: {
		params: { mnemonic: string; passphrase: string };
		response: { success: boolean; error?: string };
	};
	unlockWallet: {
		params: { passphrase: string };
		response: { success: boolean; error?: string };
	};
	lockWallet: {
		params: undefined;
		response: { success: boolean };
	};
	generateMnemonic: {
		params: undefined;
		response: { mnemonic: string };
	};
	getBalance: {
		params: undefined;
		response: BalanceInfo;
	};
	getReceiveInfo: {
		params: undefined;
		response: ReceiveInfo;
	};
	sendBsv: {
		params: SendBsvParams;
		response: SendBsvResult;
	};
	getWalletStatus: {
		params: undefined;
		response: { status: WalletStatus };
	};
};

// Messages bun can send to the webview (push notifications)
type BunMessages = {
	walletStateChanged: { status: WalletStatus };
	balanceUpdated: BalanceInfo;
	syncEvent: SyncEvent;
};

// Requests bun can make to the webview (currently none)
type WebviewRequests = Record<never, never>;

// Messages webview can send to bun (currently none)
type WebviewMessages = Record<never, never>;

// Combined RPC schema
export interface WalletDesktopRPC extends ElectrobunRPCSchema {
	bun: RPCSchema<{
		requests: WebviewRequests;
		messages: WebviewMessages;
	}>;
	webview: RPCSchema<{
		requests: BunRequests;
		messages: BunMessages;
	}>;
}
