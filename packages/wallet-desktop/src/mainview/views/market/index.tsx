import { ImageOff, RefreshCw, Search, Store } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Empty } from '@/components/ui/empty'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { STACK_URL } from '../../../shared/constants'

// ─── Types ────────────────────────────────────────────────────────────────────

type SortMode = 'recent' | 'price-asc' | 'price-desc'

interface Listing {
	id: string
	outpoint: string
	name: string
	priceSats: number
	seller: string
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

function truncateOutpoint(outpoint: string): string {
	if (outpoint.length <= 14) return outpoint
	return `${outpoint.slice(0, 8)}…${outpoint.slice(-4)}`
}

// biome-ignore lint/suspicious/noExplicitAny: API response shape is not typed
function parseListings(raw: any): Listing[] {
	const items: unknown[] = Array.isArray(raw)
		? raw
		: Array.isArray(raw?.listings)
			? raw.listings
			: Array.isArray(raw?.data)
				? raw.data
				: []

	return items
		.map((item, index) => {
			// biome-ignore lint/suspicious/noExplicitAny: defensive parse
			const r = item as Record<string, any>

			const outpoint: string =
				typeof r?.outpoint === 'string'
					? r.outpoint
					: typeof r?.txid === 'string' && typeof r?.vout === 'number'
						? `${r.txid}_${r.vout}`
						: `unknown_${index}`

			const priceSats: number =
				typeof r?.price === 'number'
					? r.price
					: typeof r?.priceSats === 'number'
						? r.priceSats
						: typeof r?.satoshis === 'number'
							? r.satoshis
							: 0

			const seller: string =
				typeof r?.owner === 'string'
					? r.owner
					: typeof r?.seller === 'string'
						? r.seller
						: typeof r?.address === 'string'
							? r.address
							: 'unknown'

			const rawName: string =
				typeof r?.name === 'string'
					? r.name
					: typeof r?.metadata?.name === 'string'
						? r.metadata.name
						: typeof r?.origin?.data?.map?.name === 'string'
							? r.origin.data.map.name
							: ''

			const name = rawName || truncateOutpoint(outpoint)

			return {
				id: outpoint || String(index),
				outpoint,
				name,
				priceSats,
				seller,
			} satisfies Listing
		})
		.filter((l) => l.outpoint !== `unknown_${0}` || l.id !== '0')
}

// ─── Sort helper ──────────────────────────────────────────────────────────────

function sortListings(items: Listing[], mode: SortMode): Listing[] {
	if (mode === 'price-asc') {
		return [...items].sort((a, b) => a.priceSats - b.priceSats)
	}
	if (mode === 'price-desc') {
		return [...items].sort((a, b) => b.priceSats - a.priceSats)
	}
	return items
}

// ─── Price formatter ──────────────────────────────────────────────────────────

function formatSats(sats: number): string {
	if (sats >= 1_000_000) {
		return `${(sats / 1_000_000).toFixed(2)}M`
	}
	if (sats >= 1_000) {
		return `${(sats / 1_000).toFixed(0)}K`
	}
	return sats.toLocaleString()
}

// ─── Listing card ─────────────────────────────────────────────────────────────

interface ListingCardProps {
	listing: Listing
	onNavigate?: (url: string) => void
}

function ListingCard({ listing, onNavigate }: ListingCardProps) {
	const [imgError, setImgError] = useState(false)
	const contentUrl = `${STACK_URL}/content/${listing.outpoint}`
	const shortSeller =
		listing.seller.length > 10
			? `${listing.seller.slice(0, 6)}...${listing.seller.slice(-4)}`
			: listing.seller

	const handleClick = useCallback(() => {
		onNavigate?.(`1sat://ordinals/detail?outpoint=${listing.outpoint}`)
	}, [listing.outpoint, onNavigate])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault()
				onNavigate?.(`1sat://ordinals/detail?outpoint=${listing.outpoint}`)
			}
		},
		[listing.outpoint, onNavigate],
	)

	return (
		<button
			type="button"
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			className={cn(
				'group flex flex-col bg-card border border-border',
				'hover:border-primary transition-colors duration-150',
				'cursor-pointer text-left w-full',
			)}
			aria-label={`View listing: ${listing.name}`}
		>
			{/* Square image */}
			<div className="relative w-full aspect-square overflow-hidden bg-muted">
				{imgError ? (
					<div className="flex h-full w-full items-center justify-center">
						<ImageOff size={28} className="text-muted-foreground" />
					</div>
				) : (
					<img
						src={contentUrl}
						alt={listing.name}
						className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
						onError={() => setImgError(true)}
					/>
				)}
			</div>

			{/* Footer */}
			<div className="flex flex-col gap-0.5 px-2 py-2">
				<span
					className={cn(
						'truncate text-[11px] font-medium leading-tight text-foreground',
						'font-[family-name:var(--font-sans)]',
					)}
				>
					{listing.name}
				</span>
				<span
					className={cn(
						'text-[11px] font-bold leading-tight text-foreground',
						'font-[family-name:var(--font-mono)]',
					)}
				>
					{formatSats(listing.priceSats)} sats
				</span>
				<span
					className={cn(
						'truncate text-[9px] leading-tight text-muted-foreground',
						'font-[family-name:var(--font-mono)]',
					)}
				>
					{shortSeller}
				</span>
			</div>
		</button>
	)
}

// ─── Skeleton grid ────────────────────────────────────────────────────────────

