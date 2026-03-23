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
  /** Whether the log area is collapsed (default: false) */
  collapsed?: boolean
  /** Callback when the header is clicked to toggle collapse */
  onToggleCollapse?: () => void
  /** Ref to attach to the scroll sentinel at the bottom */
  bottomRef?: React.RefObject<HTMLDivElement | null>
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<SyncEventLevel, string> = {
  log: "text-muted-foreground",
  warn: "text-chart-4",
  error: "text-destructive",
  success: "text-chart-2",
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
 * Uses semantic theme tokens so the terminal adapts to any shadcn theme.
 * The header is clickable to collapse/expand the log area.
 *
 * @example
 * ```tsx
 * <SyncTerminalUI
 *   events={events}
 *   status={{ blockHeight: 850123, connected: true }}
 *   collapsed={false}
 *   onToggleCollapse={() => setCollapsed(c => !c)}
 * />
 * ```
 */
export function SyncTerminalUI({
  events,
  status,
  title = "Sync Log",
  showTimestamps = true,
  showSource = true,
  collapsed = false,
  onToggleCollapse,
  bottomRef,
  className,
}: SyncTerminalUIProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll when events change if we have a bottomRef
  useEffect(() => {
    if (!collapsed && bottomRef?.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [events.length, bottomRef, collapsed])

  const renderStatusDot = useCallback(() => {
    if (!status) return null

    return (
      <div className="flex items-center gap-2 text-xs">
        <span
          className={cn(
            "inline-block size-2 rounded-full",
            status.connected ? "bg-chart-2" : "bg-muted-foreground"
          )}
          aria-label={status.connected ? "Connected" : "Disconnected"}
        />
        {status.connected && (
          <span className="text-muted-foreground">
            #{status.blockHeight.toLocaleString()}
          </span>
        )}
      </div>
    )
  }, [status])

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden border-t border-border bg-card font-mono text-xs",
        className
      )}
    >
      {/* Header — clickable to toggle collapse */}
      <button
        type="button"
        className="flex items-center justify-between border-b border-border px-3 py-1.5 hover:bg-accent/50 transition-colors cursor-pointer select-none"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        aria-controls="sync-terminal-log"
      >
        <div className="flex items-center gap-2">
          <svg
            className={cn(
              "h-3 w-3 text-muted-foreground transition-transform",
              collapsed ? "-rotate-90" : "rotate-0"
            )}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="font-semibold text-foreground text-xs">{title}</span>
          {collapsed && events.length > 0 && (
            <span className="text-muted-foreground">
              ({events.length} events)
            </span>
          )}
        </div>
        {renderStatusDot()}
      </button>

      {/* Log area — hidden when collapsed */}
      {!collapsed && (
        <div
          id="sync-terminal-log"
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-3"
          style={{ maxHeight: 200 }}
          role="log"
          aria-live="polite"
          aria-label={title}
        >
          {events.length === 0 ? (
            <p className="text-muted-foreground">No events yet.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {events.map((event, i) => (
                <div
                  key={`${event.timestamp}-${i}`}
                  className="flex gap-2 leading-5"
                >
                  {showTimestamps && (
                    <span className="shrink-0 text-muted-foreground">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  )}
                  {showSource && (
                    <span className="shrink-0 text-muted-foreground">
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
      )}
    </div>
  )
}
