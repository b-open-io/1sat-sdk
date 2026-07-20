import {
	type AvailableProvider,
	type ConnectWalletResult,
	type DisconnectReason,
	type WalletProviderConfig,
	type WalletSession,
	connectWallet,
	createWalletSession,
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

export interface WalletContextValue {
	wallet: WalletInterface | null
	status: WalletStatus
	identityKey: string | null
	providerType: string | null
	availableProviders: AvailableProvider[]
	/** Why the last session ended, if any (null after a successful connect). */
	disconnectReason: DisconnectReason | null
	connect: (providerType?: string) => Promise<void>
	applyResult: (result: ConnectWalletResult) => void
	disconnect: () => void
	error: Error | null
}

export interface WalletProviderProps {
	autoReconnect?: boolean
	autoDetect?: boolean
	/** Identity/auth poll interval in ms (default 4000). */
	pollIntervalMs?: number
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
	pollIntervalMs,
	providers,
	children,
}: WalletProviderProps) {
	const [wallet, setWallet] = useState<WalletInterface | null>(null)
	const [status, setStatus] = useState<WalletStatus>('disconnected')
	const [identityKey, setIdentityKey] = useState<string | null>(null)
	const [providerType, setProviderType] = useState<string | null>(null)
	const [disconnectReason, setDisconnectReason] =
		useState<DisconnectReason | null>(null)
	const [error, setError] = useState<Error | null>(null)
	const sessionRef = useRef<WalletSession | null>(null)

	const availableProviders = useMemo(
		() => getAvailableProviders({ providers }),
		[providers],
	)

	const clearSessionState = useCallback((reason: DisconnectReason | null) => {
		setWallet(null)
		setIdentityKey(null)
		setProviderType(null)
		setStatus('disconnected')
		setDisconnectReason(reason)
		setError(null)
		clearStored()
	}, [])

	const bindSession = useCallback(
		(result: ConnectWalletResult) => {
			const previous = sessionRef.current
			sessionRef.current = null
			// Tear down any prior session without treating it as the active disconnect.
			previous?.stop()
			if (previous?.status === 'connected') {
				previous.disconnect('manual')
			}

			const session = createWalletSession(result, { pollIntervalMs })
			sessionRef.current = session

			session.on('identityChange', ({ next }) => {
				if (sessionRef.current !== session) return
				setIdentityKey(next)
			})

			session.on('disconnected', ({ reason }) => {
				if (sessionRef.current !== session) return
				sessionRef.current = null
				clearSessionState(reason)
			})

			setWallet(result.wallet)
			setIdentityKey(result.identityKey)
			setProviderType(result.provider)
			setStatus('connected')
			setDisconnectReason(null)
			setError(null)
			saveStored(result.provider)
			session.start()
		},
		[pollIntervalMs, clearSessionState],
	)

	const applyResult = useCallback(
		(result: ConnectWalletResult) => {
			bindSession(result)
		},
		[bindSession],
	)

	const disconnect = useCallback(() => {
		const session = sessionRef.current
		sessionRef.current = null
		if (session && session.status === 'connected') {
			session.disconnect('manual')
		}
		clearSessionState('manual')
	}, [clearSessionState])

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

	// Stop polling on unmount; leave disconnect to navigation teardown / GC.
	useEffect(() => {
		return () => {
			sessionRef.current?.stop()
		}
	}, [])

	const value = useMemo<WalletContextValue>(
		() => ({
			wallet,
			status,
			identityKey,
			providerType,
			availableProviders,
			disconnectReason,
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
			disconnectReason,
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
