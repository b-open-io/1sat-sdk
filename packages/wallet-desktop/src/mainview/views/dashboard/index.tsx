import { Skeleton } from '@/components/ui/skeleton'
import {
	ArrowDownLeft,
	ArrowUpRight,
	Coins,
	Gem,
	Lock,
	Timer,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
	HistoryEntry,
	LockDataInfo,
	TokenBalance,
} from '../../../shared/types'
import { useWallet } from '../../hooks/use-wallet'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAT_PER_BSV = 100_000_000

function satsToBsv(sats: number): string {
	return (sats / SAT_PER_BSV).toFixed(8).replace(/\.?0+$/, '') || '0'
}

/** Rough USD estimate — static rate placeholder until price feed is wired */
const BSV_USD_RATE = 60

function formatUsd(bsv: number): string {
	return (bsv * BSV_USD_RATE).toFixed(2)
}

function timeAgo(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime()
	const mins = Math.floor(diff / 60_000)
	if (mins < 1) return 'just now'
	if (mins < 60) return `${mins}m ago`
	const hrs = Math.floor(mins / 60)
	if (hrs < 24) return `${hrs}h ago`
	const days = Math.floor(hrs / 24)
	return `${days}d ago`
}

type TxStatus = 'confirmed' | 'unconfirmed' | 'failed'

