import {
	Coins,
	Gem,
	LayoutGrid,
	MessageCircle,
	Pickaxe,
	ScanFace,
	Search,
	Store,
	Upload,
} from 'lucide-react'
import { useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HomeViewProps {
	onNavigate?: (url: string) => void
	onOpenLauncher?: (initialQuery?: string) => void
	params?: Record<string, string>
}

// ─── Static data (hoisted to module level — rerender-memo / rendering-hoist-jsx) ──

interface Shortcut {
	label: string
	icon: React.ElementType
	color: string
	url: string
}

const SHORTCUTS: Shortcut[] = [
	{
		label: 'Ordinals',
		icon: Gem,
		color: '#3b82f6',
		url: '1sat://ordinals/gallery',
	},
	{
		label: 'BSV21',
		icon: Coins,
		color: '#eab308',
		url: '1sat://tokens/all',
	},
	{
		label: 'Market',
		icon: Store,
		color: '#8b5cf6',
		url: '1sat://market',
	},
	{
		label: 'BitChat',
		icon: MessageCircle,
		color: '#22c55e',
		url: '1sat://chat',
	},
	{
		label: 'Mine',
		icon: Pickaxe,
		color: '#f97316',
		url: '1sat://ordinals/inscribe',
	},
	{
		label: 'Identity',
		icon: ScanFace,
		color: '#ec4899',
		url: '1sat://identity/profile',
	},
	{
		label: 'Apps',
		icon: LayoutGrid,
		color: '#06b6d4',
		url: '1sat://apps',
	},
	{
		label: 'Publish',
		icon: Upload,
		color: '#f43f5e',
		url: '1sat://publish/new',
	},
]

// ─── Shortcut tile ────────────────────────────────────────────────────────────

interface ShortcutTileProps {
	shortcut: Shortcut
	onNavigate?: (url: string) => void
}

function ShortcutTile({ shortcut, onNavigate }: ShortcutTileProps) {
	const Icon = shortcut.icon

	const handleClick = useCallback(() => {
		onNavigate?.(shortcut.url)
	}, [shortcut.url, onNavigate])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault()
				onNavigate?.(shortcut.url)
			}
		},
		[shortcut.url, onNavigate],
	)

	return (
		<button
			type="button"
			className="flex flex-col items-center gap-2 cursor-pointer group bg-transparent border-none p-0"
			style={{ width: 72 }}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			aria-label={`Navigate to ${shortcut.label}`}
		>
			{/* Icon container */}
			<div
				className="flex items-center justify-center bg-card border border-border transition-colors group-hover:border-border/80 group-hover:bg-muted/60"
				style={{ width: 48, height: 48, borderRadius: 8 }}
			>
				<Icon size={20} color={shortcut.color} strokeWidth={1.75} />
			</div>

			{/* Label */}
			<span
				className="text-muted-foreground text-center leading-none select-none"
				style={{ fontSize: 10 }}
			>
				{shortcut.label}
			</span>
		</button>
	)
}

// ─── HomeView ─────────────────────────────────────────────────────────────────

export function HomeView({ onNavigate, onOpenLauncher }: HomeViewProps) {
	const handleShortcut = useCallback(
		(url: string) => {
			if (url === '1sat://apps' && onOpenLauncher) {
				onOpenLauncher()
			} else {
				onNavigate?.(url)
			}
		},
		[onNavigate, onOpenLauncher],
	)

	const handleSearchClick = useCallback(() => {
		onOpenLauncher?.()
	}, [onOpenLauncher])

	return (
		<div className="flex flex-col items-center justify-center h-full gap-8 bg-background">
			{/* Logo */}
			<div className="flex flex-col items-center gap-2">
				<div
					style={{
						width: 48,
						height: 48,
						borderRadius: '50%',
						background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
						flexShrink: 0,
					}}
				/>
				<span className="text-muted-foreground" style={{ fontSize: 14 }}>
					1Sat
				</span>
			</div>

			{/* Search bar — clicking opens the launcher overlay */}
			<button
				type="button"
				onClick={handleSearchClick}
				className="w-full cursor-text text-left"
				style={{ maxWidth: 560 }}
			>
				<div
					className="flex items-center gap-3 bg-card border border-border hover:border-border/80 transition-colors"
					style={{ padding: 14, borderRadius: 8 }}
				>
					<Search
						size={16}
						className="text-muted-foreground shrink-0"
						strokeWidth={1.75}
					/>
					<span
						className="text-muted-foreground"
						style={{
							fontFamily: 'var(--font-sans)',
							fontSize: 13,
						}}
					>
						Search apps, URLs, or ask AI...
					</span>
				</div>
			</button>

			{/* Shortcut grid */}
			<div className="flex flex-row items-start gap-4 flex-wrap justify-center">
				{SHORTCUTS.map((shortcut) => (
					<ShortcutTile
						key={shortcut.url}
						shortcut={shortcut}
						onNavigate={handleShortcut}
					/>
				))}
			</div>
		</div>
	)
}
