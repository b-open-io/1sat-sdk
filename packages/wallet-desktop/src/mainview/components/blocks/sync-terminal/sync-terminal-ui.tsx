"use client"

import { useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import type { SyncEvent, SyncEventLevel, SyncStatus } from "./use-sync-terminal"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncTerminalUIProps {
  /** Events to display in the terminal */
  events: SyncEvent[]
  /** Optional sync status shown in the header */
  status?: SyncStatus
  /** Header title (default: "Sync Log") */
  title?: string
  /** Show timestamps in each line (default: true) */
  showTimestamps?: boolean
  /** Show source labels in each line (default: true) */
  showSource?: boolean
  /** Ref to attach to the scroll sentinel at the bottom */
  bottomRef?: React.RefObject<HTMLDivElement | null>
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<SyncEventLevel, string> = {
  log: "text-zinc-400",
  warn: "text-amber-400",
  error: "text-rose-400",
  success: "text-emerald-400",
}

/** Format a unix-ms timestamp into HH:MM:SS.mmm */
function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, "0")
  const m = String(d.getMinutes()).padStart(2, "0")
  const s = String(d.getSeconds()).padStart(2, "0")
  const ms = String(d.getMilliseconds()).padStart(3, "0")
  return `${h}:${m}:${s}.${ms}`
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/**
 * Terminal-style event log display with colour-coded severity levels.
 *
 * Uses a dark background (bg-zinc-950) and monospace font regardless of theme
 * since this intentionally emulates a terminal console.
 *
 * @example
 * ```tsx
 * <SyncTerminalUI
 *   events={events}
 *   status={{ blockHeight: 850123, connected: true }}
 * />
 * ```
 */
export function SyncTerminalUI({
  events,
  status,
  title = "Sync Log",
  showTimestamps = true,
  showSource = true,
  bottomRef,
  className,
}: SyncTerminalUIProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll when events change if we have a bottomRef
  useEffect(() => {
    if (bottomRef?.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [events.length, bottomRef])

  const renderStatusDot = useCallback(() => {
    if (!status) return null

    return (
      <div className="flex items-center gap-2 text-xs">
        <span
          className={cn(
            "inline-block size-2 rounded-full",
            status.connected ? "bg-emerald-400" : "bg-zinc-600"
          )}
          aria-label={status.connected ? "Connected" : "Disconnected"}
        />
        {status.connected && (
          <span className="text-zinc-500">
            #{status.blockHeight.toLocaleString()}
          </span>
        )}
      </div>
    )
  }, [status])

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="font-semibold text-zinc-300">{title}</span>
        {renderStatusDot()}
      </div>

      {/* Log area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-3"
        style={{ maxHeight: 400 }}
        role="log"
        aria-live="polite"
        aria-label={title}
      >
        {events.length === 0 ? (
          <p className="text-zinc-600">No events yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {events.map((event, i) => (
              <div
                key={`${event.timestamp}-${i}`}
                className="flex gap-2 leading-5"
              >
                {showTimestamps && (
                  <span className="shrink-0 text-zinc-600">
                    {formatTimestamp(event.timestamp)}
                  </span>
                )}
                {showSource && (
                  <span className="shrink-0 text-zinc-500">
                    [{event.source}]
                  </span>
                )}
                <span className={LEVEL_COLORS[event.level]}>
                  {event.message}
                </span>
              </div>
            ))}
            {/* Scroll sentinel */}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}
