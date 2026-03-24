import {
	ExternalLink,
	Globe,
	LayoutGrid,
	Loader2,
	RefreshCw,
	Search,
} from 'lucide-react'
import { AppCatalog } from 'metanet-apps'
import type { PublishedApp } from 'metanet-apps'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

const CATEGORIES = [
	'All',
	'DeFi',
	'Social',
	'Games',
	'Tools',
	'Utility',
	'NFT',
] as const

type Category = (typeof CATEGORIES)[number]

// ─── App Card ─────────────────────────────────────────────────────────────────

interface AppCardProps {
	app: PublishedApp
	onNavigate?: (url: string) => void
}

function AppCard({ app, onNavigate }: AppCardProps) {
	const { metadata } = app
	const url = metadata.httpURL ?? `https://${metadata.domain}`
	const [imgError, setImgError] = useState(false)

	const handleClick = useCallback(() => {
		onNavigate?.(url)
	}, [url, onNavigate])

	return (
		<button
			type="button"
			className="group flex flex-col items-center gap-2 bg-card border border-border hover:border-primary transition-colors duration-150 cursor-pointer rounded-lg p-4 text-center w-full"
			onClick={handleClick}
			aria-label={`Open ${metadata.name}`}
		>
			{/* Icon */}
			<div
				className="flex items-center justify-center shrink-0 rounded-lg overflow-hidden bg-muted"
				style={{ width: 40, height: 40 }}
			>
				{metadata.icon && !imgError ? (
					<img
						src={metadata.icon}
						alt=""
						className="w-full h-full object-cover"
						onError={() => setImgError(true)}
					/>
				) : (
					<Globe size={18} className="text-muted-foreground" />
				)}
			</div>

			{/* Name */}
			<span className="text-[12px] font-semibold leading-tight text-foreground truncate w-full">
				{metadata.name}
			</span>

			{/* Description */}
			<p className="text-[10px] text-muted-foreground leading-snug line-clamp-2 w-full">
				{metadata.description}
			</p>

			{/* Category badge */}
			{metadata.category && (
				<span className="text-[9px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
					{metadata.category}
				</span>
			)}

			{/* External link indicator */}
			<ExternalLink
				size={10}
				className="text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
				strokeWidth={1.75}
				aria-hidden
			/>
		</button>
	)
}

// ─── Category pill ────────────────────────────────────────────────────────────

interface CategoryPillProps {
	label: Category
	active: boolean
	onClick: (category: Category) => void
}

function CategoryPill({ label, active, onClick }: CategoryPillProps) {
	const handleClick = useCallback(() => onClick(label), [label, onClick])

	return (
		<button
			type="button"
			onClick={handleClick}
			aria-pressed={active}
			className={[
				'px-3 h-6 flex items-center rounded-full text-[11px] font-medium cursor-pointer border transition-colors duration-100 select-none shrink-0',
				active
					? 'bg-primary text-primary-foreground border-primary'
					: 'bg-card text-muted-foreground border-border hover:border-border/80 hover:text-foreground',
			].join(' ')}
		>
			{label}
		</button>
	)
}

// ─── AppsView ─────────────────────────────────────────────────────────────────

export interface AppsViewProps {
	onNavigate?: (url: string) => void
	params?: Record<string, string>
}

export function AppsView({ onNavigate }: AppsViewProps) {
	const [query, setQuery] = useState('')
	const [activeCategory, setActiveCategory] = useState<Category>('All')
	const [apps, setApps] = useState<PublishedApp[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	const fetchApps = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const catalog = new AppCatalog({})
			const results = await catalog.findApps()
			setApps(results)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load apps')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchApps()
	}, [fetchApps])

	// Build dynamic category list from actual data
	const availableCategories = useMemo(() => {
		const cats = new Set<string>()
		for (const app of apps) {
			if (app.metadata.category) cats.add(app.metadata.category)
		}
		return ['All', ...Array.from(cats).sort()] as Category[]
	}, [apps])

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return apps.filter((app) => {
			const { metadata } = app
			const matchesCategory =
				activeCategory === 'All' || metadata.category === activeCategory
			if (!matchesCategory) return false
			if (!q) return true
			return (
				metadata.name.toLowerCase().includes(q) ||
				metadata.description.toLowerCase().includes(q) ||
				metadata.domain.toLowerCase().includes(q) ||
				(metadata.tags ?? []).some((t) => t.toLowerCase().includes(q))
			)
		})
	}, [query, activeCategory, apps])

	return (
		<div className="flex flex-col w-full px-6 py-4 gap-4">
			{/* Header */}
			<div className="flex items-center gap-3">
				<LayoutGrid
					size={16}
					className="text-muted-foreground shrink-0"
					strokeWidth={1.75}
				/>
				<h1 className="text-[14px] font-bold leading-none text-foreground">
					App Catalog
				</h1>
				<span className="text-[11px] text-muted-foreground">
					{apps.length > 0 && `${apps.length} apps`}
				</span>
				<div className="flex-1" />
				<button
					type="button"
					onClick={fetchApps}
					disabled={loading}
					className="p-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
					aria-label="Refresh apps"
				>
					<RefreshCw
						size={14}
						className={loading ? 'animate-spin' : ''}
						strokeWidth={1.75}
					/>
				</button>
			</div>

			{/* Search bar */}
			<div className="flex justify-center">
				<div className="flex items-center gap-2 bg-card border border-border px-3 h-8 w-full max-w-md rounded">
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
						placeholder="Search apps..."
						className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none border-none text-[12px]"
					/>
				</div>
			</div>

			{/* Category pills — built from actual data */}
			<div className="flex flex-row items-center gap-2 flex-wrap">
				{availableCategories.map((cat) => (
					<CategoryPill
						key={cat}
						label={cat}
						active={activeCategory === cat}
						onClick={setActiveCategory}
					/>
				))}
			</div>

			{/* Loading */}
			{loading && (
				<div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
					<Loader2 size={24} className="animate-spin" strokeWidth={1.75} />
					<span className="text-sm">Loading apps from blockchain...</span>
				</div>
			)}

			{/* Error */}
			{!loading && error && (
				<div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
					<Globe size={32} strokeWidth={1.5} />
					<span className="text-sm text-destructive">{error}</span>
					<button
						type="button"
						onClick={fetchApps}
						className="text-xs text-primary hover:underline"
					>
						Try again
					</button>
				</div>
			)}

			{/* App grid */}
			{!loading && !error && filtered.length > 0 && (
				<div className="grid grid-cols-4 gap-3">
					{filtered.map((app) => (
						<AppCard
							key={`${app.token.txid}_${app.token.outputIndex}`}
							app={app}
							onNavigate={onNavigate}
						/>
					))}
				</div>
			)}

			{/* Empty search */}
			{!loading && !error && filtered.length === 0 && apps.length > 0 && (
				<div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
					<Search size={32} strokeWidth={1.5} />
					<span className="text-sm">No apps match your search</span>
				</div>
			)}

			{/* Empty catalog */}
			{!loading && !error && apps.length === 0 && (
				<div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
					<Globe size={32} strokeWidth={1.5} />
					<span className="text-sm">No apps published yet</span>
				</div>
			)}
		</div>
	)
}
