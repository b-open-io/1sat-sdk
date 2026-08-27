import {
	ArrowDownLeft,
	ArrowUpRight,
	ExternalLink,
	History,
	Loader2,
} from 'lucide-react'
import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { HistoryEntry, TransactionStatus } from './use-transaction-history'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the TransactionHistoryUI presentation component */
export interface TransactionHistoryUIProps {
	/** Transaction entries to display */
	entries: HistoryEntry[]
	/** Whether the list is loading */
	isLoading: boolean
	/** Error from the last fetch attempt */
	error: Error | null
	/** Whether more entries can be loaded */
	hasMore?: boolean
	/** Load the next page of entries */
	onLoadMore?: () => void
	/** Callback when a row is clicked */
	onRowClick?: (txid: string) => void
	/** Callback for external link button (e.g. open in block explorer) */
	onExternalLink?: (url: string) => void
	/** Visual variant: "default" shows full details, "compact" shows description + amount only */
	variant?: 'default' | 'compact'
	/** Number of skeleton rows to show while loading (default: 5) */
	skeletonCount?: number
	/** Optional CSS class name */
	className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Status dot color mapping using semantic tokens */
function statusDotClass(status: TransactionStatus): string {
	switch (status) {
		case 'completed':
			return 'bg-chart-2'
		case 'sending':
		case 'unproven':
			return 'bg-chart-4'
		case 'failed':
			return 'bg-destructive'
	}
}

/** Status label for screen readers */
function statusLabel(status: TransactionStatus): string {
	switch (status) {
		case 'completed':
			return 'Completed'
		case 'sending':
			return 'Sending'
		case 'unproven':
			return 'Unproven'
		case 'failed':
			return 'Failed'
	}
}

/** Format satoshi amount for display */
function formatSatoshis(satoshis: number): string {
	const abs = Math.abs(satoshis)
	if (abs >= 100_000_000) {
		return `${(satoshis / 100_000_000).toFixed(8)} BSV`
	}
	return `${satoshis.toLocaleString()} sat`
}

/** Truncate a txid for display */
function truncateTxid(txid: string): string {
	if (txid.length <= 16) return txid
	return `${txid.slice(0, 8)}...${txid.slice(-6)}`
}

/** Relative time from an ISO date string */
function relativeTime(isoDate: string): string {
	const now = Date.now()
	const then = new Date(isoDate).getTime()
	const diffMs = now - then

	const seconds = Math.floor(diffMs / 1000)
	if (seconds < 60) return 'just now'

	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`

	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`

	const days = Math.floor(hours / 24)
	if (days < 30) return `${days}d ago`

	const months = Math.floor(days / 30)
	if (months < 12) return `${months}mo ago`

	const years = Math.floor(months / 12)
	return `${years}y ago`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TransactionRowProps {
	entry: HistoryEntry
	variant: 'default' | 'compact'
	onRowClick?: (txid: string) => void
	onExternalLink?: (url: string) => void
	isLast: boolean
}

function TransactionRow({
	entry,
	variant,
	onRowClick,
	onExternalLink,
	isLast,
}: TransactionRowProps) {
	const isInbound = entry.satoshis >= 0
	const isInteractive = !!onRowClick

	const handleClick = useCallback(() => {
		onRowClick?.(entry.txid)
	}, [onRowClick, entry.txid])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault()
				onRowClick?.(entry.txid)
			}
		},
		[onRowClick, entry.txid],
	)

	const handleExternalClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			onExternalLink?.(entry.txid)
		},
		[onExternalLink, entry.txid],
	)

	return (
		<>
			<div
				role={isInteractive ? 'button' : undefined}
				tabIndex={isInteractive ? 0 : undefined}
				className={cn(
					'flex items-center gap-3 px-4 py-3',
					isInteractive &&
						'cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md',
				)}
				onClick={isInteractive ? handleClick : undefined}
				onKeyDown={isInteractive ? handleKeyDown : undefined}
				aria-label={
					isInteractive
						? `${entry.description}, ${formatSatoshis(entry.satoshis)}, ${statusLabel(entry.status)}`
						: undefined
				}
			>
				{/* Direction icon + status dot */}
				<div className="relative flex-shrink-0">
					<div
						className={cn(
							'flex items-center justify-center size-9 rounded-full',
							isInbound
								? 'bg-chart-2/10 text-chart-2'
								: 'bg-muted text-muted-foreground',
						)}
					>
						{isInbound ? (
							<ArrowDownLeft className="size-4" data-icon aria-hidden="true" />
						) : (
							<ArrowUpRight className="size-4" data-icon aria-hidden="true" />
						)}
					</div>
					<span
						className={cn(
							'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background',
							statusDotClass(entry.status),
						)}
						aria-label={statusLabel(entry.status)}
					/>
				</div>

				{/* Description + txid */}
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium text-foreground truncate">
						{entry.description}
					</p>
					{variant === 'default' && (
						<div className="flex items-center gap-1.5">
							<span className="text-xs text-muted-foreground font-mono truncate">
								{truncateTxid(entry.txid)}
							</span>
							{onExternalLink && (
								<button
									type="button"
									onClick={handleExternalClick}
									className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
									aria-label={`Open transaction ${truncateTxid(entry.txid)} in explorer`}
								>
									<ExternalLink
										className="size-3"
										data-icon
										aria-hidden="true"
									/>
								</button>
							)}
						</div>
					)}
				</div>

				{/* Amount + date */}
				<div className="flex flex-col items-end gap-0.5 flex-shrink-0">
					<span
						className={cn(
							'text-sm font-semibold tabular-nums',
							isInbound ? 'text-chart-2' : 'text-foreground',
						)}
					>
						{isInbound ? '+' : ''}
						{formatSatoshis(entry.satoshis)}
					</span>
					{variant === 'default' && (
						<span className="text-xs text-muted-foreground">
							{relativeTime(entry.dateCreated)}
						</span>
					)}
				</div>
			</div>
			{!isLast && <Separator />}
		</>
	)
}

