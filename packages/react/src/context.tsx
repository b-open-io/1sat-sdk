'use client'

import {
	type ConnectResult,
	type OneSatProvider as OneSatProviderInterface,
	createOneSat,
} from '@1sat/connect'
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'

export interface OneSatContextValue {
	/** The underlying provider instance */
	provider: OneSatProviderInterface | null
	/** Whether the wallet is connected */
	isConnected: boolean
	/** Whether a connection is in progress */
	isConnecting: boolean
	/** The payment address (if connected) */
	paymentAddress: string | null
	/** The ordinal address (if connected) */
	ordinalAddress: string | null
	/** The identity public key (if connected) */
	identityPubKey: string | null
	/** Connect to the wallet */
	connect: () => Promise<ConnectResult>
	/** Disconnect from the wallet */
	disconnect: () => Promise<void>
	/** Any connection error */
	error: Error | null
}

const OneSatContext = createContext<OneSatContextValue | null>(null)

export interface OneSatProviderProps {
	/** Name of the dApp (shown in approval popup) */
	appName?: string
	/** Base URL for the wallet popup (default: https://1sat.market) */
	popupUrl?: string
	/** Request timeout in milliseconds (default: 300000 = 5 minutes) */
	timeout?: number
	/** Network to use (default: main) */
	network?: 'main' | 'test'
	/** Children to render */
	children: ReactNode
}

/**
 * React provider for 1Sat wallet functionality
 *
 * @example
 * ```tsx
 * import { OneSatProvider } from '@1sat/react'
 *
 * function App() {
 *   return (
 *     <OneSatProvider appName="My dApp">
 *       <MyApp />
 *     </OneSatProvider>
 *   )
 * }
 * ```
 */
export function OneSatProvider({
	appName,
	popupUrl,
	timeout,
	network,
	children,
}: OneSatProviderProps) {
	const [provider, setProvider] = useState<OneSatProviderInterface | null>(null)
	const [isConnected, setIsConnected] = useState(false)
	const [isConnecting, setIsConnecting] = useState(false)
	const [paymentAddress, setPaymentAddress] = useState<string | null>(null)
	const [ordinalAddress, setOrdinalAddress] = useState<string | null>(null)
	const [identityPubKey, setIdentityPubKey] = useState<string | null>(null)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		if (typeof window === 'undefined') return

		const p = createOneSat({ appName, popupUrl, timeout, network })
		setProvider(p)

		if (p.isConnected()) {
			const addresses = p.getAddresses()
			if (addresses) {
				setIsConnected(true)
				setPaymentAddress(addresses.paymentAddress)
				setOrdinalAddress(addresses.ordinalAddress)
				setIdentityPubKey(p.getIdentityPubKey())
			}
		}

		const handleConnect = (result: ConnectResult) => {
			setIsConnected(true)
			setPaymentAddress(result.paymentAddress)
			setOrdinalAddress(result.ordinalAddress)
			setIdentityPubKey(result.identityPubKey)
		}

		const handleDisconnect = () => {
			setIsConnected(false)
			setPaymentAddress(null)
			setOrdinalAddress(null)
			setIdentityPubKey(null)
		}

		p.on('connect', handleConnect)
		p.on('disconnect', handleDisconnect)

		return () => {
			p.off('connect', handleConnect as () => void)
			p.off('disconnect', handleDisconnect)
		}
	}, [appName, popupUrl, timeout, network])

	const connect = useCallback(async (): Promise<ConnectResult> => {
		if (!provider) {
			throw new Error('Provider not initialized')
		}

		setIsConnecting(true)
		setError(null)

		try {
			const result = await provider.connect()
			return result
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e))
			setError(err)
			throw err
		} finally {
			setIsConnecting(false)
		}
	}, [provider])

	const disconnect = useCallback(async (): Promise<void> => {
		if (!provider) return
		await provider.disconnect()
	}, [provider])

	const value = useMemo<OneSatContextValue>(
		() => ({
			provider,
			isConnected,
			isConnecting,
			paymentAddress,
			ordinalAddress,
			identityPubKey,
			connect,
			disconnect,
			error,
		}),
		[
			provider,
			isConnected,
			isConnecting,
			paymentAddress,
			ordinalAddress,
			identityPubKey,
			connect,
			disconnect,
			error,
		],
	)

	return (
		<OneSatContext.Provider value={value}>{children}</OneSatContext.Provider>
	)
}

/**
 * Hook to access the 1Sat context
 * @throws Error if used outside of OneSatProvider
 */
export function useOneSatContext(): OneSatContextValue {
	const context = useContext(OneSatContext)
	if (!context) {
		throw new Error('useOneSatContext must be used within an OneSatProvider')
	}
	return context
}
