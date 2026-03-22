import { useEffect, useRef } from 'react'
import type { SyncEvent } from '../../shared/types'

interface SyncTerminalProps {
	events: SyncEvent[]
}

function formatTimestamp(ts: number): string {
	const d = new Date(ts)
	return d.toLocaleTimeString('en-US', { hour12: false })
}

const levelColors: Record<SyncEvent['level'], string> = {
	log: 'text-muted-foreground',
	warn: 'text-amber-400',
	error: 'text-rose-400',
}

export function SyncTerminal({ events }: SyncTerminalProps) {
	const scrollRef = useRef<HTMLDivElement>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: scrollRef is a stable ref object
	useEffect(() => {
		const el = scrollRef.current
		if (el) {
			el.scrollTop = el.scrollHeight
		}
	}, [events])

	return (
		<div className="border-t border-border bg-card flex flex-col">
			<div className="px-3 py-2 border-b border-border text-xs font-mono uppercase tracking-wider text-muted-foreground">
				Sync Log
			</div>
			<div
				ref={scrollRef}
				className="p-3 overflow-y-auto max-h-48 font-mono text-xs leading-relaxed"
			>
				{events.length === 0 ? (
					<div className="text-muted-foreground/50">Waiting for events...</div>
				) : (
					events.map((event, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: append-only log entries have no stable id
							key={i}
							className="flex gap-2"
						>
							<span className="text-muted-foreground/60 shrink-0">
								{formatTimestamp(event.timestamp)}
							</span>
							<span className="text-muted-foreground/80 shrink-0">
								[{event.source}]
							</span>
							<span className={levelColors[event.level]}>{event.message}</span>
						</div>
					))
				)}
			</div>
		</div>
	)
}
