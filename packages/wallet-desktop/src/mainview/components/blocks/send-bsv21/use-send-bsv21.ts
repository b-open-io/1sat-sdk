import { useCallback, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A token balance entry for display in the selector */
export interface TokenBalance {
  /** Token ID (txid_vout format) */
  tokenId: string
  /** Token ticker symbol */
  symbol: string
  /** Available balance as a decimal string */
  balance: string
  /** Number of decimal places for this token */
  decimals: number
  /** Optional URL for the token icon */
  iconUrl?: string
}

/** Parameters passed to the onSend callback */
export interface SendBsv21Params {
  /** Token ID being sent */
  tokenId: string
  /** Amount as a decimal string (human-readable, e.g. "10.5") */
  amount: string
  /** Recipient BSV address */
  address: string
}

/** Result returned from the onSend callback */
export interface SendBsv21Result {
  /** Transaction ID on success */
  txid?: string
  /** Error message on failure */
  error?: string
}

/** Options for the useSendBsv21 hook */
export interface UseSendBsv21Options {
  /** Callback to execute the actual token transfer */
  onSend?: (params: SendBsv21Params) => Promise<SendBsv21Result>
  /** Called on successful send */
  onSuccess?: (result: SendBsv21Result) => void
  /** Called on error */
  onError?: (error: Error) => void
}

/** Return type of useSendBsv21 hook */
export interface UseSendBsv21Return {
  /** Whether a send operation is in progress */
  isLoading: boolean
  /** Current error, if any */
  error: Error | null
  /** Result of the last successful send */
  result: SendBsv21Result | null
  /** Execute a token send */
  execute: (params: SendBsv21Params) => Promise<SendBsv21Result>
  /** Reset error and result state */
  reset: () => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSendBsv21({
  onSend,
  onSuccess,
  onError,
}: UseSendBsv21Options = {}): UseSendBsv21Return {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<SendBsv21Result | null>(null)

  const execute = useCallback(
    async (params: SendBsv21Params): Promise<SendBsv21Result> => {
      if (!onSend) {
        const err = new Error("onSend callback is required")
        setError(err)
        onError?.(err)
        return { error: err.message }
      }

      setIsLoading(true)
      setError(null)
      setResult(null)

      try {
        const sendResult = await onSend(params)

        if (sendResult.error) {
          const err = new Error(sendResult.error)
          setError(err)
          onError?.(err)
          return sendResult
        }

        setResult(sendResult)
        onSuccess?.(sendResult)
        return sendResult
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        onError?.(e)
        return { error: e.message }
      } finally {
        setIsLoading(false)
      }
    },
    [onSend, onSuccess, onError],
  )

  const reset = useCallback(() => {
    setError(null)
    setResult(null)
  }, [])

  return { isLoading, error, result, execute, reset }
}
