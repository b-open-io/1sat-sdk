import { useCallback, useEffect, useState } from "react";
import type {
	BalanceInfo,
	FileReadResult,
	HistoryEntry,
	InscribeFileParams,
	OpnsNameInfo,
	OrdinalInfo,
	ReceiveInfo,
	TokenBalance,
	WalletStatus,
} from "../../shared/types";
import { onBalanceUpdated, onWalletStateChanged, rpc } from "../rpc";

interface UseWalletReturn {
	status: WalletStatus;
	balance: BalanceInfo;
	createWallet: (mnemonic: string, passphrase: string) => Promise<{ success: boolean; error?: string }>;
	importWallet: (mnemonic: string, passphrase: string) => Promise<{ success: boolean; error?: string }>;
	unlockWallet: (passphrase: string) => Promise<{ success: boolean; error?: string }>;
	lockWallet: () => Promise<{ success: boolean }>;
	deleteWallet: () => Promise<{ success: boolean; error?: string }>;
	sendBsv: (address: string, amount: number) => Promise<{ txid: string }>;
	getReceiveInfo: () => Promise<ReceiveInfo>;
	generateMnemonic: () => Promise<string>;
	getOrdinals: (limit?: number, offset?: number) => Promise<{ ordinals: OrdinalInfo[] }>;
	getTokenBalances: () => Promise<{ balances: TokenBalance[] }>;
	getTransactionHistory: (limit?: number, offset?: number) => Promise<{ entries: HistoryEntry[] }>;
	inscribeFile: (params: InscribeFileParams) => Promise<{ txid?: string; error?: string }>;
	getOpnsNames: () => Promise<{ names: OpnsNameInfo[] }>;
	pickFile: (allowedFileTypes?: string) => Promise<FileReadResult | { error: string }>;
}

export function useWallet(): UseWalletReturn {
	const [status, setStatus] = useState<WalletStatus>("initializing");
	const [balance, setBalance] = useState<BalanceInfo>({
		confirmed: 0,
		unconfirmed: 0,
	});

	useEffect(() => {
		// Fetch initial wallet status
		rpc.request.getWalletStatus().then(
			(result) => setStatus(result.status),
			(err) => console.error("Failed to get wallet status:", err),
		);

		// Subscribe to wallet state changes
		const unsubState = onWalletStateChanged((payload) => {
			setStatus(payload.status);
		});

		// Subscribe to balance updates
		const unsubBalance = onBalanceUpdated((payload) => {
			setBalance(payload);
		});

		return () => {
			unsubState();
			unsubBalance();
		};
	}, []);

	// Fetch balance when wallet is unlocked
	useEffect(() => {
		if (status === "unlocked") {
			rpc.request.getBalance().then(
				(result) => setBalance(result),
				(err) => console.error("Failed to get balance:", err),
			);
		}
	}, [status]);

	const createWallet = useCallback(
		async (mnemonic: string, passphrase: string) => {
			return rpc.request.createWallet({ mnemonic, passphrase });
		},
		[],
	);

	const importWallet = useCallback(
		async (mnemonic: string, passphrase: string) => {
			return rpc.request.importWallet({ mnemonic, passphrase });
		},
		[],
	);

	const unlockWallet = useCallback(async (passphrase: string) => {
		return rpc.request.unlockWallet({ passphrase });
	}, []);

	const lockWallet = useCallback(async () => {
		return rpc.request.lockWallet();
	}, []);

	const deleteWallet = useCallback(async () => {
		return rpc.request.deleteWallet();
	}, []);

	const sendBsv = useCallback(async (address: string, amount: number) => {
		return rpc.request.sendBsv({ address, amount });
	}, []);

	const getReceiveInfo = useCallback(async () => {
		return rpc.request.getReceiveInfo();
	}, []);

	const generateMnemonic = useCallback(async () => {
		const result = await rpc.request.generateMnemonic();
		return result.mnemonic;
	}, []);

	const getOrdinals = useCallback(
		async (limit?: number, offset?: number) => {
			return rpc.request.getOrdinals({ limit, offset });
		},
		[],
	);

	const getTokenBalances = useCallback(async () => {
		return rpc.request.getTokenBalances();
	}, []);

	const getTransactionHistory = useCallback(
		async (limit?: number, offset?: number) => {
			return rpc.request.getTransactionHistory({ limit, offset });
		},
		[],
	);

	const inscribeFile = useCallback(async (params: InscribeFileParams) => {
		return rpc.request.inscribeFile(params);
	}, []);

	const getOpnsNames = useCallback(async () => {
		return rpc.request.getOpnsNames();
	}, []);

	const pickFile = useCallback(async (allowedFileTypes?: string) => {
		return rpc.request.pickFile({ allowedFileTypes });
	}, []);

	return {
		status,
		balance,
		createWallet,
		importWallet,
		unlockWallet,
		lockWallet,
		deleteWallet,
		sendBsv,
		getReceiveInfo,
		generateMnemonic,
		getOrdinals,
		getTokenBalances,
		getTransactionHistory,
		inscribeFile,
		getOpnsNames,
		pickFile,
	};
}
