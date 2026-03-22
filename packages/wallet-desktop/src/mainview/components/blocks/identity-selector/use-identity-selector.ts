"use client"

import { useCallback, useEffect, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single BAP identity entry for the selector */
export interface IdentityEntry {
  /** BAP ID (~27 char base58 string) */
  bapId: string
  /** Display name from profile (schema.org name/alternateName) */
  name: string | null
  /** Current signing address (used for avatar seed) */
  currentAddress: string
  /** Avatar image URL (ord://, b://, https://) if available */
  imageUrl: string | null
}

/** BAP identity record returned from the 1sat-stack API */
interface BapIdentityRecord {
  idKey: string
  firstSeen: number
  rootAddress: string
  currentAddress: string
  addresses: Array<{ address: string; txId: string; block: number }>
  identity?: Record<string, unknown>
}

export interface UseIdentitySelectorOptions {
  /** Pre-loaded list of identities (skips API fetch if provided) */
  identities?: IdentityEntry[]
  /** BAP ID of the currently active identity */
  activeBapId?: string
  /** Called when the user selects a different identity */
  onSelect?: (bapId: string) => void
  /** Called when the user clicks "Add identity" */
  onAddIdentity?: () => void
  /** Base URL for the 1sat-stack API (default: https://api.1sat.app) */
  apiUrl?: string
  /** List of BAP IDs to fetch from the API (used when identities prop is not provided) */
  bapIds?: string[]
}

export interface UseIdentitySelectorReturn {
  /** List of available identities */
  identities: IdentityEntry[]
  /** Currently active BAP ID */
  activeBapId: string | null
  /** Whether identities are loading */
  isLoading: boolean
  /** Error if fetch failed */
  error: Error | null
  /** Select an identity by BAP ID */
  selectIdentity: (bapId: string) => void
  /** Handle "Add identity" action */
  addIdentity: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://api.1sat.app"

function extractName(identity: Record<string, unknown> | undefined): string | null {
  if (!identity) return null
  if (typeof identity.name === "string") return identity.name
  if (typeof identity.alternateName === "string") return identity.alternateName
  const parts = [
    typeof identity.givenName === "string" ? identity.givenName : null,
    typeof identity.familyName === "string" ? identity.familyName : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" ") : null
}

function extractImageUrl(identity: Record<string, unknown> | undefined): string | null {
  if (!identity) return null
  if (typeof identity.image === "string") return identity.image
  return null
}

async function fetchIdentityEntry(
  bapId: string,
  apiUrl: string,
): Promise<IdentityEntry> {
  const res = await fetch(`${apiUrl}/1sat/bap/identity/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idKey: bapId }),
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch identity ${bapId}: ${res.status}`)
  }
  const data: BapIdentityRecord = await res.json()

  // Try to fetch profile for name/image
  let profileData: Record<string, unknown> | undefined
  try {
    const profileRes = await fetch(
      `${apiUrl}/1sat/bap/profile/${encodeURIComponent(bapId)}`,
    )
    if (profileRes.ok) {
      const raw: Record<string, unknown> = await profileRes.json()
      profileData = raw
    }
  } catch {
    // Profile may not exist; use identity data instead
  }

  const nameSource = profileData ?? data.identity
  return {
    bapId: data.idKey,
    name: extractName(nameSource),
    currentAddress: data.currentAddress,
    imageUrl: extractImageUrl(nameSource),
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useIdentitySelector({
  identities: identitiesProp,
  activeBapId: activeBapIdProp,
  onSelect,
  onAddIdentity,
  apiUrl = DEFAULT_API_URL,
  bapIds,
}: UseIdentitySelectorOptions): UseIdentitySelectorReturn {
  const [identities, setIdentities] = useState<IdentityEntry[]>(
    identitiesProp ?? [],
  )
  const [activeBapId, setActiveBapId] = useState<string | null>(
    activeBapIdProp ?? null,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Sync externally provided identities
  useEffect(() => {
    if (identitiesProp) {
      setIdentities(identitiesProp)
    }
  }, [identitiesProp])

  // Sync externally provided active ID
  useEffect(() => {
    if (activeBapIdProp !== undefined) {
      setActiveBapId(activeBapIdProp)
    }
  }, [activeBapIdProp])

  // Fetch identities from API when bapIds are provided and no pre-loaded list
  useEffect(() => {
    if (identitiesProp || !bapIds || bapIds.length === 0) return

    let cancelled = false
    setIsLoading(true)
    setError(null)

    async function fetchAll() {
      try {
        const entries = await Promise.all(
          // biome-ignore lint: bapIds is checked above
          bapIds!.map((id) => fetchIdentityEntry(id, apiUrl)),
        )
        if (!cancelled) {
          setIdentities(entries)
          // Default active to first if none set
          if (!activeBapIdProp && entries.length > 0) {
            setActiveBapId(entries[0].bapId)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err
              : new Error("Failed to load identities"),
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void fetchAll()

    return () => {
      cancelled = true
    }
  }, [identitiesProp, bapIds, apiUrl, activeBapIdProp])

  const selectIdentity = useCallback(
    (bapId: string) => {
      setActiveBapId(bapId)
      onSelect?.(bapId)
    },
    [onSelect],
  )

  const addIdentity = useCallback(() => {
    onAddIdentity?.()
  }, [onAddIdentity])

  return {
    identities,
    activeBapId,
    isLoading,
    error,
    selectIdentity,
    addIdentity,
  }
}
