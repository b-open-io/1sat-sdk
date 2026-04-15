import { Empty } from '@/components/ui/empty'
import { Clock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { HistoryEntry } from '../../../shared/types'
import { cn } from '../../lib/utils'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'sent' | 'received'

interface HistoryViewProps {
	onNavigate?: (url: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILTER_TABS: { id: FilterTab; label: string }[] = [
	{ id: 'all', label: 'All' },
	{ id: 'sent', label: 'Sent' },
	{ id: 'received', label: 'Received' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
	const d = new Date(iso)
	return d.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	})
}

function truncateTxid(txid: string): string {
	if (txid.length <= 16) return txid
	return `${txid.slice(0, 8)}…${txid.slice(-8)}`
}

function formatSatoshis(satoshis: number): string {
	const abs = Math.abs(satoshis)
	const bsv = abs / 1e8
	return bsv.toFixed(8)
}

/** Returns the dot fill color for the status indicator. */
function statusDotColor(status: string, satoshis: number): string {
	if (satoshis > 0) return '#22c55e'
	if (status === 'mint' || status === 'inscribe') return '#3b82f6'
	return 'var(--muted-foreground)'
}

function getSubtitle(status: string): string {
	switch (status) {
		case 'received':
			return 'BSV Received'
		case 'sent':
			return 'BSV Transfer'
		case 'mint':
			return 'Mint'
		case 'inscribe':
			return 'Inscribe'
		default:
			return status.charAt(0).toUpperCase() + status.slice(1)
	}
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SkeletonRow() {
	return (
		<div
			className="flex items-center border-b border-border bg-background px-4"
			style={{ height: 48 }}
		>
			<div className="flex items-center" style={{ width: 24 }}>
				<div className="size-2 rounded-full bg-muted animate-pulse" />
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="h-3 w-32 animate-pulse rounded bg-muted" />
				<div className="h-2.5 w-20 animate-pulse rounded bg-muted opacity-60" />
			</div>
			<div style={{ width: 200 }}>
				<div className="h-2.5 w-28 animate-pulse rounded bg-muted" />
			</div>
			<div className="flex justify-end" style={{ width: 120 }}>
				<div className="h-3 w-20 animate-pulse rounded bg-muted" />
			</div>
			<div className="flex justify-end" style={{ width: 120 }}>
				<div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HistoryView({ onNavigate }: HistoryViewProps) {
	const [entries, setEntries] = useState<HistoryEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)
	const [filter, setFilter] = useState<FilterTab>('all')

	const scrollRef = useRef<HTMLDivElement>(null)

	// Load transaction history on mount
	useEffect(() => {
		let cancelled = false

		rpc.request
			.getTransactionHistory({ limit: 50 })
			.then((result) => {
				if (!cancelled) setEntries(result.entries)
			})
			.catch((err) => {
				if (!cancelled)
					setError(
						err instanceof Error
							? err
							: new Error('Failed to load transaction history'),
					)
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [])

	// Scroll to top when filter changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: filter is the intentional trigger
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: 0 })
	}, [filter])

	const filtered = useMemo(() => {
		if (filter === 'all') return entries
		if (filter === 'sent') return entries.filter((e) => e.satoshis < 0)
		return entries.filter((e) => e.satoshis >= 0)
	}, [entries, filter])

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			{/* ── Content area ────────────────────────────────────────────── */}
			<div
				ref={scrollRef}
				className="flex-1 overflow-y-auto"
				style={{ padding: 24 }}
			>
				{/* Title + filter row */}
				<div
					className="flex items-center justify-between"
					style={{ marginBottom: 20 }}
				>
					<h1
						className="font-[family-name:var(--font-sans)] text-foreground"
						style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}
					>
						Transaction History
					</h1>

					{/* Filter tabs */}
					<div
						className="flex items-center bg-muted"
						style={{ gap: 2, padding: 2, height: 28 }}
					>
						{FILTER_TABS.map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setFilter(tab.id)}
								className={cn(
									'font-[family-name:var(--font-sans)] px-3 transition-colors',
									filter === tab.id
										? 'bg-card text-foreground'
										: 'text-muted-foreground hover:text-foreground',
								)}
								style={{
									fontSize: 11,
									fontWeight: filter === tab.id ? 500 : 400,
									height: '100%',
									border: 'none',
									cursor: 'pointer',
								}}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>

				{/* Table */}
				<div className="w-full border border-border">
					{/* Table header */}
					<div
						className="flex items-center bg-card border-b border-border"
						style={{ height: 36, paddingLeft: 16, paddingRight: 16 }}
					>
						<div
							className="shrink-0 text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{ width: 24, fontSize: 11, fontWeight: 600 }}
						/>
						<div
							className="flex-1 min-w-0 text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{ fontSize: 11, fontWeight: 600 }}
						>
							Description
						</div>
						<div
							className="shrink-0 text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{ width: 200, fontSize: 11, fontWeight: 600 }}
						>
							TxID
						</div>
						<div
							className="shrink-0 text-right text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{ width: 120, fontSize: 11, fontWeight: 600 }}
						>
							Amount
						</div>
						<div
							className="shrink-0 text-right text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{ width: 120, fontSize: 11, fontWeight: 600 }}
						>
							Date
						</div>
					</div>

					{/* Table body */}
					{loading ? (
						<>
							{Array.from({ length: 8 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
								<SkeletonRow key={i} />
							))}
						</>
					) : error ? (
						<div
							className="flex items-center justify-center bg-background text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{ height: 120, fontSize: 13 }}
						>
							{error.message}
						</div>
					) : filtered.length === 0 ? (
						<Empty
							icon={Clock}
							title="No transactions yet"
							description="Transaction history appears after you send or receive BSV."
						/>
					) : (
						filtered.map((entry) => {
							const isPositive = entry.satoshis >= 0
							const dotColor = statusDotColor(entry.status, entry.satoshis)
							const subtitle = getSubtitle(entry.status)

							return (
								<button
									key={entry.txid}
									type="button"
									className="flex w-full items-center border-b border-border bg-background text-left transition-colors hover:bg-card"
									style={{
										height: 48,
										paddingLeft: 16,
										paddingRight: 16,
										cursor: 'pointer',
									}}
									onClick={() =>
										onNavigate?.(`1sat://wallet/tx?txid=${entry.txid}`)
									}
								>
									{/* Status dot */}
									<div
										className="shrink-0 flex items-center"
										style={{ width: 24 }}
									>
										<span
											className="inline-block rounded-full"
											style={{
												width: 8,
												height: 8,
												backgroundColor: dotColor,
												flexShrink: 0,
											}}
										/>
									</div>

									{/* Description + subtitle */}
									<div className="flex-1 min-w-0 flex flex-col justify-center">
										<p
											className="truncate font-[family-name:var(--font-sans)] text-foreground leading-tight"
											style={{ fontSize: 13, fontWeight: 500 }}
										>
											{entry.description || subtitle}
										</p>
										<p
											className="font-[family-name:var(--font-sans)] text-muted-foreground leading-tight"
											style={{ fontSize: 11, fontWeight: 400 }}
										>
											{subtitle}
										</p>
									</div>

									{/* TxID */}
									<div className="shrink-0 truncate" style={{ width: 200 }}>
										<span
											className="font-[family-name:var(--font-mono)] text-muted-foreground"
											style={{ fontSize: 11 }}
										>
											{truncateTxid(entry.txid)}
										</span>
									</div>

									{/* Amount */}
									<div className="shrink-0 text-right" style={{ width: 120 }}>
										<span
											className="font-[family-name:var(--font-mono)]"
											style={{
												fontSize: 12,
												fontWeight: 600,
												color: isPositive
													? '#22c55e'
													: 'var(--muted-foreground)',
											}}
										>
											{isPositive ? '+' : '-'}
											{formatSatoshis(entry.satoshis)}
										</span>
									</div>

									{/* Date */}
									<div className="shrink-0 text-right" style={{ width: 120 }}>
										<span
											className="font-[family-name:var(--font-sans)] text-muted-foreground"
											style={{ fontSize: 11 }}
										>
											{formatDate(entry.dateCreated)}
										</span>
									</div>
								</button>
							)
						})
					)}
				</div>
			</div>
		</div>
	)
}
