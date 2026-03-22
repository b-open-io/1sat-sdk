"use client"

import { useCallback, useEffect, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema.org profile fields returned by the 1sat-stack BAP API */
export interface BapProfile {
  /** Display name (givenName + familyName or name) */
  name?: string
  /** Handle / alternate name (e.g. @satoshi) */
  alternateName?: string
  /** Given (first) name */
  givenName?: string
  /** Family (last) name */
  familyName?: string
  /** Short bio / description */
  description?: string
  /** Avatar image URL (may be ord://, b://, or https://) */
  image?: string
  /** Home page or website URL */
  url?: string
}

/** BAP identity record from /1sat/bap/identity/get */
interface BapIdentityRecord {
  idKey: string
  firstSeen: number
  rootAddress: string
  currentAddress: string
  addresses: Array<{ address: string; txId: string; block: number }>
  identity?: Record<string, unknown>
}

/** Response from POST /1sat/bap/identity/validByAddress */
interface BapValidByAddressResponse {
  identity: BapIdentityRecord
  validityRecord: { valid: boolean; block: number }
  profile?: Record<string, unknown>
}

export interface UseProfileCardOptions {
  /** BAP ID to look up directly */
  bapId?: string
  /** Bitcoin address to resolve to a BAP identity */
  address?: string
  /** Base URL for the 1sat-stack API (default: https://api.1sat.app) */
  apiUrl?: string
}

export interface UseProfileCardReturn {
  /** Resolved BAP ID */
  bapId: string | null
  /** Parsed profile data */
  profile: BapProfile | null
  /** Current signing address */
  currentAddress: string | null
  /** Whether profile data is loading */
  isLoading: boolean
  /** Error if fetch failed */
  error: Error | null
  /** Refetch profile data */
  refetch: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://api.1sat.app"

function parseProfile(raw: Record<string, unknown>): BapProfile {
  return {
    name: typeof raw.name === "string" ? raw.name : undefined,
    alternateName:
      typeof raw.alternateName === "string" ? raw.alternateName : undefined,
    givenName: typeof raw.givenName === "string" ? raw.givenName : undefined,
    familyName: typeof raw.familyName === "string" ? raw.familyName : undefined,
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    image: typeof raw.image === "string" ? raw.image : undefined,
    url: typeof raw.url === "string" ? raw.url : undefined,
  }
}

function buildDisplayName(profile: BapProfile): string | undefined {
  if (profile.name) return profile.name
  if (profile.givenName || profile.familyName) {
    return [profile.givenName, profile.familyName].filter(Boolean).join(" ")
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProfileCard({
  bapId: bapIdProp,
  address,
  apiUrl = DEFAULT_API_URL,
}: UseProfileCardOptions): UseProfileCardReturn {
  const [bapId, setBapId] = useState<string | null>(bapIdProp ?? null)
  const [profile, setProfile] = useState<BapProfile | null>(null)
  const [currentAddress, setCurrentAddress] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [fetchKey, setFetchKey] = useState(0)

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!bapIdProp && !address) return

    let cancelled = false
    setIsLoading(true)
    setError(null)

    async function fetchProfile() {
      try {
        let resolvedBapId = bapIdProp ?? null
        let identityData: BapIdentityRecord | null = null

        // If we have an address but no bapId, resolve via validByAddress
        if (!resolvedBapId && address) {
          const res = await fetch(
            `${apiUrl}/1sat/bap/identity/validByAddress`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address, block: 0 }),
            },
          )
          if (!res.ok) {
            throw new Error(`Failed to resolve address: ${res.status}`)
          }
          const data: BapValidByAddressResponse = await res.json()
          resolvedBapId = data.identity.idKey
          identityData = data.identity
        }

        if (cancelled) return

        // Fetch the identity by bapId if we don't have it yet
        if (resolvedBapId && !identityData) {
          const res = await fetch(`${apiUrl}/1sat/bap/identity/get`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idKey: resolvedBapId }),
          })
          if (!res.ok) {
            throw new Error(`Failed to fetch identity: ${res.status}`)
          }
          const fetched: BapIdentityRecord = await res.json()
          identityData = fetched
        }

        if (cancelled) return

        // Fetch the profile data
        if (resolvedBapId) {
          const profileRes = await fetch(
            `${apiUrl}/1sat/bap/profile/${encodeURIComponent(resolvedBapId)}`,
          )
          if (profileRes.ok) {
            const profileRaw: Record<string, unknown> =
              await profileRes.json()
            if (cancelled) return
            const parsed = parseProfile(profileRaw)
            // Inject display name if not present
            if (!parsed.name) {
              parsed.name = buildDisplayName(parsed)
            }
            setProfile(parsed)
          }
        }

        if (cancelled) return
        setBapId(resolvedBapId)
        setCurrentAddress(identityData?.currentAddress ?? null)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err : new Error("Failed to load profile"),
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void fetchProfile()

    return () => {
      cancelled = true
    }
  }, [bapIdProp, address, apiUrl, fetchKey])

  return {
    bapId,
    profile,
    currentAddress,
    isLoading,
    error,
    refetch,
  }
}
