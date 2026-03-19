import {
	type AvailableProvider,
	type ConnectWalletResult,
	type WalletProviderConfig,
	connectWallet,
	getAvailableProviders,
} from '@1sat/connect'
import type { WalletInterface } from '@bsv/sdk'
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

export type WalletStatus =
	| 'disconnected'
	| 'detecting'
	| 'selecting'
	| 'connecting'
	| 'connected'

export interface WalletContextValue {
	wallet: WalletInterface | null
	status: WalletStatus
	identityKey: string | null
	providerType: string | null
	availableProviders: AvailableProvider[]
	connect: (providerType?: string) => Promise<void>
	disconnect: () => void
	error: Error | null
}

export interface WalletProviderProps {
	autoDetect?: boolean
	providers?: WalletProviderConfig[]
	children: ReactNode
}

const STORAGE_KEY = 'onesat_wallet_provider'

function clearStored(): void {
	if (typeof window === 'undefined') return
	localStorage.removeItem(STORAGE_KEY)
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({
	autoDetect = true,
	providers,
	children,
}: WalletProviderProps) {
	const [wallet, setWallet] = useState<WalletInterface | null>(null)
	const [status, setStatus] = useState<WalletStatus>('disconnected')
	const [identityKey, setIdentityKey] = useState<string | null>(null)
	const [providerType, setProviderType] = useState<string | null>(null)
	const [error, setError] = useState<Error | null>(null)
	const disconnectRef = useRef<(() => void) | null>(null)

	const availableProviders = useMemo(
		() => getAvailableProviders({ providers }),
		[providers],
	)

	const applyResult = useCallback((result: ConnectWalletResult) => {
		setWallet(result.wallet)
		setIdentityKey(result.identityKey)
		setProviderType(result.provider)
		setStatus('connected')
		setError(null)
		disconnectRef.current = result.disconnect
	}, [])

	const disconnect = useCallback(() => {
		disconnectRef.current?.()
		disconnectRef.current = null
		setWallet(null)
		setIdentityKey(null)
		setProviderType(null)
		setStatus('disconnected')
		setError(null)
		clearStored()
	}, [])

	const connect = useCallback(
		async (selectedType?: string) => {
			setError(null)

			if (selectedType) {
				const provider = availableProviders.find((p) => p.type === selectedType)
				if (!provider) {
					setError(new Error(`Unknown provider: ${selectedType}`))
					return
				}
				setStatus('connecting')
				try {
					applyResult(await provider.connect())
				} catch (e) {
					setError(e instanceof Error ? e : new Error(String(e)))
					setStatus('selecting')
				}
				return
			}

			// No specific type — run full detection
			setStatus('detecting')
			const result = await connectWallet({
				autoDetect: true,
				providers,
			})
			if (result) {
				applyResult(result)
			} else {
				setStatus('selecting')
			}
		},
		[availableProviders, providers, applyResult],
	)

	// Capture current callbacks in a ref so the mount effect has no deps
	const mountRef = useRef({
		autoDetect,
		availableProviders,
		connect,
		applyResult,
	})
	mountRef.current = {
		autoDetect,
		availableProviders,
		connect,
		applyResult,
	}

	// Auto-detect on mount
	useEffect(() => {
		const { autoDetect: auto, connect: doConnect } = mountRef.current

		if (auto) {
			doConnect()
		} else {
			setStatus('selecting')
		}
	}, [])

	const value = useMemo<WalletContextValue>(
		() => ({
			wallet,
			status,
			identityKey,
			providerType,
			availableProviders,
			connect,
			disconnect,
			error,
		}),
		[
			wallet,
			status,
			identityKey,
			providerType,
			availableProviders,
			connect,
			disconnect,
			error,
		],
	)

	return (
		<WalletContext.Provider value={value}>{children}</WalletContext.Provider>
	)
}

export function useWallet(): WalletContextValue {
	const ctx = useContext(WalletContext)
	if (!ctx) {
		throw new Error('useWallet must be used within a WalletProvider')
	}
	return ctx
}
