import {
	type AvailableProvider,
	type ConnectWalletResult,
	type WalletProviderConfig,
	connectWallet,
	getAvailableProviders,
	reconnectSigmaWallet,
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
	| 'locked'

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
	/** Interval (ms) for polling wallet auth state after connect. 0 disables. */
	healthCheckMs?: number
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

// Retained for backwards compatibility: SigmaCallback clears this on completion.
// autoReconnect no longer sets it — Sigma reconnect now restores the session
// directly instead of redirecting, so there is no redirect loop to guard against.
const SIGMA_GUARD_KEY = 'onesat_sigma_reconnecting'

export function clearSigmaGuard(): void {
	if (typeof window === 'undefined') return
	sessionStorage.removeItem(SIGMA_GUARD_KEY)
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({
	autoReconnect = false,
	autoDetect = true,
	providers,
	healthCheckMs = 10_000,
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
			applyResult: doApply,
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

		// Sigma: RESTORE the existing session via the CWI iframe using the stored
		// identity — never re-run the OAuth redirect here. Reconnecting by redirect
		// triggers a full-page navigation on every mount (including the callback
		// page, racing the callback's own wallet connect), which caused an infinite
		// auth loop the sessionStorage guard couldn't reliably stop. If there is no
		// stored identity, or the restore fails, stay disconnected and let the user
		// log in explicitly.
		if (stored === 'sigma') {
			setStatus('connecting')
			reconnectSigmaWallet()
				.then((result) => {
					if (result) {
						doApply(result)
					} else {
						clearStored()
						setStatus('disconnected')
					}
				})
				.catch(() => {
					clearStored()
					setStatus('disconnected')
				})
			return
		}

		doConnect(stored).catch(() => {
			clearStored()
			setStatus('disconnected')
		})
	}, [])

	// Wallet substrates answer isAuthenticated without prompting and report
	// false while locked, whereas signing calls against a locked wallet hang
	// indefinitely. Poll auth state so a lock surfaces as status 'locked'
	// (and recovers to 'connected' on unlock) instead of hanging the app.
	useEffect(() => {
		if (
			!wallet ||
			(status !== 'connected' && status !== 'locked') ||
			healthCheckMs <= 0
		) {
			return
		}
		let cancelled = false
		let inFlight = false
		const check = async () => {
			if (inFlight) return
			inFlight = true
			try {
				const result = await Promise.race([
					wallet.isAuthenticated({}),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error('isAuthenticated timed out')),
							5_000,
						),
					),
				])
				if (!cancelled) {
					setStatus(result.authenticated ? 'connected' : 'locked')
				}
			} catch {
				if (!cancelled) setStatus('locked')
			} finally {
				inFlight = false
			}
		}
		const interval = setInterval(check, healthCheckMs)
		const onVisible = () => {
			if (document.visibilityState === 'visible') void check()
		}
		window.addEventListener('focus', onVisible)
		document.addEventListener('visibilitychange', onVisible)
		return () => {
			cancelled = true
			clearInterval(interval)
			window.removeEventListener('focus', onVisible)
			document.removeEventListener('visibilitychange', onVisible)
		}
	}, [wallet, status, healthCheckMs])

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