function SkeletonRow({
	variant,
	isLast,
}: {
	variant: 'default' | 'compact'
	isLast: boolean
}) {
	return (
		<>
			<div className="flex items-center gap-3 px-4 py-3">
				<Skeleton className="size-9 rounded-full flex-shrink-0" />
				<div className="flex-1 flex flex-col gap-1.5">
					<Skeleton className="h-4 w-32" />
					{variant === 'default' && <Skeleton className="h-3 w-24" />}
				</div>
				<div className="flex flex-col items-end gap-1.5">
					<Skeleton className="h-4 w-20" />
					{variant === 'default' && <Skeleton className="h-3 w-12" />}
				</div>
			</div>
			{!isLast && <Separator />}
		</>
	)
}

// ---------------------------------------------------------------------------
// Main UI
// ---------------------------------------------------------------------------

/**
 * Pure presentation component for a list of transaction history entries.
 *
 * Renders loading skeletons, an empty state, an error state, or the
 * transaction rows with optional "Load more" pagination. Supports
 * "default" (full detail) and "compact" (description + amount) variants.
 */
export function TransactionHistoryUI({
	entries,
	isLoading,
	error,
	hasMore = false,
	onLoadMore,
	onRowClick,
	onExternalLink,
	variant = 'default',
	skeletonCount = 5,
	className,
}: TransactionHistoryUIProps) {
	// Loading state (initial)
	if (isLoading && entries.length === 0) {
		return (
			<Card className={cn('w-full', className)}>
				<CardContent className="p-0">
					{Array.from({ length: skeletonCount }, (_, i) => (
						<SkeletonRow
							key={`skeleton-${i}`}
							variant={variant}
							isLast={i === skeletonCount - 1}
						/>
					))}
				</CardContent>
			</Card>
		)
	}

	// Error state
	if (error) {
		return (
			<Card className={cn('w-full', className)}>
				<CardContent className="flex flex-col items-center gap-2 py-10">
					<History className="size-10 text-destructive/60" aria-hidden="true" />
					<p className="text-sm font-medium text-destructive">
						Failed to load transactions
					</p>
					<p className="text-xs text-muted-foreground">{error.message}</p>
				</CardContent>
			</Card>
		)
	}

	// Empty state
	if (entries.length === 0) {
		return (
			<Card className={cn('w-full', className)}>
				<CardContent className="flex flex-col items-center gap-2 py-10">
					<History
						className="size-10 text-muted-foreground/50"
						aria-hidden="true"
					/>
					<p className="text-sm text-muted-foreground">No transactions yet</p>
				</CardContent>
			</Card>
		)
	}

	// Transaction list
	return (
		<Card className={cn('w-full overflow-hidden', className)}>
			<CardContent className="p-0">
				{entries.map((entry, index) => (
					<TransactionRow
						key={entry.txid}
						entry={entry}
						variant={variant}
						onRowClick={onRowClick}
						onExternalLink={onExternalLink}
						isLast={index === entries.length - 1 && !hasMore}
					/>
				))}
				{hasMore && (
					<>
						<Separator />
						<div className="flex justify-center py-3">
							<Button
								variant="ghost"
								size="sm"
								onClick={onLoadMore}
								disabled={isLoading}
							>
								{isLoading ? (
									<Loader2
										className="size-4 animate-spin"
										data-icon
										aria-hidden="true"
									/>
								) : null}
								{isLoading ? 'Loading...' : 'Load more'}
							</Button>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	)
}
