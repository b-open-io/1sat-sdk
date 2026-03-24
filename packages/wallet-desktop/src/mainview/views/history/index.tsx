import { useEffect, useMemo, useState } from 'react'
import type { HistoryEntry } from '../../../shared/types'
import { rpc } from '../../rpc'

type FilterTab = 'all' | 'sent' | 'received'

interface HistoryViewProps {
	onNavigate?: (url: string) => void
}

const FILTER_TABS: { id: FilterTab; label: string }[] = [
	{ id: 'all', label: 'All' },
	{ id: 'sent', label: 'Sent' },
	{ id: 'received', label: 'Received' },
]

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
	const bsv = Math.abs(satoshis) / 1e8
	return bsv.toFixed(8)
}

function getStatusColor(status: string, satoshis: number): string {
	if (satoshis > 0) return 'bg-green-500'
	if (status === 'mint') return 'bg-blue-500'
	return 'bg-muted-foreground'
}

function getSubtitle(status: string): string {
	if (status === 'received') return 'BSV Received'
	if (status === 'sent') return 'BSV Transfer'
	if (status === 'mint') return 'Mint'
	return status
}

function SkeletonRow() {
	return (
		<div className="flex items-center gap-4 px-6 h-12 border-b border-border">
			<div className="w-2 h-2 bg-muted animate-pulse" />
			<div className="flex-1 min-w-0">
				<div className="h-3 w-32 bg-muted animate-pulse mb-1" />
				<div className="h-2 w-20 bg-muted animate-pulse opacity-50" />
			</div>
			<div className="w-36 hidden sm:block">
				<div className="h-2.5 w-28 bg-muted animate-pulse" />
			</div>
			<div className="w-28 text-right">
				<div className="h-3 w-20 bg-muted animate-pulse ml-auto" />
			</div>
			<div className="w-24 text-right hidden md:block">
				<div className="h-2.5 w-16 bg-muted animate-pulse ml-auto" />
			</div>
		</div>
	)
}

export function HistoryView({ onNavigate }: HistoryViewProps) {
	const [entries, setEntries] = useState<HistoryEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)
	const [filter, setFilter] = useState<FilterTab>('all')

	useEffect(() => {
		rpc.request
			.getTransactionHistory({ limit: 50 })
			.then((result) => {
				setEntries(result.entries)
			})
			.catch((err) => {
				setError(
					err instanceof Error
						? err
						: new Error('Failed to load transaction history'),
				)
			})
			.finally(() => {
				setLoading(false)
			})
	}, [])

	const filtered = useMemo(() => {
		if (filter === 'all') return entries
		if (filter === 'sent') return entries.filter((e) => e.satoshis < 0)
		return entries.filter((e) => e.satoshis >= 0)
	}, [entries, filter])

	return (
		<div className="w-full">
			{/* Header */}
			<div className="px-6 py-4 border-b border-border">
				<h1 className="text-[20px] font-bold text-foreground leading-none mb-3">
					Transaction History
				</h1>
				<div className="flex gap-1">
					{FILTER_TABS.map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => setFilter(tab.id)}
							className={[
								'px-3 py-1.5 text-[11px] font-medium transition-colors',
								filter === tab.id
									? 'bg-secondary text-secondary-foreground'
									: 'text-muted-foreground hover:text-foreground',
							].join(' ')}
						>
							{tab.label}
						</button>
					))}
				</div>
			</div>

			{/* Table header */}
			<div className="flex items-center gap-4 px-6 h-9 border-b border-border">
				<div className="w-2 shrink-0" />
				<div className="flex-1 min-w-0 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
					Description
				</div>
				<div className="w-36 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:block">
					TxID
				</div>
				<div className="w-28 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
					Amount
				</div>
				<div className="w-24 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider hidden md:block">
					Date
				</div>
			</div>

			{/* Body */}
			{loading ? (
				<>
					{Array.from({ length: 8 }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
						<SkeletonRow key={i} />
					))}
				</>
			) : error ? (
				<div className="px-6 py-12 text-center text-muted-foreground text-sm">
					{error.message}
				</div>
			) : filtered.length === 0 ? (
				<div className="px-6 py-12 text-center text-muted-foreground text-sm">
					No transactions yet
				</div>
			) : (
				filtered.map((entry) => (
					<button
						type="button"
						key={entry.txid}
						className="flex items-center gap-4 px-6 h-12 border-b border-border cursor-pointer hover:bg-card transition-colors w-full text-left"
						onClick={() => onNavigate?.(`1sat://wallet/tx?txid=${entry.txid}`)}
					>
						{/* Status dot (square) */}
						<div
							className={[
								'w-2 h-2 shrink-0',
								getStatusColor(entry.status, entry.satoshis),
							].join(' ')}
						/>

						{/* Description + subtitle */}
						<div className="flex-1 min-w-0">
							<p className="text-[12px] font-medium text-foreground font-[family-name:var(--font-sans)] truncate leading-tight">
								{entry.description || getSubtitle(entry.status)}
							</p>
							<p className="text-[9px] text-muted-foreground leading-tight mt-0.5">
								{getSubtitle(entry.status)}
							</p>
						</div>

						{/* TxID */}
						<div className="w-36 hidden sm:block">
							<span className="text-[10px] text-muted-foreground font-mono font-[family-name:var(--font-mono)]">
								{truncateTxid(entry.txid)}
							</span>
						</div>

						{/* Amount */}
						<div className="w-28 text-right">
							<span
								className={[
									'text-[12px] font-mono font-[family-name:var(--font-mono)]',
									entry.satoshis >= 0
										? 'text-green-500'
										: 'text-muted-foreground',
								].join(' ')}
							>
								{entry.satoshis >= 0 ? '+' : '-'}
								{formatSatoshis(entry.satoshis)}
							</span>
						</div>

						{/* Date */}
						<div className="w-24 text-right hidden md:block">
							<span className="text-[10px] text-muted-foreground font-[family-name:var(--font-sans)]">
								{formatDate(entry.dateCreated)}
							</span>
						</div>
					</button>
				))
			)}
		</div>
	)
}
