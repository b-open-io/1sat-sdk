"use client"

import { useState, useCallback } from "react"
import { SyncTerminalUI } from "./sync-terminal-ui"
import {
  useSyncTerminal,
  type SyncEvent,
  type SyncStatus,
} from "./use-sync-terminal"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { SyncTerminalUI, type SyncTerminalUIProps } from "./sync-terminal-ui"
export {
  useSyncTerminal,
  type UseSyncTerminalOptions,
  type UseSyncTerminalReturn,
  type SyncEvent,
  type SyncEventLevel,
  type SyncStatus,
} from "./use-sync-terminal"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the composed SyncTerminal block */
export interface SyncTerminalProps {
  /** Events to display in the terminal */
  events: SyncEvent[]
  /** Optional sync status shown in the header */
  status?: SyncStatus
  /** Maximum number of events to retain in the buffer (default: 200) */
  maxEvents?: number
  /** Header title (default: "Sync Log") */
  title?: string
  /** Show timestamps in each line (default: true) */
  showTimestamps?: boolean
  /** Show source labels in each line (default: true) */
  showSource?: boolean
  /** Whether to auto-scroll to the latest event (default: true) */
  autoScroll?: boolean
  /** Whether the terminal starts open (default: false) */
  defaultOpen?: boolean
  /** Optional content rendered right-aligned in the header bar */
  headerRight?: React.ReactNode
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * Collapsible monospace event log for blockchain sync activity with
 * colour-coded severity levels. Uses shadcn Collapsible (Radix) for
 * accessible expand/collapse. Click the header to toggle.
 *
 * @example
 * ```tsx
 * import { SyncTerminal } from "@/components/blocks/sync-terminal"
 *
 * function Dashboard() {
 *   const [events, setEvents] = useState<SyncEvent[]>([])
 *
 *   return (
 *     <SyncTerminal
 *       events={events}
 *       status={{ blockHeight: 850123, connected: true }}
 *       defaultOpen={false}
 *     />
 *   )
 * }
 * ```
 */
export function SyncTerminal({
  events,
  status,
  maxEvents = 200,
  title = "Sync Log",
  showTimestamps = true,
  showSource = true,
  autoScroll = true,
  defaultOpen = false,
  headerRight,
  className,
}: SyncTerminalProps) {
  const [open, setOpen] = useState(defaultOpen)
  const { events: buffered, bottomRef } = useSyncTerminal({
    events,
    maxEvents,
    autoScroll,
  })

  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value)
  }, [])

  return (
    <SyncTerminalUI
      events={buffered}
      status={status}
      title={title}
      showTimestamps={showTimestamps}
      showSource={showSource}
      open={open}
      onOpenChange={handleOpenChange}
      bottomRef={bottomRef}
      headerRight={headerRight}
      className={className}
    />
  )
}
