import { useCallback, useEffect, useState } from 'react'
import { Gem, ImageOff } from 'lucide-react'
import type { OrdinalInfo } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortMode = 'recent' | 'name'

interface OrdinalCard {
	outpoint: string
	name: string | undefined
	contentType: string
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

function getTag(tags: string[], prefix: string): string | undefined {
	const tag = tags.find((t) => t.startsWith(prefix))
	return tag ? tag.slice(prefix.length) : undefined
}

function toOrdinalCard(o: OrdinalInfo): OrdinalCard {
	return {
		outpoint: o.outpoint,
		name: getTag(o.tags, 'name:'),
		contentType: getTag(o.tags, 'type:') ?? '',
	}
}

// ---------------------------------------------------------------------------
// Sort helper
// ---------------------------------------------------------------------------

function sortOrdinals(items: OrdinalCard[], mode: SortMode): OrdinalCard[] {
	if (mode === 'name') {
		return [...items].sort((a, b) => {
			const aName = a.name ?? a.outpoint
			const bName = b.name ?? b.outpoint
			return aName.localeCompare(bName)
		})
	}
	// 'recent' — preserve RPC order (most recent first)
	return items
}

// ---------------------------------------------------------------------------
// Ordinal card component
// ---------------------------------------------------------------------------

interface OrdinalCardProps {
	ordinal: OrdinalCard
	onClick: (outpoint: string) => void
}

function OrdinalCardItem({ ordinal, onClick }: OrdinalCardProps) {
	const [imgError, setImgError] = useState(false)
	const contentUrl = `http://127.0.0.1:8080/content/${ordinal.outpoint}`
	const displayName = ordinal.name ?? 'Unnamed'
	// Truncate outpoint for display: show first 8 chars
	const shortOutpoint = `${ordinal.outpoint.slice(0, 8)}...`

	return (
		<button
			type="button"
			className="group flex flex-col bg-card border border-border hover:border-primary transition-colors duration-150 cursor-pointer text-left w-full"
			onClick={() => onClick(ordinal.outpoint)}
		>
			{/* Square image area */}
			<div className="relative w-full aspect-square overflow-hidden bg-muted">
				{imgError ? (
					<div className="flex h-full w-full items-center justify-center">
						<ImageOff size={32} className="text-muted-foreground" />
					</div>
				) : (
					<img
						src={contentUrl}
						alt={displayName}
						className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
						onError={() => setImgError(true)}
					/>
				)}
			</div>

			{/* Card footer */}
			<div className="flex flex-col gap-0.5 px-2 py-2">
				<span
					className="truncate text-[11px] font-medium leading-tight text-foreground"
					style={{ fontFamily: 'var(--font-sans)' }}
				>
					{displayName}
				</span>
				<span
					className="truncate text-[9px] leading-tight text-muted-foreground"
					style={{ fontFamily: 'var(--font-mono)' }}
				>
					{shortOutpoint}
				</span>
			</div>
		</button>
	)
}

// ---------------------------------------------------------------------------
// Skeleton grid
// ---------------------------------------------------------------------------

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
						<Skeleton className="h-2 w-1/2 rounded-none" />
					</div>
				</div>
			))}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

interface OrdinalsViewProps {
	params?: Record<string, string>
	onNavigate?: (url: string) => void
}

export function OrdinalsView({ onNavigate }: OrdinalsViewProps = {}) {
	const [allOrdinals, setAllOrdinals] = useState<OrdinalCard[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)
	const [sortMode, setSortMode] = useState<SortMode>('recent')

	useEffect(() => {
		rpc.request
			.getOrdinals({ limit: 50 })
			.then((result) => {
				setAllOrdinals(result.ordinals.map(toOrdinalCard))
			})
			.catch((err) => {
				setError(
					err instanceof Error
						? err
						: new Error('Failed to load ordinals'),
				)
			})
			.finally(() => {
				setLoading(false)
			})
	}, [])

	const handleClick = useCallback((outpoint: string) => {
		onNavigate?.(`1sat://ordinals/detail?outpoint=${outpoint}`)
	}, [onNavigate])

	const sorted = sortOrdinals(allOrdinals, sortMode)

	return (
		<div className="flex flex-col w-full px-6 py-4">
			{/* Header row */}
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-3">
					<h1 className="text-[20px] font-bold leading-none text-foreground">
						Ordinals
					</h1>
					{!loading && (
						<Badge variant="secondary" className="text-xs">
							{allOrdinals.length}
						</Badge>
					)}
				</div>

				<Select
					value={sortMode}
					onValueChange={(v) => setSortMode(v as SortMode)}
				>
					<SelectTrigger size="sm" className="w-32 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="recent">Recent</SelectItem>
						<SelectItem value="name">Name</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Error state */}
			{error && (
				<div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
					{error.message}
				</div>
			)}

			{/* Loading state */}
			{loading && <SkeletonGrid />}

			{/* Empty state */}
			{!loading && !error && allOrdinals.length === 0 && (
				<div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
					<Gem size={36} strokeWidth={1.5} />
					<span className="text-sm">No ordinals yet</span>
				</div>
			)}

			{/* Grid */}
			{!loading && sorted.length > 0 && (
				<div className="grid grid-cols-4 gap-3">
					{sorted.map((ordinal) => (
						<OrdinalCardItem
							key={ordinal.outpoint}
							ordinal={ordinal}
							onClick={handleClick}
						/>
					))}
				</div>
			)}
		</div>
	)
}
