'use client'

import type {
	BalanceResult,
	CancelListingRequest,
	CreateListingRequest,
	InscribeRequest,
	OneSatProvider as OneSatProviderInterface,
	OrdinalOutput,
	PurchaseListingRequest,
	SendOrdinalsRequest,
	SignTransactionRequest,
	TokenOutput,
	TransferTokenRequest,
	Utxo,
} from '@1sat/connect'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOneSatContext } from './context'

// --- Internal helpers ---

/**
 * Mutation hook with loading/error state. Uses a ref for the action
 * function so the returned mutate callback has stable identity.
 */
function useProviderAction<TArgs extends unknown[], TResult>(
	actionFn: (
		provider: OneSatProviderInterface,
		...args: TArgs
	) => Promise<TResult>,
) {
	const { provider, isConnected } = useOneSatContext()
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)
	const actionRef = useRef(actionFn)
	actionRef.current = actionFn

	const mutate = useCallback(
		async (...args: TArgs): Promise<TResult> => {
			if (!provider || !isConnected) throw new Error('Wallet not connected')
			setIsLoading(true)
			setError(null)
			try {
				return await actionRef.current(provider, ...args)
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

	return { mutate, isLoading, error }
}

// --- Query hooks ---

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
			setBalance(await provider.getBalance())
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
 *   return ordinals.map(ord => <div key={ord.outpoint}>{ord.origin}</div>)
 * }
 * ```
 */
export function useOrdinals(limit?: number, offset?: number) {
	const { provider, isConnected } = useOneSatContext()
	const [ordinals, setOrdinals] = useState<OrdinalOutput[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const refetch = useCallback(async () => {
		if (!provider || !isConnected) return
		setIsLoading(true)
		setError(null)
		try {
			const opts =
				limit !== undefined || offset !== undefined
					? { limit, offset }
					: undefined
			setOrdinals(await provider.getOrdinals(opts))
		} catch (e) {
			setError(e instanceof Error ? e : new Error(String(e)))
		} finally {
			setIsLoading(false)
		}
	}, [provider, isConnected, limit, offset])

	useEffect(() => {
		if (isConnected) {
			refetch()
		} else {
			setOrdinals([])
		}
	}, [isConnected, refetch])

	return { ordinals, isLoading, error, refetch }
}

/**
 * Hook to get tokens from the wallet
 *
 * @example
 * ```tsx
 * function Tokens() {
 *   const { tokens, isLoading } = useTokens()
 *   if (isLoading) return <span>Loading...</span>
 *   return tokens.map(t => <div key={t.outpoint}>{t.symbol}: {t.amount}</div>)
 * }
 * ```
 */
export function useTokens(limit?: number, offset?: number) {
	const { provider, isConnected } = useOneSatContext()
	const [tokens, setTokens] = useState<TokenOutput[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const refetch = useCallback(async () => {
		if (!provider || !isConnected) return
		setIsLoading(true)
		setError(null)
		try {
			const opts =
				limit !== undefined || offset !== undefined
					? { limit, offset }
					: undefined
			setTokens(await provider.getTokens(opts))
		} catch (e) {
			setError(e instanceof Error ? e : new Error(String(e)))
		} finally {
			setIsLoading(false)
		}
	}, [provider, isConnected, limit, offset])

	useEffect(() => {
		if (isConnected) {
			refetch()
		} else {
			setTokens([])
		}
	}, [isConnected, refetch])

	return { tokens, isLoading, error, refetch }
}

/**
 * Hook to get payment UTXOs from the wallet
 *
 * @example
 * ```tsx
 * function Utxos() {
 *   const { utxos, refetch } = useUtxos()
 *   return <span>{utxos.length} UTXOs available</span>
 * }
 * ```
 */
export function useUtxos() {
	const { provider, isConnected } = useOneSatContext()
	const [utxos, setUtxos] = useState<Utxo[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const refetch = useCallback(async () => {
		if (!provider || !isConnected) return
		setIsLoading(true)
		setError(null)
		try {
			setUtxos(await provider.getUtxos())
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
			setUtxos([])
		}
	}, [isConnected, refetch])

	return { utxos, isLoading, error, refetch }
}

// --- Mutation hooks ---

/**
 * Hook for signing transactions
 *
 * @example
 * ```tsx
 * const { signTransaction, isLoading } = useSignTransaction()
 * const result = await signTransaction({ rawtx, description: 'Send payment' })
 * ```
 */
export function useSignTransaction() {
	const {
		mutate: signTransaction,
		isLoading,
		error,
	} = useProviderAction((p, request: SignTransactionRequest) =>
		p.signTransaction(request),
	)
	return { signTransaction, isLoading, error }
}

/**
 * Hook for signing messages (BSM)
 *
 * @example
 * ```tsx
 * const { signMessage, isLoading } = useSignMessage()
 * const result = await signMessage('Hello, World!')
 * ```
 */
export function useSignMessage() {
	const {
		mutate: signMessage,
		isLoading,
		error,
	} = useProviderAction((p, message: string) => p.signMessage(message))
	return { signMessage, isLoading, error }
}

/**
 * Hook for inscribing ordinals
 *
 * @example
 * ```tsx
 * const { inscribe, isLoading } = useInscribe()
 * const result = await inscribe({ dataB64, contentType: 'text/plain' })
 * ```
 */
export function useInscribe() {
	const {
		mutate: inscribe,
		isLoading,
		error,
	} = useProviderAction((p, request: InscribeRequest) => p.inscribe(request))
	return { inscribe, isLoading, error }
}

/**
 * Hook for sending ordinals
 *
 * @example
 * ```tsx
 * const { sendOrdinals, isLoading } = useSendOrdinals()
 * await sendOrdinals({ outpoints: ['txid_0'], destinationAddress: 'addr' })
 * ```
 */
export function useSendOrdinals() {
	const {
		mutate: sendOrdinals,
		isLoading,
		error,
	} = useProviderAction((p, request: SendOrdinalsRequest) =>
		p.sendOrdinals(request),
	)
	return { sendOrdinals, isLoading, error }
}

/**
 * Hook for transferring tokens (BSV20/21)
 *
 * @example
 * ```tsx
 * const { transferToken, isLoading } = useTransferToken()
 * await transferToken({ tokenId: 'origin_0', amount: '100', destinationAddress: 'addr' })
 * ```
 */
export function useTransferToken() {
	const {
		mutate: transferToken,
		isLoading,
		error,
	} = useProviderAction((p, request: TransferTokenRequest) =>
		p.transferToken(request),
	)
	return { transferToken, isLoading, error }
}

/**
 * Hook for creating marketplace listings
 *
 * @example
 * ```tsx
 * const { createListing, isLoading } = useCreateListing()
 * await createListing({ outpoints: ['txid_0'], priceSatoshis: 100000 })
 * ```
 */
export function useCreateListing() {
	const {
		mutate: createListing,
		isLoading,
		error,
	} = useProviderAction((p, request: CreateListingRequest) =>
		p.createListing(request),
	)
	return { createListing, isLoading, error }
}

/**
 * Hook for purchasing a listed ordinal
 *
 * @example
 * ```tsx
 * const { purchaseListing, isLoading } = usePurchaseListing()
 * await purchaseListing({ listingOutpoint: 'txid_0' })
 * ```
 */
export function usePurchaseListing() {
	const {
		mutate: purchaseListing,
		isLoading,
		error,
	} = useProviderAction((p, request: PurchaseListingRequest) =>
		p.purchaseListing(request),
	)
	return { purchaseListing, isLoading, error }
}

/**
 * Hook for cancelling marketplace listings
 *
 * @example
 * ```tsx
 * const { cancelListing, isLoading } = useCancelListing()
 * await cancelListing({ listingOutpoints: ['txid_0'] })
 * ```
 */
export function useCancelListing() {
	const {
		mutate: cancelListing,
		isLoading,
		error,
	} = useProviderAction((p, request: CancelListingRequest) =>
		p.cancelListing(request),
	)
	return { cancelListing, isLoading, error }
}
