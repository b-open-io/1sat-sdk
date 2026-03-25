import { useCallback, useEffect, useState } from 'react'
import type {
	AccountInfo,
	BalanceInfo,
	CreateSocialPostParams,
	FileReadResult,
	HistoryEntry,
	IdentityInfo,
	InscribeFileParams,
	LockBsvParams,
	LockDataInfo,
	LockResult,
	MintCollectionItemParams,
	MintCollectionItemResult,
	MintCollectionParams,
	MintCollectionResult,
	OpnsNameInfo,
	OpnsOperationParams,
	OpnsOperationResult,
	OrdinalInfo,
	PublishIdentityResult,
	ReceiveInfo,
	SendBsv21Params,
	SendBsv21Result,
	SocialPostResult,
	SweepResultInfo,
	SweepScanResult,
	TokenBalance,
	WalletStatus,
} from '../../shared/types'
import {
	onAccountsLoaded,
	onActiveAccountChanged,
	onBalanceUpdated,
	onWalletStateChanged,
	rpc,
} from '../rpc'

interface UseWalletReturn {
	status: WalletStatus
	balance: BalanceInfo
	accounts: AccountInfo[]
	activeAccount: AccountInfo | null
	// Account management
	selectAccount: (accountId: string) => Promise<{ success: boolean; error?: string }>
	createAccount: (mnemonic: string, opts?: { passphrase?: string; displayName?: string; color?: string }) => Promise<{ success: boolean; accountId?: string; error?: string }>
	importAccount: (mnemonic: string, opts?: { passphrase?: string; displayName?: string; color?: string }) => Promise<{ success: boolean; accountId?: string; error?: string }>
	switchAccount: (accountId: string) => Promise<{ success: boolean; error?: string }>
	deleteAccount: (accountId: string) => Promise<{ success: boolean; error?: string }>
	// Wallet lifecycle
	lockWallet: () => Promise<{ success: boolean }>
	sendBsv: (address: string, amount: number) => Promise<{ txid: string }>
	getReceiveInfo: () => Promise<ReceiveInfo>
	generateMnemonic: () => Promise<string>
	getOrdinals: (
		limit?: number,
		offset?: number,
	) => Promise<{ ordinals: OrdinalInfo[] }>
	getTokenBalances: () => Promise<{ balances: TokenBalance[] }>
	getTransactionHistory: (
		limit?: number,
		offset?: number,
	) => Promise<{ entries: HistoryEntry[] }>
	inscribeFile: (
		params: InscribeFileParams,
	) => Promise<{ txid?: string; error?: string }>
	getOpnsNames: () => Promise<{ names: OpnsNameInfo[] }>
	pickFile: (
		allowedFileTypes?: string,
	) => Promise<FileReadResult | { error: string }>
	getLockData: () => Promise<LockDataInfo>
	lockBsv: (params: LockBsvParams) => Promise<LockResult>
	unlockBsv: () => Promise<LockResult>
	sendBsv21: (params: SendBsv21Params) => Promise<SendBsv21Result>
	sweepScan: (wif: string) => Promise<SweepScanResult>
	sweepBsv: (wif: string, assets: SweepScanResult) => Promise<SweepResultInfo>
	createSocialPost: (params: CreateSocialPostParams) => Promise<SocialPostResult>
	getIdentity: () => Promise<IdentityInfo>
	publishIdentity: () => Promise<PublishIdentityResult>
	opnsRegister: (params: OpnsOperationParams) => Promise<OpnsOperationResult>
	opnsDeregister: (params: OpnsOperationParams) => Promise<OpnsOperationResult>
	mintCollection: (params: MintCollectionParams) => Promise<MintCollectionResult>
	mintCollectionItem: (params: MintCollectionItemParams) => Promise<MintCollectionItemResult>
}

