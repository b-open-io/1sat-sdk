"use client"

import { ProfileCardUI, type ProfileCardUIProps } from "./profile-card-ui"
import {
  useProfileCard,
  type UseProfileCardOptions,
  type UseProfileCardReturn,
  type BapProfile,
} from "./use-profile-card"
import type { ReactNode } from "react"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { ProfileCardUI, type ProfileCardUIProps } from "./profile-card-ui"
export {
  useProfileCard,
  type UseProfileCardOptions,
  type UseProfileCardReturn,
  type BapProfile,
} from "./use-profile-card"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileCardProps {
  /** BAP ID to look up directly */
  bapId?: string
  /** Bitcoin address to resolve to a BAP identity */
  address?: string
  /** Base URL for the 1sat-stack API (default: https://api.1sat.app) */
  apiUrl?: string
  /** Optional CSS class name */
  className?: string
  /** Render prop for a follow button or other action in the header */
  renderAction?: (bapId: string) => ReactNode
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * Display a BAP identity profile card with avatar, name, bio,
 * identity key, and an optional action slot (e.g. follow button).
 *
 * Fetches profile data from the 1sat-stack BAP API. Provide either
 * a `bapId` for direct lookup or an `address` to resolve the identity.
 *
 * @example
 * ```tsx
 * import { ProfileCard } from "@/components/blocks/profile-card"
 *
 * <ProfileCard bapId="Go8vCHAa4S6AhXKdRp3nT9wJm" />
 *
 * <ProfileCard
 *   address="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
 *   renderAction={(bapId) => <FollowButton bapId={bapId} />}
 * />
 * ```
 */
export function ProfileCard({
  bapId: bapIdProp,
  address,
  apiUrl,
  className,
  renderAction,
}: ProfileCardProps) {
  const hook = useProfileCard({ bapId: bapIdProp, address, apiUrl })

  return (
    <ProfileCardUI
      className={className}
      bapId={hook.bapId}
      profile={hook.profile}
      currentAddress={hook.currentAddress}
      isLoading={hook.isLoading}
      error={hook.error}
      onRetry={hook.refetch}
      renderAction={renderAction}
    />
  )
}
