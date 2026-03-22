import { useCallback, useEffect, useMemo, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity level for a sync event */
export type SyncEventLevel = "log" | "warn" | "error" | "success"

/** A single event entry in the sync terminal */
export interface SyncEvent {
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Origin of the event (e.g. "sync", "wallet", "http") */
  source: string
  /** Severity level */
  level: SyncEventLevel
  /** Human-readable message */
  message: string
}

/** Current sync status indicator */
export interface SyncStatus {
  /** Latest block height */
  blockHeight: number
  /** Whether the node/service is connected */
  connected: boolean
}

/** Options for the useSyncTerminal hook */
export interface UseSyncTerminalOptions {
  /** Initial events to populate the terminal with */
  events?: SyncEvent[]
  /** Maximum number of events to retain in the buffer (default: 200) */
  maxEvents?: number
  /** Whether to auto-scroll to the latest event (default: true) */
  autoScroll?: boolean
}

/** Return value of the useSyncTerminal hook */
export interface UseSyncTerminalReturn {
  /** Current buffered events (sliced to maxEvents) */
  events: SyncEvent[]
  /** Ref to attach to the scroll-bottom sentinel element */
  bottomRef: React.RefObject<HTMLDivElement | null>
  /** Append a single event to the buffer */
  push: (event: SyncEvent) => void
  /** Append multiple events to the buffer */
  pushMany: (events: SyncEvent[]) => void
  /** Clear all events */
  clear: () => void
  /** Whether auto-scroll is currently active */
  isAutoScroll: boolean
  /** Toggle auto-scroll on or off */
  setAutoScroll: (value: boolean) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the event buffer and auto-scroll behaviour for a sync terminal.
 *
 * Events are kept in a fixed-size ring buffer (default 200). When new events
 * are pushed and `autoScroll` is enabled, the hook scrolls the sentinel ref
 * into view after each render.
 *
 * @example
 * ```ts
 * const { events, bottomRef, push, clear } = useSyncTerminal({
 *   maxEvents: 500,
 * })
 *
 * push({ timestamp: Date.now(), source: "sync", level: "log", message: "Block 850001" })
 * ```
 */
export function useSyncTerminal(
  options: UseSyncTerminalOptions = {}
): UseSyncTerminalReturn {
  const {
    events: initialEvents,
    maxEvents = 200,
    autoScroll: initialAutoScroll = true,
  } = options

  const [buffer, setBuffer] = useState<SyncEvent[]>(
    () => initialEvents?.slice(-maxEvents) ?? []
  )
  const [isAutoScroll, setAutoScroll] = useState(initialAutoScroll)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Scroll to bottom when buffer changes and auto-scroll is on
  useEffect(() => {
    if (isAutoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [buffer, isAutoScroll])

  // Sync external events prop into buffer when it changes
  const externalKey = useMemo(
    () => (initialEvents ? initialEvents.length : -1),
    [initialEvents]
  )

  useEffect(() => {
    if (initialEvents) {
      setBuffer(initialEvents.slice(-maxEvents))
    }
  }, [externalKey, maxEvents])

  const push = useCallback(
    (event: SyncEvent) => {
      setBuffer((prev) => {
        const next = [...prev, event]
        return next.length > maxEvents ? next.slice(-maxEvents) : next
      })
    },
    [maxEvents]
  )

  const pushMany = useCallback(
    (events: SyncEvent[]) => {
      setBuffer((prev) => {
        const next = [...prev, ...events]
        return next.length > maxEvents ? next.slice(-maxEvents) : next
      })
    },
    [maxEvents]
  )

  const clear = useCallback(() => {
    setBuffer([])
  }, [])

  return {
    events: buffer,
    bottomRef,
    push,
    pushMany,
    clear,
    isAutoScroll,
    setAutoScroll,
  }
}