export function useWallet(): UseWalletReturn {
	const [status, setStatus] = useState<WalletStatus>('initializing')
	const [balance, setBalance] = useState<BalanceInfo>({
		confirmed: 0,
		unconfirmed: 0,
	})
	const [accounts, setAccounts] = useState<AccountInfo[]>([])
	const [activeAccount, setActiveAccount] = useState<AccountInfo | null>(null)

	useEffect(() => {
		// Fetch initial wallet status
		rpc.request.getWalletStatus().then(
			(result) => setStatus(result.status),
			(err) => console.error('Failed to get wallet status:', err),
		)

		// Subscribe to wallet state changes
		const unsubState = onWalletStateChanged((payload) => {
			setStatus(payload.status)
		})

		// Subscribe to balance updates
		const unsubBalance = onBalanceUpdated((payload) => {
			setBalance(payload)
		})

		// Subscribe to account list updates
		const unsubAccounts = onAccountsLoaded((payload) => {
			setAccounts(payload.accounts)
		})

		// Subscribe to active account changes
		const unsubActive = onActiveAccountChanged((payload) => {
			setActiveAccount(payload.account)
		})

		return () => {
			unsubState()
			unsubBalance()
			unsubAccounts()
			unsubActive()
		}
	}, [])

	// Fetch balance and active account when wallet is unlocked
	useEffect(() => {
		if (status === 'unlocked') {
			rpc.request.getBalance().then(
				(result) => setBalance(result),
				(err) => console.error('Failed to get balance:', err),
			)
			rpc.request.getActiveAccount().then(
				(result) => setActiveAccount(result.account),
				(err) => console.error('Failed to get active account:', err),
			)
		}
	}, [status])

	const selectAccount = useCallback(async (accountId: string) => {
		return rpc.request.selectAccount({ accountId })
	}, [])

	const createAccount = useCallback(
		async (mnemonic: string, opts?: { passphrase?: string; displayName?: string; color?: string }) => {
			return rpc.request.createAccount({ mnemonic, ...opts })
		},
		[],
	)

	const importAccount = useCallback(
		async (mnemonic: string, opts?: { passphrase?: string; displayName?: string; color?: string }) => {
			return rpc.request.importAccount({ mnemonic, ...opts })
		},
		[],
	)

	const switchAccountAction = useCallback(async (accountId: string) => {
		return rpc.request.switchAccount({ accountId })
	}, [])

	const lockWallet = useCallback(async () => {
		return rpc.request.lockWallet()
	}, [])

	const deleteAccount = useCallback(async (accountId: string) => {
		return rpc.request.deleteAccount({ accountId })
	}, [])

	const sendBsv = useCallback(async (address: string, amount: number) => {
		return rpc.request.sendBsv({ address, amount })
	}, [])

	const getReceiveInfo = useCallback(async () => {
		return rpc.request.getReceiveInfo()
	}, [])

	const generateMnemonic = useCallback(async () => {
		const result = await rpc.request.generateMnemonic()
		return result.mnemonic
	}, [])

	const getOrdinals = useCallback(async (limit?: number, offset?: number) => {
		return rpc.request.getOrdinals({ limit, offset })
	}, [])

	const getTokenBalances = useCallback(async () => {
		return rpc.request.getTokenBalances()
	}, [])

	const getTransactionHistory = useCallback(
		async (limit?: number, offset?: number) => {
			return rpc.request.getTransactionHistory({ limit, offset })
		},
		[],
	)

	const inscribeFile = useCallback(async (params: InscribeFileParams) => {
		return rpc.request.inscribeFile(params)
	}, [])

	const getOpnsNames = useCallback(async () => {
		return rpc.request.getOpnsNames()
	}, [])

	const pickFile = useCallback(async (allowedFileTypes?: string) => {
		return rpc.request.pickFile({ allowedFileTypes })
	}, [])

	const getLockData = useCallback(async () => {
		return rpc.request.getLockData()
	}, [])

	const lockBsvAction = useCallback(async (params: LockBsvParams) => {
		return rpc.request.lockBsv(params)
	}, [])

	const unlockBsvAction = useCallback(async () => {
		return rpc.request.unlockBsv()
	}, [])

	const sendBsv21Action = useCallback(async (params: SendBsv21Params) => {
		return rpc.request.sendBsv21(params)
	}, [])

	const sweepScan = useCallback(async (wif: string) => {
		return rpc.request.sweepScan({ wif })
	}, [])

	const sweepBsvAction = useCallback(
		async (wif: string, assets: SweepScanResult) => {
			return rpc.request.sweepBsv({ wif, assets })
		},
		[],
	)

	const createSocialPostAction = useCallback(
		async (params: CreateSocialPostParams) => {
			return rpc.request.createSocialPost(params)
		},
		[],
	)

	const getIdentity = useCallback(async () => {
		return rpc.request.getIdentity()
	}, [])

	const publishIdentityAction = useCallback(async () => {
		return rpc.request.publishIdentity()
	}, [])

	const opnsRegister = useCallback(async (params: OpnsOperationParams) => {
		return rpc.request.opnsRegister(params)
	}, [])

	const opnsDeregister = useCallback(async (params: OpnsOperationParams) => {
		return rpc.request.opnsDeregister(params)
	}, [])

	const mintCollectionAction = useCallback(
		async (params: MintCollectionParams) => {
			return rpc.request.mintCollection(params)
		},
		[],
	)

	const mintCollectionItemAction = useCallback(
		async (params: MintCollectionItemParams) => {
			return rpc.request.mintCollectionItem(params)
		},
		[],
	)

	return {
		status,
		balance,
		accounts,
		activeAccount,
		selectAccount,
		createAccount,
		importAccount,
		switchAccount: switchAccountAction,
		deleteAccount,
		lockWallet,
		sendBsv,
		getReceiveInfo,
		generateMnemonic,
		getOrdinals,
		getTokenBalances,
		getTransactionHistory,
		inscribeFile,
		getOpnsNames,
		pickFile,
		getLockData,
		lockBsv: lockBsvAction,
		unlockBsv: unlockBsvAction,
		sendBsv21: sendBsv21Action,
		sweepScan,
		sweepBsv: sweepBsvAction,
		createSocialPost: createSocialPostAction,
		getIdentity,
		publishIdentity: publishIdentityAction,
		opnsRegister,
		opnsDeregister,
		mintCollection: mintCollectionAction,
		mintCollectionItem: mintCollectionItemAction,
	}
}
