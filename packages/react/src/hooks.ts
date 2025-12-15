'use client'

import type {
	BalanceResult,
	ListOptions,
	OrdinalOutput,
	TokenOutput,
} from '@1sat/connect'
import { useCallback, useEffect, useState } from 'react'
import { useOneSatContext } from './context'

/**
 * Main hook for 1Sat wallet interaction
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isConnected, connect, paymentAddress } = useOneSat()
 *
 *   if (!isConnected) {
 *     return <button onClick={connect}>Connect Wallet</button>
 *   }
 *
 *   return <p>Connected: {paymentAddress}</p>
 * }
 * ```
 */
export function useOneSat() {
	const context = useOneSatContext()

	return {
		provider: context.provider,
		isConnected: context.isConnected,
		isConnecting: context.isConnecting,
		paymentAddress: context.paymentAddress,
		ordinalAddress: context.ordinalAddress,
		identityPubKey: context.identityPubKey,
		connect: context.connect,
		disconnect: context.disconnect,
		error: context.error,
	}
}

/**
 * Hook to get the wallet balance
 *
 * @example
 * ```tsx
 * function Balance() {
 *   const { satoshis, isLoading } = useBalance()
 *   if (isLoading) return <span>Loading...</span>
 *   return <span>{satoshis} sats</span>
 * }
 * ```
 */
export function useBalance() {
	const { provider, isConnected } = useOneSatContext()
	const [balance, setBalance] = useState<BalanceResult | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const refetch = useCallback(async () => {
		if (!provider || !isConnected) return

		setIsLoading(true)
		setError(null)

		try {
			const result = await provider.getBalance()
			setBalance(result)
		} catch (e) {
			setError(e instanceof Error ? e : new Error(String(e)))
		} finally {
			setIsLoading(false)
		}
	}, [provider, isConnected])

	useEffect(() => {
		if (isConnected) {
			refetch()
		} else {
			setBalance(null)
		}
	}, [isConnected, refetch])

	return {
		satoshis: balance?.satoshis ?? 0,
		usd: balance?.usd ?? 0,
		isLoading,
		error,
		refetch,
	}
}

/**
 * Hook to get ordinals from the wallet
 *
 * @example
 * ```tsx
 * function Gallery() {
 *   const { ordinals, isLoading } = useOrdinals()
 *   if (isLoading) return <span>Loading...</span>
 *   return (
 *     <div>
 *       {ordinals.map(ord => (
 *         <div key={ord.outpoint}>{ord.origin}</div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useOrdinals(options?: ListOptions) {
	const { provider, isConnected } = useOneSatContext()
	const [ordinals, setOrdinals] = useState<OrdinalOutput[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const refetch = useCallback(async () => {
		if (!provider || !isConnected) return

		setIsLoading(true)
		setError(null)

		try {
			const result = await provider.getOrdinals(options)
			setOrdinals(result)
		} catch (e) {
			setError(e instanceof Error ? e : new Error(String(e)))
		} finally {
			setIsLoading(false)
		}
	}, [provider, isConnected, options])

	useEffect(() => {
		if (isConnected) {
			refetch()
		} else {
			setOrdinals([])
		}
	}, [isConnected, refetch])

	return {
		ordinals,
		isLoading,
		error,
		refetch,
	}
}

/**
 * Hook to get tokens from the wallet
 *
 * @example
 * ```tsx
 * function Tokens() {
 *   const { tokens, isLoading } = useTokens()
 *   if (isLoading) return <span>Loading...</span>
 *   return (
 *     <div>
 *       {tokens.map(token => (
 *         <div key={token.outpoint}>
 *           {token.symbol}: {token.amount}
 *         </div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useTokens(options?: ListOptions) {
	const { provider, isConnected } = useOneSatContext()
	const [tokens, setTokens] = useState<TokenOutput[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const refetch = useCallback(async () => {
		if (!provider || !isConnected) return

		setIsLoading(true)
		setError(null)

		try {
			const result = await provider.getTokens(options)
			setTokens(result)
		} catch (e) {
			setError(e instanceof Error ? e : new Error(String(e)))
		} finally {
			setIsLoading(false)
		}
	}, [provider, isConnected, options])

	useEffect(() => {
		if (isConnected) {
			refetch()
		} else {
			setTokens([])
		}
	}, [isConnected, refetch])

	return {
		tokens,
		isLoading,
		error,
		refetch,
	}
}

/**
 * Hook for signing transactions
 *
 * @example
 * ```tsx
 * function SignTx() {
 *   const { signTransaction, isLoading } = useSignTransaction()
 *
 *   const handleSign = async () => {
 *     const result = await signTransaction(rawTx)
 *     console.log('Signed:', result.txid)
 *   }
 *
 *   return <button onClick={handleSign} disabled={isLoading}>Sign</button>
 * }
 * ```
 */
export function useSignTransaction() {
	const { provider, isConnected } = useOneSatContext()
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const signTransaction = useCallback(
		async (rawtx: string, description?: string) => {
			if (!provider || !isConnected) {
				throw new Error('Wallet not connected')
			}

			setIsLoading(true)
			setError(null)

			try {
				const result = await provider.signTransaction({ rawtx, description })
				return result
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e))
				setError(err)
				throw err
			} finally {
				setIsLoading(false)
			}
		},
		[provider, isConnected],
	)

	return {
		signTransaction,
		isLoading,
		error,
	}
}

/**
 * Hook for signing messages (BSM)
 *
 * @example
 * ```tsx
 * function SignMessage() {
 *   const { signMessage, isLoading } = useSignMessage()
 *
 *   const handleSign = async () => {
 *     const result = await signMessage('Hello, World!')
 *     console.log('Signature:', result.signature)
 *   }
 *
 *   return <button onClick={handleSign} disabled={isLoading}>Sign Message</button>
 * }
 * ```
 */
export function useSignMessage() {
	const { provider, isConnected } = useOneSatContext()
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const signMessage = useCallback(
		async (message: string) => {
			if (!provider || !isConnected) {
				throw new Error('Wallet not connected')
			}

			setIsLoading(true)
			setError(null)

			try {
				const result = await provider.signMessage(message)
				return result
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e))
				setError(err)
				throw err
			} finally {
				setIsLoading(false)
			}
		},
		[provider, isConnected],
	)

	return {
		signMessage,
		isLoading,
		error,
	}
}

/**
 * Hook for inscribing ordinals
 */
export function useInscribe() {
	const { provider, isConnected } = useOneSatContext()
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const inscribe = useCallback(
		async (params: {
			dataB64: string
			contentType: string
			destinationAddress?: string
			metaData?: Record<string, string>
		}) => {
			if (!provider || !isConnected) {
				throw new Error('Wallet not connected')
			}

			setIsLoading(true)
			setError(null)

			try {
				const result = await provider.inscribe(params)
				return result
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e))
				setError(err)
				throw err
			} finally {
				setIsLoading(false)
			}
		},
		[provider, isConnected],
	)

	return {
		inscribe,
		isLoading,
		error,
	}
}
