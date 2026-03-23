import { ImageOff, Search, Store } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'

// ─── Types ────────────────────────────────────────────────────────────────────

type SortMode = 'recent' | 'price-asc' | 'price-desc'

interface Listing {
	id: string
	outpoint: string
	name: string
	priceSats: number
	seller: string
}

// ─── Static sample data (hoisted to module level per rendering-hoist-jsx) ─────

const SAMPLE_LISTINGS: Listing[] = [
	{
		id: '1',
		outpoint: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2_0',
		name: 'Pixel Ape #001',
		priceSats: 250000,
		seller: '1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv',
	},
	{
		id: '2',
		outpoint: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3_0',
		name: 'Genesis Rune',
		priceSats: 1000000,
		seller: '1B3c4D5e6F7g8H9i0JkLmNoPqRsTuVwX',
	},
	{
		id: '3',
		outpoint: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4_1',
		name: 'Rare Pepe #42',
		priceSats: 75000,
		seller: '1C4d5E6f7G8h9I0jKlMnOpQrStUvWxYz',
	},
	{
		id: '4',
		outpoint: 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5_0',
		name: 'BSV Punk #7',
		priceSats: 500000,
		seller: '1D5e6F7g8H9i0JkLmNoPqRsTuVwXyZaB',
	},
	{
		id: '5',
		outpoint: 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6_0',
		name: 'Digital Gold Bar',
		priceSats: 2100000,
		seller: '1E6f7G8h9I0jKlMnOpQrStUvWxYzAbCd',
	},
	{
		id: '6',
		outpoint: 'f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1_2',
		name: 'Satoshi Cat',
		priceSats: 33000,
		seller: '1F7g8H9i0JkLmNoPqRsTuVwXyZaBcDeF',
	},
	{
		id: '7',
		outpoint: 'a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8_0',
		name: 'Moon Rock #3',
		priceSats: 180000,
		seller: '1G8h9I0jKlMnOpQrStUvWxYzAbCdEfGh',
	},
	{
		id: '8',
		outpoint: 'b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9_0',
		name: 'Ordinal Dragon',
		priceSats: 4200000,
		seller: '1H9i0JkLmNoPqRsTuVwXyZaBcDeFgHiJ',
	},
]

// ─── Sort helper ──────────────────────────────────────────────────────────────

function sortListings(items: Listing[], mode: SortMode): Listing[] {
	if (mode === 'price-asc') {
		return [...items].sort((a, b) => a.priceSats - b.priceSats)
	}
	if (mode === 'price-desc') {
		return [...items].sort((a, b) => b.priceSats - a.priceSats)
	}
	// 'recent' — preserve original order
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
}

function ListingCard({ listing }: ListingCardProps) {
	const [imgError, setImgError] = useState(false)
	const contentUrl = `http://127.0.0.1:8080/content/${listing.outpoint}`
	const shortSeller = `${listing.seller.slice(0, 6)}...${listing.seller.slice(-4)}`

	return (
		<div
			role="button"
			tabIndex={0}
			className="group flex flex-col bg-card border border-border hover:border-primary transition-colors duration-150 cursor-pointer text-left w-full"
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
					className="truncate text-[11px] font-medium leading-tight text-foreground"
					style={{ fontFamily: 'var(--font-sans)' }}
				>
					{listing.name}
				</span>
				<span
					className="text-[11px] font-bold leading-tight text-foreground"
					style={{ fontFamily: 'var(--font-mono)' }}
				>
					{formatSats(listing.priceSats)} sats
				</span>
				<span
					className="truncate text-[9px] leading-tight text-muted-foreground"
					style={{ fontFamily: 'var(--font-mono)' }}
				>
					{shortSeller}
				</span>
			</div>
		</div>
	)
}

// ─── Skeleton grid ────────────────────────────────────────────────────────────

function SkeletonGrid() {
	return (
		<div className="grid grid-cols-4 gap-3">
			{Array.from({ length: 8 }).map((_, i) => (
				<div
					key={`skeleton-${i}`}
					className="flex flex-col bg-card border border-border"
				>
					<Skeleton className="aspect-square w-full rounded-none" />
					<div className="flex flex-col gap-1 px-2 py-2">
						<Skeleton className="h-3 w-3/4 rounded-none" />
						<Skeleton className="h-2.5 w-1/2 rounded-none" />
						<Skeleton className="h-2 w-2/3 rounded-none" />
					</div>
				</div>
			))}
		</div>
	)
}

// ─── MarketView ───────────────────────────────────────────────────────────────

export interface MarketViewProps {
	onNavigate?: (url: string) => void
	params?: Record<string, string>
}

export function MarketView({ onNavigate: _onNavigate }: MarketViewProps) {
	const [query, setQuery] = useState('')
	const [sortMode, setSortMode] = useState<SortMode>('recent')
	const [loading] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	const filtered = useMemo(() => {
		const base = query
			? SAMPLE_LISTINGS.filter((l) =>
					l.name.toLowerCase().includes(query.toLowerCase()),
				)
			: SAMPLE_LISTINGS
		return sortListings(base, sortMode)
	}, [query, sortMode])

	const handleSortChange = useCallback((value: string) => {
		setSortMode(value as SortMode)
	}, [])

	return (
		<div className="flex flex-col w-full px-6 py-4 gap-4">
			{/* Header row */}
			<div className="flex items-center gap-4">
				<h1 className="text-[20px] font-bold leading-none text-foreground shrink-0">
					Marketplace
				</h1>

				{/* Search */}
				<div className="flex items-center gap-2 flex-1 bg-card border border-border px-3 h-8 max-w-xs">
					<Search size={13} className="text-muted-foreground shrink-0" strokeWidth={1.75} />
					<input
						ref={inputRef}
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search listings..."
						className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none border-none text-[12px]"
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
			</div>

			{/* Loading skeleton */}
			{loading && <SkeletonGrid />}

			{/* Empty state */}
			{!loading && filtered.length === 0 && (
				<div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
					<Store size={36} strokeWidth={1.5} />
					<span className="text-sm">
						{query ? `No listings match "${query}"` : 'No listings available'}
					</span>
				</div>
			)}

			{/* Listing grid */}
			{!loading && filtered.length > 0 && (
				<div className="grid grid-cols-4 gap-3">
					{filtered.map((listing) => (
						<ListingCard key={listing.id} listing={listing} />
					))}
				</div>
			)}
		</div>
	)
}
