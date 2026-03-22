"use client"

import {
  IdentitySelectorUI,
  type IdentitySelectorUIProps,
} from "./identity-selector-ui"
import {
  useIdentitySelector,
  type UseIdentitySelectorOptions,
  type UseIdentitySelectorReturn,
  type IdentityEntry,
} from "./use-identity-selector"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  IdentitySelectorUI,
  type IdentitySelectorUIProps,
} from "./identity-selector-ui"
export {
  useIdentitySelector,
  type UseIdentitySelectorOptions,
  type UseIdentitySelectorReturn,
  type IdentityEntry,
} from "./use-identity-selector"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdentitySelectorProps {
  /** Pre-loaded list of identities (skips API fetch if provided) */
  identities?: IdentityEntry[]
  /** BAP ID of the currently active identity */
  activeBapId?: string
  /** List of BAP IDs to fetch from the API (used when identities prop is not provided) */
  bapIds?: string[]
  /** Called when the user selects a different identity */
  onSelect?: (bapId: string) => void
  /** Called when the user clicks "Add identity" */
  onAddIdentity?: () => void
  /** Whether to show the "Add identity" button (default: true) */
  showAddIdentity?: boolean
  /** Base URL for the 1sat-stack API (default: https://api.1sat.app) */
  apiUrl?: string
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * A dropdown panel for switching between BAP identities.
 *
 * Shows each identity with avatar, display name, and full BAP ID.
 * The active identity is highlighted with a check icon.
 *
 * Provide either a pre-loaded `identities` array or a `bapIds` list
 * to fetch identity data from the 1sat-stack API.
 *
 * @example
 * ```tsx
 * import { IdentitySelector } from "@/components/blocks/identity-selector"
 *
 * // With pre-loaded identities
 * <IdentitySelector
 *   identities={myIdentities}
 *   activeBapId="Go8vCHAa4S6AhXKdRp3nT9wJm"
 *   onSelect={(bapId) => console.log("Selected:", bapId)}
 *   onAddIdentity={() => console.log("Add identity")}
 * />
 *
 * // With API fetch
 * <IdentitySelector
 *   bapIds={["Go8vCHAa4S6AhXKdRp3nT9wJm", "Hk9wBCDe5F7AiYLmNp2qR8xTs"]}
 *   onSelect={(bapId) => console.log("Selected:", bapId)}
 * />
 * ```
 */
export function IdentitySelector({
  identities: identitiesProp,
  activeBapId: activeBapIdProp,
  bapIds,
  onSelect,
  onAddIdentity,
  showAddIdentity = true,
  apiUrl,
  className,
}: IdentitySelectorProps) {
  const hook = useIdentitySelector({
    identities: identitiesProp,
    activeBapId: activeBapIdProp,
    bapIds,
    onSelect,
    onAddIdentity,
    apiUrl,
  })

  return (
    <IdentitySelectorUI
      className={className}
      identities={hook.identities}
      activeBapId={hook.activeBapId}
      isLoading={hook.isLoading}
      error={hook.error}
      onSelect={hook.selectIdentity}
      onAddIdentity={hook.addIdentity}
      showAddIdentity={showAddIdentity}
    />
  )
}
