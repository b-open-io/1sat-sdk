import { useCallback, useEffect, useMemo, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Represents a single ordinal NFT output */
export interface OrdinalOutput {
  /** Outpoint in txid_vout or txid.vout format */
  outpoint: string
  /** Content type from tags (e.g. "image/png") */
  contentType: string
  /** Display name from MAP metadata */
  name?: string
  /** Origin outpoint for ORDFS content resolution */
  origin: string
  /** Satoshis held by this output */
  satoshis: number
  /** Raw tags array from the wallet output */
  tags: string[]
}

export interface UseOrdinalsGridOptions {
  /** Ordinal address to fetch from the 1sat API. If omitted, ordinals must be passed via `ordinals` prop. */
  address?: string
  /** Pre-fetched ordinals to display (bypasses API fetch) */
  ordinals?: OrdinalOutput[]
  /** Base URL for the 1sat owner API (default: "https://api.1sat.app/1sat") */
  apiUrl?: string
  /** Max number of items to display (default: unlimited) */
  limit?: number
}

export interface UseOrdinalsGridReturn {
  /** Parsed ordinal items ready for display */
  items: OrdinalOutput[]
  /** Whether the initial fetch is in progress */
  isLoading: boolean
  /** Error from the fetch, if any */
  error: Error | null
  /** Total count of ordinals loaded */
  count: number
  /** Reload ordinals from the API */
  reload: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://api.1sat.app/1sat"

/** Extract a tag value by prefix (e.g. "type:" -> "image/png") */
function getTag(tags: string[], prefix: string): string | undefined {
  const tag = tags.find((t) => t.startsWith(prefix))
  return tag ? tag.slice(prefix.length) : undefined
}

/** Normalize an outpoint to underscore format (txid_vout) */
function normalizeOutpoint(outpoint: string): string {
  return outpoint.replace(".", "_")
}

/**
 * Parse a single SSE line from the 1sat owner API into an OrdinalOutput.
 * Expected JSON shape: { outpoint: string, satoshis: number, tags?: string[] }
 */
function parseTxoLine(json: string): OrdinalOutput | null {
  try {
    const data: {
      outpoint: string
      satoshis: number
      tags?: string[]
    } = JSON.parse(json)

    const tags = data.tags ?? []
    const contentType = getTag(tags, "type:") ?? ""
    const name = getTag(tags, "name:")
    const origin = getTag(tags, "origin:") ?? data.outpoint

    return {
      outpoint: normalizeOutpoint(data.outpoint),
      contentType,
      name,
      origin: normalizeOutpoint(origin),
      satoshis: data.satoshis,
      tags,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOrdinalsGrid({
  address,
  ordinals: externalOrdinals,
  apiUrl = DEFAULT_API_URL,
  limit,
}: UseOrdinalsGridOptions = {}): UseOrdinalsGridReturn {
  const [fetchedOrdinals, setFetchedOrdinals] = useState<OrdinalOutput[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchOrdinals = useCallback(
    (addr: string) => {
      // Cancel any in-flight request
      abortRef.current?.abort()

      const controller = new AbortController()
      abortRef.current = controller

      setIsLoading(true)
      setError(null)

      const url = `${apiUrl}/owner/${addr}/txos`
      const items: OrdinalOutput[] = []

      fetch(url, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch ordinals: ${response.status}`)
          }

          if (!response.body) {
            throw new Error("Response body is null")
          }

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""

          for (;;) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            // Keep the last incomplete line in the buffer
            buffer = lines.pop() ?? ""

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed) continue

              const parsed = parseTxoLine(trimmed)
              if (parsed) {
                items.push(parsed)
              }
            }
          }

          // Process any remaining buffer
          if (buffer.trim()) {
            const parsed = parseTxoLine(buffer.trim())
            if (parsed) {
              items.push(parsed)
            }
          }

          if (!controller.signal.aborted) {
            setFetchedOrdinals(items)
            setIsLoading(false)
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          const fetchError =
            err instanceof Error ? err : new Error("Failed to fetch ordinals")
          setError(fetchError)
          setIsLoading(false)
        })
    },
    [apiUrl],
  )

  const reload = useCallback(() => {
    if (address) {
      fetchOrdinals(address)
    }
  }, [address, fetchOrdinals])

  // Fetch on mount or when address changes
  useEffect(() => {
    if (externalOrdinals) return
    if (!address) return

    fetchOrdinals(address)

    return () => {
      abortRef.current?.abort()
    }
  }, [address, externalOrdinals, fetchOrdinals])

  const items = useMemo(() => {
    const source = externalOrdinals ?? fetchedOrdinals
    if (limit !== undefined && limit > 0) {
      return source.slice(0, limit)
    }
    return source
  }, [externalOrdinals, fetchedOrdinals, limit])

  return {
    items,
    isLoading: externalOrdinals ? false : isLoading,
    error: externalOrdinals ? null : error,
    count: items.length,
    reload,
  }
}