function SkeletonGrid() {
	return (
		<div className="grid grid-cols-4 gap-3">
			{(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'] as const).map(
				(key) => (
					<div key={key} className="flex flex-col bg-card border border-border">
						<Skeleton className="aspect-square w-full rounded-none" />
						<div className="flex flex-col gap-1 px-2 py-2">
							<Skeleton className="h-3 w-3/4 rounded-none" />
							<Skeleton className="h-2.5 w-1/2 rounded-none" />
							<Skeleton className="h-2 w-2/3 rounded-none" />
						</div>
					</div>
				),
			)}
		</div>
	)
}

// ─── MarketView ───────────────────────────────────────────────────────────────

export interface MarketViewProps {
	onNavigate?: (url: string) => void
	params?: Record<string, string>
}

export function MarketView({ onNavigate }: MarketViewProps) {
	const [query, setQuery] = useState('')
	const [sortMode, setSortMode] = useState<SortMode>('recent')
	const [listings, setListings] = useState<Listing[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [refreshKey, setRefreshKey] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an intentional trigger
	useEffect(() => {
		let cancelled = false
		setLoading(true)
		setError(null)

		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), 8_000)

		fetch(`${STACK_URL}/1sat/ordlock/listings`, { signal: controller.signal })
			.then(async (res) => {
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}: ${res.statusText}`)
				}
				return res.json()
			})
			.then((data) => {
				if (cancelled) return
				setListings(parseListings(data))
			})
			.catch((err: unknown) => {
				if (cancelled) return
				const isAbort = err instanceof DOMException && err.name === 'AbortError'
				const isNetwork = err instanceof TypeError
				if (isAbort || isNetwork) {
					setError(
						'Local stack is not running. Start it to view marketplace listings.',
					)
				} else {
					setError(err instanceof Error ? err.message : String(err))
				}
				setListings([])
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
				clearTimeout(timeoutId)
			})

		return () => {
			cancelled = true
			controller.abort()
		}
	}, [refreshKey])

	const handleRefresh = useCallback(() => {
		setRefreshKey((k) => k + 1)
	}, [])

	const filtered = useMemo(() => {
		const base = query
			? listings.filter((l) =>
					l.name.toLowerCase().includes(query.toLowerCase()),
				)
			: listings
		return sortListings(base, sortMode)
	}, [query, sortMode, listings])

	const handleSortChange = useCallback((value: string) => {
		setSortMode(value as SortMode)
	}, [])

	return (
		<div className="flex flex-col w-full px-6 py-4 gap-4">
			{/* Header row */}
			<div className="flex items-center gap-4">
				<h1
					className={cn(
						'text-[20px] font-bold leading-none text-foreground shrink-0',
						'font-[family-name:var(--font-sans)]',
					)}
				>
					Marketplace
				</h1>

				{/* Search */}
				<div
					className={cn(
						'flex items-center gap-2 flex-1 bg-card border border-border px-3 h-8 max-w-xs',
					)}
				>
					<Search
						size={13}
						className="text-muted-foreground shrink-0"
						strokeWidth={1.75}
					/>
					<input
						ref={inputRef}
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search listings..."
						className={cn(
							'flex-1 bg-transparent text-foreground placeholder:text-muted-foreground',
							'outline-none border-none text-[12px]',
							'font-[family-name:var(--font-sans)]',
						)}
					/>
				</div>

				{/* Sort dropdown */}
				<Select value={sortMode} onValueChange={handleSortChange}>
					<SelectTrigger size="sm" className="w-36 text-xs shrink-0">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="recent">Recent</SelectItem>
						<SelectItem value="price-asc">Price: Low to High</SelectItem>
						<SelectItem value="price-desc">Price: High to Low</SelectItem>
					</SelectContent>
				</Select>

				{/* Refresh */}
				<button
					type="button"
					onClick={handleRefresh}
					disabled={loading}
					className={cn(
						'flex items-center justify-center h-8 w-8 border border-border bg-card',
						'text-muted-foreground hover:text-foreground hover:border-primary',
						'transition-colors duration-150 shrink-0',
						'disabled:opacity-40 disabled:cursor-not-allowed',
					)}
					aria-label="Refresh listings"
				>
					<RefreshCw
						size={13}
						strokeWidth={1.75}
						className={loading ? 'animate-spin' : ''}
					/>
				</button>
			</div>

			{/* Error state */}
			{error && !loading && (
				<div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
					<Store size={28} strokeWidth={1.5} />
					<span
						className={cn('text-sm', 'font-[family-name:var(--font-sans)]')}
					>
						Failed to load listings
					</span>
					<span
						className={cn(
							'text-[11px] text-destructive',
							'font-[family-name:var(--font-mono)]',
						)}
					>
						{error}
					</span>
				</div>
			)}

			{/* Loading skeleton */}
			{loading && <SkeletonGrid />}

			{/* Empty state */}
			{!loading && !error && filtered.length === 0 && (
				<Empty
					icon={Store}
					title={
						query ? `No listings match "${query}"` : 'No listings available'
					}
					description="Marketplace listings appear once items are listed for sale."
				/>
			)}

			{/* Listing grid */}
			{!loading && !error && filtered.length > 0 && (
				<div className="grid grid-cols-4 gap-3">
					{filtered.map((listing) => (
						<ListingCard
							key={listing.id}
							listing={listing}
							onNavigate={onNavigate}
						/>
					))}
				</div>
			)}
		</div>
	)
}