function statusColor(status: TxStatus): string {
	switch (status) {
		case 'confirmed':
			return 'bg-green-500'
		case 'failed':
			return 'bg-destructive'
		default:
			return 'bg-yellow-400'
	}
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BalanceSkeleton() {
	return (
		<div className="space-y-2">
			<Skeleton className="h-3 w-20" />
			<Skeleton className="h-9 w-48" />
			<Skeleton className="h-4 w-24" />
		</div>
	)
}

function ActivityRowSkeleton() {
	return (
		<div className="flex items-center gap-3 py-3">
			<Skeleton className="size-2 shrink-0" style={{ borderRadius: 0 }} />
			<Skeleton className="h-3 flex-1" />
			<Skeleton className="h-3 w-16" />
			<Skeleton className="h-3 w-20" />
		</div>
	)
}

function AssetCardSkeleton() {
	return (
		<div className="border border-border p-4 space-y-3">
			<div className="flex items-center gap-2">
				<Skeleton className="size-8" />
				<Skeleton className="h-3 w-16" />
			</div>
			<Skeleton className="h-5 w-12" />
		</div>
	)
}

interface AssetCardProps {
	icon: React.ReactNode
	iconBg: string
	name: string
	value: string
	onClick?: () => void
}

function AssetCard({ icon, iconBg, name, value, onClick }: AssetCardProps) {
	return (
		<div
			className={`border border-border p-4 space-y-3 transition-colors${onClick ? ' cursor-pointer hover:border-primary' : ''}`}
			onClick={onClick}
			onKeyDown={
				onClick
					? (e) => {
							if (e.key === 'Enter' || e.key === ' ') onClick()
						}
					: undefined
			}
			tabIndex={onClick ? 0 : undefined}
		>
			<div className="flex items-center gap-2">
				<div
					className={`size-8 flex items-center justify-center ${iconBg}`}
					style={{ borderRadius: 0 }}
				>
					{icon}
				</div>
				<span
					className="text-[11px] uppercase tracking-wider text-muted-foreground"
					style={{ fontFamily: 'var(--font-sans)' }}
				>
					{name}
				</span>
			</div>
			<p
				className="text-lg font-bold"
				style={{ fontFamily: 'var(--font-mono)' }}
			>
				{value}
			</p>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface OverviewViewProps {
	onNavigate?: (url: string) => void
}

export function OverviewView({ onNavigate }: OverviewViewProps) {
	const { balance } = useWallet()

	// Asset counts
	const [ordinalCount, setOrdinalCount] = useState<number | null>(null)
	const [tokenCount, setTokenCount] = useState<number | null>(null)
	const [lockData, setLockData] = useState<LockDataInfo | null>(null)

	// Recent transactions
	const [recentTx, setRecentTx] = useState<HistoryEntry[] | null>(null)

	// Track whether the parallel fetch has been kicked off
	const fetchedRef = useRef(false)

	// Kick off all fetches in parallel (async-parallel rule)
	useEffect(() => {
		if (fetchedRef.current) return
		fetchedRef.current = true

		let cancelled = false

		const ordinalsPromise = rpc.request
			.getOrdinals({ limit: 1 })
			.then((r) => {
				if (!cancelled) setOrdinalCount(r.ordinals.length)
			})
			.catch(() => {
				if (!cancelled) setOrdinalCount(0)
			})

		const tokensPromise = rpc.request
			.getTokenBalances()
			.then((r: { balances: TokenBalance[] }) => {
				if (!cancelled) setTokenCount(r.balances.length)
			})
			.catch(() => {
				if (!cancelled) setTokenCount(0)
			})

		const lockPromise = rpc.request
			.getLockData()
			.then((r: LockDataInfo) => {
				if (!cancelled) setLockData(r)
			})
			.catch(() => {
				if (!cancelled)
					setLockData({ totalLocked: 0, unlockable: 0, nextUnlock: 0 })
			})

		const historyPromise = rpc.request
			.getTransactionHistory({ limit: 3 })
			.then((r) => {
				if (!cancelled) setRecentTx(r.entries)
			})
			.catch(() => {
				if (!cancelled) setRecentTx([])
			})

		// Fire and forget — we don't need Promise.all here since each sets state independently
		void ordinalsPromise
		void tokensPromise
		void lockPromise
		void historyPromise

		return () => {
			cancelled = true
		}
	}, [])

	const bsvAmount = satsToBsv(balance.confirmed)
	const usdAmount = formatUsd(balance.confirmed / SAT_PER_BSV)
	const assetsLoading =
		ordinalCount === null || tokenCount === null || lockData === null
	const activityLoading = recentTx === null

	return (
		<div
			className="mx-auto w-full py-8 px-4 space-y-8"
			style={{ maxWidth: 800 }}
		>
			{/* ── Balance ──────────────────────────────────────────────────── */}
			{balance.confirmed === 0 && assetsLoading ? (
				<BalanceSkeleton />
			) : (
				<div className="space-y-1">
					<p
						className="text-[11px] uppercase tracking-wider text-muted-foreground"
						style={{ fontFamily: 'var(--font-sans)' }}
					>
						Total Balance
					</p>
					<p
						className="text-[36px] font-bold leading-none"
						style={{ fontFamily: 'var(--font-mono)' }}
					>
						{bsvAmount} BSV
					</p>
					<p
						className="text-[13px] text-muted-foreground"
						style={{ fontFamily: 'var(--font-sans)' }}
					>
						&#8776; ${usdAmount} USD
					</p>
				</div>
			)}

			{/* ── Quick actions ────────────────────────────────────────────── */}
			<div className="flex gap-2">
				<button
					type="button"
					className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
					style={{ borderRadius: 0, fontFamily: 'var(--font-sans)' }}
					onClick={() => onNavigate?.('1sat://wallet/send')}
				>
					<ArrowUpRight size={15} />
					Send
				</button>
				<button
					type="button"
					className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
					style={{ borderRadius: 0, fontFamily: 'var(--font-sans)' }}
					onClick={() => onNavigate?.('1sat://wallet/receive')}
				>
					<ArrowDownLeft size={15} />
					Receive
				</button>
				<button
					type="button"
					className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
					style={{ borderRadius: 0, fontFamily: 'var(--font-sans)' }}
					onClick={() => onNavigate?.('1sat://locks/all')}
				>
					<Lock size={15} />
					Lock BSV
				</button>
			</div>

			{/* ── Assets ──────────────────────────────────────────────────── */}
			<div>
				<div className="h-px bg-border mb-6" />
				<div className="flex items-center justify-between mb-4">
					<span
						className="text-[10px] uppercase tracking-wider text-muted-foreground"
						style={{ fontFamily: 'var(--font-sans)' }}
					>
						Assets
					</span>
					<button
						type="button"
						className="text-[12px] text-primary hover:underline"
						style={{ fontFamily: 'var(--font-sans)' }}
						onClick={() => onNavigate?.('1sat://ordinals/gallery')}
					>
						View all &rarr;
					</button>
				</div>

				{assetsLoading ? (
					<div className="grid grid-cols-3 gap-3">
						<AssetCardSkeleton />
						<AssetCardSkeleton />
						<AssetCardSkeleton />
					</div>
				) : (
					<div className="grid grid-cols-3 gap-3">
						<AssetCard
							icon={<Gem size={16} className="text-blue-300" />}
							iconBg="bg-blue-950"
							name="Ordinals"
							value={String(ordinalCount ?? 0)}
							onClick={() => onNavigate?.('1sat://ordinals/gallery')}
						/>
						<AssetCard
							icon={<Coins size={16} className="text-yellow-300" />}
							iconBg="bg-yellow-950"
							name="BSV21 Tokens"
							value={String(tokenCount ?? 0)}
							onClick={() => onNavigate?.('1sat://tokens/all')}
						/>
						<AssetCard
							icon={<Timer size={16} className="text-purple-300" />}
							iconBg="bg-purple-950"
							name="Locked BSV"
							value={
								lockData ? `${satsToBsv(lockData.totalLocked)} BSV` : '0 BSV'
							}
							onClick={() => onNavigate?.('1sat://locks/all')}
						/>
					</div>
				)}
			</div>

			{/* ── Recent Activity ──────────────────────────────────────────── */}
			<div>
				<div className="h-px bg-border mb-6" />
				<div className="flex items-center justify-between mb-4">
					<span
						className="text-[10px] uppercase tracking-wider text-muted-foreground"
						style={{ fontFamily: 'var(--font-sans)' }}
					>
						Recent Activity
					</span>
					<button
						type="button"
						className="text-[12px] text-primary hover:underline"
						style={{ fontFamily: 'var(--font-sans)' }}
						onClick={() => onNavigate?.('1sat://wallet/history')}
					>
						View all &rarr;
					</button>
				</div>

				{activityLoading ? (
					<div>
						<ActivityRowSkeleton />
						<div className="h-px bg-border" />
						<ActivityRowSkeleton />
						<div className="h-px bg-border" />
						<ActivityRowSkeleton />
					</div>
				) : recentTx.length === 0 ? (
					<p
						className="text-[13px] text-muted-foreground py-4"
						style={{ fontFamily: 'var(--font-sans)' }}
					>
						No transactions yet.
					</p>
				) : (
					<div>
						{recentTx.map((tx, idx) => {
							const isPositive = tx.satoshis >= 0
							const status = tx.status as TxStatus
							return (
								<div key={tx.txid}>
									{idx > 0 && <div className="h-px bg-border" />}
									<div
										className="flex items-center gap-3 py-3 cursor-pointer hover:bg-muted/40 transition-colors -mx-2 px-2"
										onClick={() =>
											onNavigate?.(`1sat://wallet/tx?txid=${tx.txid}`)
										}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ')
												onNavigate?.(`1sat://wallet/tx?txid=${tx.txid}`)
										}}
										role="button"
										tabIndex={0}
									>
										<div
											className={`size-2 shrink-0 ${statusColor(status)}`}
											style={{ borderRadius: 0 }}
										/>
										<span
											className="flex-1 truncate text-[13px] text-foreground"
											style={{ fontFamily: 'var(--font-sans)' }}
										>
											{tx.description || 'Transaction'}
										</span>
										<span
											className="text-[11px] text-muted-foreground shrink-0"
											style={{ fontFamily: 'var(--font-sans)' }}
										>
											{timeAgo(tx.dateCreated)}
										</span>
										<span
											className={`text-[13px] font-medium shrink-0 ${isPositive ? 'text-green-400' : 'text-red-400'}`}
											style={{ fontFamily: 'var(--font-mono)' }}
										>
											{isPositive ? '+' : ''}
											{satsToBsv(tx.satoshis)} BSV
										</span>
									</div>
								</div>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}
