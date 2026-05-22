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
	applyResult: (result: ConnectWalletResult) => void
	disconnect: () => void
	error: Error | null
}

export interface WalletProviderProps {
	autoReconnect?: boolean
	autoDetect?: boolean
	providers?: WalletProviderConfig[]
	children: ReactNode
}

const STORAGE_KEY = 'onesat_wallet_provider'

export function loadStoredProvider(): string | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw)
		return parsed?.providerType ?? null
	} catch {
		return null
	}
}

function saveStored(providerType: string): void {
	if (typeof window === 'undefined') return
	localStorage.setItem(STORAGE_KEY, JSON.stringify({ providerType }))
}

function clearStored(): void {
	if (typeof window === 'undefined') return
	localStorage.removeItem(STORAGE_KEY)
}

const SIGMA_GUARD_KEY = 'onesat_sigma_reconnecting'

function setSigmaGuard(): void {
	if (typeof window === 'undefined') return
	sessionStorage.setItem(SIGMA_GUARD_KEY, 'true')
}

function hasSigmaGuard(): boolean {
	if (typeof window === 'undefined') return false
	return sessionStorage.getItem(SIGMA_GUARD_KEY) === 'true'
}

export function clearSigmaGuard(): void {
	if (typeof window === 'undefined') return
	sessionStorage.removeItem(SIGMA_GUARD_KEY)
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({
	autoReconnect = false,
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
		saveStored(result.provider)
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
				autoDetect,
				providers,
			})
			if (result) {
				applyResult(result)
			} else {
				setStatus('selecting')
			}
		},
		[availableProviders, providers, applyResult, autoDetect],
	)

	// Capture current callbacks in a ref so the mount effect has no deps
	const mountRef = useRef({
		autoReconnect,
		availableProviders,
		connect,
		applyResult,
	})
	mountRef.current = {
		autoReconnect,
		availableProviders,
		connect,
		applyResult,
	}

	// Auto-reconnect on mount
	useEffect(() => {
		const {
			autoReconnect: shouldReconnect,
			availableProviders: configured,
			connect: doConnect,
		} = mountRef.current

		if (!shouldReconnect) {
			setStatus('disconnected')
			return
		}

		const stored = loadStoredProvider()
		if (!stored) {
			setStatus('disconnected')
			return
		}

		// BRC-100 means "auto-detected last time" — re-run auto-detect
		if (stored === 'brc100') {
			doConnect().catch(() => {
				clearStored()
				setStatus('disconnected')
			})
			return
		}

		// Validate stored provider is in configured list
		const isConfigured = configured.some((p) => p.type === stored)
		if (!isConfigured) {
			clearStored()
			setStatus('disconnected')
			return
		}

		// Sigma redirect guard — if we already tried and failed, don't loop
		if (stored === 'sigma' && hasSigmaGuard()) {
			clearStored()
			clearSigmaGuard()
			setStatus('disconnected')
			return
		}

		// Set guard before sigma redirect (it navigates away)
		if (stored === 'sigma') {
			setSigmaGuard()
		}

		doConnect(stored).catch(() => {
			clearStored()
			if (stored === 'sigma') clearSigmaGuard()
			setStatus('disconnected')
		})
	}, [])

	const value = useMemo<WalletContextValue>(
		() => ({
			wallet,
			status,
			identityKey,
			providerType,
			availableProviders,
			connect,
			applyResult,
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
			applyResult,
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
