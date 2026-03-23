import { ExternalLink, LayoutGrid, Search } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CatalogApp {
	id: string
	name: string
	domain: string
	description: string
	color: string
	category: string
}

type Category =
	| 'All'
	| 'On-Chain'
	| 'DeFi'
	| 'Social'
	| 'Games'
	| 'Tools'
	| 'Earn'
	| 'Wallet'

// ─── Static catalog (hoisted to module level — rendering-hoist-jsx) ───────────

const CATALOG_APPS: CatalogApp[] = [
	{
		id: 'relayx',
		name: 'RelayX',
		domain: 'relayx.com',
		description: 'DEX and token trading',
		color: '#3b82f6',
		category: 'DeFi',
	},
	{
		id: '1satordinals',
		name: '1Sat Ordinals',
		domain: '1satordinals.com',
		description: 'NFT marketplace',
		color: '#8b5cf6',
		category: 'On-Chain',
	},
	{
		id: 'bitchat-nitro',
		name: 'BitChat Nitro',
		domain: 'bitchatnitro.com',
		description: 'On-chain encrypted chat',
		color: '#22c55e',
		category: 'Social',
	},
	{
		id: 'tonicpow',
		name: 'TonicPow',
		domain: 'tonicpow.com',
		description: 'Earn BSV for engagement',
		color: '#f97316',
		category: 'Earn',
	},
	{
		id: 'handcash',
		name: 'HandCash',
		domain: 'handcash.io',
		description: 'BSV wallet and payments',
		color: '#eab308',
		category: 'Wallet',
	},
	{
		id: 'cryptofights',
		name: 'CryptoFights',
		domain: 'cryptofights.io',
		description: 'PvP blockchain game',
		color: '#ef4444',
		category: 'Games',
	},
	{
		id: 'canonic',
		name: 'Canonic',
		domain: 'canonic.xyz',
		description: 'On-chain publishing',
		color: '#06b6d4',
		category: 'On-Chain',
	},
	{
		id: 'whatsonchain',
		name: 'WhatsOnChain',
		domain: 'whatsonchain.com',
		description: 'BSV block explorer',
		color: '#9ca3af',
		category: 'Tools',
	},
]

const CATEGORIES: Category[] = [
	'All',
	'On-Chain',
	'DeFi',
	'Social',
	'Games',
	'Tools',
	'Earn',
	'Wallet',
]

// ─── App Card ─────────────────────────────────────────────────────────────────

interface AppCardProps {
	app: CatalogApp
	onNavigate?: (url: string) => void
}

function AppCard({ app, onNavigate }: AppCardProps) {
	const url = `https://${app.domain}`

	const handleClick = useCallback(() => {
		onNavigate?.(url)
	}, [url, onNavigate])

	return (
		<button
			type="button"
			className="group flex flex-col items-center gap-2 bg-card border border-border hover:border-primary transition-colors duration-150 cursor-pointer rounded-lg p-4 text-center w-full"
			onClick={handleClick}
			aria-label={`Open ${app.name}`}
		>
			{/* Letter icon */}
			<div
				className="flex items-center justify-center shrink-0 rounded-lg"
				style={{
					width: 40,
					height: 40,
					backgroundColor: `${app.color}22`,
					color: app.color,
				}}
			>
				<span className="text-[15px] font-bold leading-none select-none">
					{app.name.charAt(0)}
				</span>
			</div>

			{/* Name */}
			<span className="text-[12px] font-semibold leading-tight text-foreground truncate w-full">
				{app.name}
			</span>

			{/* Description */}
			<p className="text-[10px] text-muted-foreground leading-snug line-clamp-2 w-full">
				{app.description}
			</p>

			{/* External link indicator — visible on hover */}
			<ExternalLink
				size={10}
				className="text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
				strokeWidth={1.75}
				aria-hidden
			/>
		</button>
	)
}

// ─── Category pill ─────────────────────────────────────────────────────────────

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
	const inputRef = useRef<HTMLInputElement>(null)

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return CATALOG_APPS.filter((app) => {
			const matchesCategory =
				activeCategory === 'All' || app.category === activeCategory
			if (!matchesCategory) return false
			if (!q) return true
			return (
				app.name.toLowerCase().includes(q) ||
				app.description.toLowerCase().includes(q) ||
				app.category.toLowerCase().includes(q)
			)
		})
	}, [query, activeCategory])

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
			</div>

			{/* Search bar — centered, max-w-md */}
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

			{/* Category pills */}
			<div className="flex flex-row items-center gap-2 flex-wrap">
				{CATEGORIES.map((cat) => (
					<CategoryPill
						key={cat}
						label={cat}
						active={activeCategory === cat}
						onClick={setActiveCategory}
					/>
				))}
			</div>

			{/* App grid — 4 columns */}
			{filtered.length > 0 ? (
				<div className="grid grid-cols-4 gap-3">
					{filtered.map((app) => (
						<AppCard key={app.id} app={app} onNavigate={onNavigate} />
					))}
				</div>
			) : (
				<div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
					<Search size={32} strokeWidth={1.5} />
					<span className="text-sm">No apps match &ldquo;{query}&rdquo;</span>
				</div>
			)}
		</div>
	)
}
