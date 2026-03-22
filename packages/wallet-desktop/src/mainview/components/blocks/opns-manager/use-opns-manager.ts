import { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "@1sat/react"
import {
  getOpnsNames,
  opnsRegister,
  opnsDeregister,
  createContext,
  type OpnsOperationResponse,
} from "@1sat/actions"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An OpNS name owned by the connected wallet */
export interface OpnsName {
  /** Outpoint of the OpNS ordinal (txid_vout) */
  outpoint: string
  /** The human-readable name string */
  name: string
  /** Whether an identity key is currently bound */
  registered: boolean
  /** The bound identity public key, if registered */
  identityKey?: string
}

/** Options for the useOpnsManager hook */
export interface UseOpnsManagerOptions {
  /** Whether to auto-fetch names on mount (default: true) */
  autoFetch?: boolean
  /** Callback on successful register or deregister */
  onSuccess?: (result: OpnsOperationResponse) => void
  /** Callback on error */
  onError?: (error: Error) => void
}

/** Return type for the useOpnsManager hook */
export interface UseOpnsManagerReturn {
  /** List of OpNS names owned by the wallet */
  names: OpnsName[]
  /** Whether the initial name list is loading */
  isLoading: boolean
  /** Error from the last fetch or operation */
  error: Error | null
  /** Whether a register/deregister operation is in progress */
  isOperating: boolean
  /** Register an identity key on the given OpNS name */
  register: (name: OpnsName) => Promise<OpnsOperationResponse>
  /** Remove identity binding from the given OpNS name */
  deregister: (name: OpnsName) => Promise<OpnsOperationResponse>
  /** Refetch the list of OpNS names */
  refresh: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the name string from OpNS output tags */
function extractNameFromTags(tags: string[]): string {
  for (const tag of tags) {
    if (tag.startsWith("name:")) {
      return tag.slice(5)
    }
  }
  return "unknown"
}

/** Check whether the output is currently registered */
function isRegistered(tags: string[]): boolean {
  return tags.some((t) => t === "opns:published")
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages OpNS names for the connected wallet. Lists owned names,
 * registers identity key bindings, and deregisters them.
 *
 * Must be rendered inside a `WalletProvider` from `@1sat/react`.
 *
 * @example
 * ```ts
 * const { names, isLoading, register, deregister, refresh } =
 *   useOpnsManager({ onSuccess: (r) => console.log("txid:", r.txid) })
 * ```
 */
export function useOpnsManager(
  options: UseOpnsManagerOptions = {}
): UseOpnsManagerReturn {
  const { autoFetch = true, onSuccess, onError } = options
  const { wallet, status } = useWallet()

  const [names, setNames] = useState<OpnsName[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOperating, setIsOperating] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchNames = useCallback(async () => {
    if (!wallet || status !== "connected") {
      setNames([])
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const ctx = createContext(wallet)
      const result = await getOpnsNames.execute(ctx, {})

      if (controller.signal.aborted) return

      const parsed: OpnsName[] = result.outputs.map((output) => {
        const tags = output.tags ?? []
        return {
          outpoint: output.outpoint,
          name: extractNameFromTags(tags),
          registered: isRegistered(tags),
          identityKey: undefined, // Identity key is resolved server-side
        }
      })

      setNames(parsed)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      const fetchError =
        err instanceof Error ? err : new Error("Failed to fetch OpNS names")
      setError(fetchError)
      onError?.(fetchError)
      setNames([])
    } finally {
      setIsLoading(false)
    }
  }, [wallet, status, onError])

  const register = useCallback(
    async (name: OpnsName): Promise<OpnsOperationResponse> => {
      if (!wallet) {
        const err = new Error("Wallet not connected")
        onError?.(err)
        return { error: err.message }
      }

      setIsOperating(true)
      setError(null)

      try {
        const ctx = createContext(wallet)

        // Resolve the full output from the wallet for this outpoint
        const listResult = await getOpnsNames.execute(ctx, {})
        const ordinal = listResult.outputs.find(
          (o) => o.outpoint === name.outpoint
        )

        if (!ordinal) {
          const err = new Error(`OpNS name "${name.name}" not found in wallet`)
          setError(err)
          onError?.(err)
          return { error: err.message }
        }

        const result = await opnsRegister.execute(ctx, { ordinal })

        if (result.error) {
          const err = new Error(result.error)
          setError(err)
          onError?.(err)
          return result
        }

        onSuccess?.(result)
        // Refresh list after successful operation
        void fetchNames()
        return result
      } catch (err) {
        const opError =
          err instanceof Error ? err : new Error("Registration failed")
        setError(opError)
        onError?.(opError)
        return { error: opError.message }
      } finally {
        setIsOperating(false)
      }
    },
    [wallet, onSuccess, onError, fetchNames]
  )

  const deregister = useCallback(
    async (name: OpnsName): Promise<OpnsOperationResponse> => {
      if (!wallet) {
        const err = new Error("Wallet not connected")
        onError?.(err)
        return { error: err.message }
      }

      setIsOperating(true)
      setError(null)

      try {
        const ctx = createContext(wallet)

        const listResult = await getOpnsNames.execute(ctx, {})
        const ordinal = listResult.outputs.find(
          (o) => o.outpoint === name.outpoint
        )

        if (!ordinal) {
          const err = new Error(`OpNS name "${name.name}" not found in wallet`)
          setError(err)
          onError?.(err)
          return { error: err.message }
        }

        const result = await opnsDeregister.execute(ctx, { ordinal })

        if (result.error) {
          const err = new Error(result.error)
          setError(err)
          onError?.(err)
          return result
        }

        onSuccess?.(result)
        void fetchNames()
        return result
      } catch (err) {
        const opError =
          err instanceof Error ? err : new Error("Deregistration failed")
        setError(opError)
        onError?.(opError)
        return { error: opError.message }
      } finally {
        setIsOperating(false)
      }
    },
    [wallet, onSuccess, onError, fetchNames]
  )

  // Auto-fetch on mount / status change
  useEffect(() => {
    if (autoFetch && status === "connected") {
      void fetchNames()
    }
    return () => {
      abortRef.current?.abort()
    }
  }, [autoFetch, status, fetchNames])

  return {
    names,
    isLoading,
    error,
    isOperating,
    register,
    deregister,
    refresh: fetchNames,
  }
}
