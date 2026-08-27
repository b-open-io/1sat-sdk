'use client'

import { ChevronDown } from 'lucide-react'
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { SyncEvent, SyncEventLevel, SyncStatus } from './use-sync-terminal'

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
	/** Whether the log area is open (default: false) */
	open?: boolean
	/** Callback when the open state changes */
	onOpenChange?: (open: boolean) => void
	/** Ref to attach to the scroll sentinel at the bottom */
	bottomRef?: React.RefObject<HTMLDivElement | null>
	/** Optional content rendered right-aligned in the header bar */
	headerRight?: React.ReactNode
	/** Optional CSS class name */
	className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<SyncEventLevel, string> = {
	log: 'text-muted-foreground',
	warn: 'text-chart-4',
	error: 'text-destructive',
	success: 'text-chart-2',
}

/** Format a unix-ms timestamp into HH:MM:SS.mmm */
function formatTimestamp(ts: number): string {
	const d = new Date(ts)
	const h = String(d.getHours()).padStart(2, '0')
	const m = String(d.getMinutes()).padStart(2, '0')
	const s = String(d.getSeconds()).padStart(2, '0')
	const ms = String(d.getMilliseconds()).padStart(3, '0')
	return `${h}:${m}:${s}.${ms}`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: SyncStatus }) {
	return (
		<div className="flex items-center gap-2 text-xs">
			<span
				className={cn(
					'inline-block size-2 rounded-full',
					status.connected ? 'bg-chart-2' : 'bg-muted-foreground',
				)}
				aria-label={status.connected ? 'Connected' : 'Disconnected'}
			/>
			{status.connected && (
				<span className="text-muted-foreground">
					#{status.blockHeight.toLocaleString()}
				</span>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/**
 * Collapsible terminal-style event log with colour-coded severity levels.
 *
 * Uses shadcn Collapsible (Radix) for accessible expand/collapse and
 * semantic theme tokens for full theme adaptability.
 *
 * Scroll behavior is owned by the `useSyncTerminal` hook — this component
 * only renders the UI and attaches the `bottomRef` sentinel.
 */
export function SyncTerminalUI({
	events,
	status,
	title = 'Sync Log',
	showTimestamps = true,
	showSource = true,
	open = false,
	onOpenChange,
	bottomRef,
	headerRight,
	className,
}: SyncTerminalUIProps) {
	return (
		<Collapsible
			open={open}
			onOpenChange={onOpenChange}
			className={cn(
				'flex flex-col overflow-hidden border-t border-border bg-card font-mono text-xs',
				className,
			)}
		>
			<CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-accent/50 transition-colors cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
				<div className="flex items-center gap-2">
					<ChevronDown
						className={cn(
							'h-3 w-3 text-muted-foreground transition-transform',
							!open && '-rotate-90',
						)}
					/>
					<span className="font-semibold text-foreground text-xs">{title}</span>
					{!open && events.length > 0 && (
						<span className="text-muted-foreground">
							({events.length} events)
						</span>
					)}
				</div>
				<div className="flex items-center gap-3">
					{status && <StatusDot status={status} />}
					{headerRight}
				</div>
			</CollapsibleTrigger>

			<CollapsibleContent>
				<div
					className="overflow-y-auto p-3 max-h-[200px]"
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
							<div ref={bottomRef} />
						</div>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}
