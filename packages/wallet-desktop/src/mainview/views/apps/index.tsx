import {
	Gamepad2,
	Gem,
	Globe,
	MessageCircle,
	Search,
	Server,
	ShieldCheck,
	Store,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppEntry {
	id: string
	name: string
	description: string
	icon: React.ElementType
	color: string
	url: string
	verified?: boolean
}

// ─── Static data (hoisted to module level per rendering-hoist-jsx) ────────────

const ON_CHAIN_APPS: AppEntry[] = [
	{
		id: 'bitchat-nitro',
		name: 'BitChat Nitro',
		description: 'Encrypted on-chain messaging',
		icon: MessageCircle,
		color: '#22c55e',
		url: '1sat://bitchat',
		verified: true,
	},
	{
		id: '1sat-market',
		name: '1Sat Market',
		description: 'Ordinal marketplace',
		icon: Store,
		color: '#8b5cf6',
		url: '1sat://market',
		verified: true,
	},
	{
		id: 'bitbattle',
		name: 'BitBattle',
		description: 'On-chain PvP battles',
		icon: Gamepad2,
		color: '#f97316',
		url: '1sat://bitbattle',
	},
]

const WEB_APPS: AppEntry[] = [
	{
		id: 'whatsonchain',
		name: 'WhatsOnChain',
		description: 'BSV blockchain explorer',
		icon: Globe,
		color: '#3b82f6',
		url: 'https://whatsonchain.com',
	},
	{
		id: '1satordinals',
		name: '1SatOrdinals',
		description: 'Ordinals marketplace and tools',
		icon: Gem,
		color: '#3b82f6',
		url: 'https://1satordinals.com',
		verified: true,
	},
	{
		id: 'gorillapool',
		name: 'GorillaPool',
		description: 'Mining pool and services',
		icon: Server,
		color: '#22c55e',
		url: 'https://gorillapool.io',
	},
]

// ─── App Card ─────────────────────────────────────────────────────────────────

interface AppCardProps {
	app: AppEntry
	onNavigate?: (url: string) => void
}

function AppCard({ app, onNavigate }: AppCardProps) {
	const Icon = app.icon

	const handleClick = useCallback(() => {
		onNavigate?.(app.url)
	}, [app.url, onNavigate])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault()
				onNavigate?.(app.url)
			}
		},
		[app.url, onNavigate],
	)

	return (
		<div
			role="button"
			tabIndex={0}
			className="flex flex-col gap-3 bg-card border border-border hover:border-primary transition-colors duration-150 cursor-pointer p-4 text-left"
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			aria-label={`Open ${app.name}`}
		>
			{/* Icon + name row */}
			<div className="flex items-center gap-3">
				<div
					className="flex items-center justify-center shrink-0"
					style={{
						width: 48,
						height: 48,
						borderRadius: 8,
						backgroundColor: `${app.color}1a`,
					}}
				>
					<Icon size={22} strokeWidth={1.75} style={{ color: app.color }} />
				</div>

				<div className="flex flex-col gap-0.5 min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="text-[12px] font-bold leading-tight text-foreground truncate">
							{app.name}
						</span>
						{app.verified && (
							<ShieldCheck
								size={12}
								className="shrink-0 text-primary"
								strokeWidth={2}
								aria-label="Verified"
							/>
						)}
					</div>
				</div>
			</div>

			{/* Description */}
			<p
				className="text-[10px] text-muted-foreground leading-snug line-clamp-2"
				style={{ fontFamily: 'var(--font-sans)' }}
			>
				{app.description}
			</p>
		</div>
	)
}

// ─── Section ──────────────────────────────────────────────────────────────────

interface SectionProps {
	title: string
	apps: AppEntry[]
	onNavigate?: (url: string) => void
}

function AppSection({ title, apps, onNavigate }: SectionProps) {
	return (
		<section>
			<div className="flex items-center gap-3 mb-3">
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground leading-none">
					{title}
				</p>
				<div className="flex-1 h-px bg-border" />
			</div>
			<div className="grid grid-cols-3 gap-4">
				{apps.map((app) => (
					<AppCard key={app.id} app={app} onNavigate={onNavigate} />
				))}
			</div>
		</section>
	)
}

// ─── AppsView ─────────────────────────────────────────────────────────────────

export interface AppsViewProps {
	onNavigate?: (url: string) => void
	params?: Record<string, string>
}

export function AppsView({ onNavigate }: AppsViewProps) {
	const [query, setQuery] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)

	const filteredOnChain = query
		? ON_CHAIN_APPS.filter(
				(a) =>
					a.name.toLowerCase().includes(query.toLowerCase()) ||
					a.description.toLowerCase().includes(query.toLowerCase()),
			)
		: ON_CHAIN_APPS

	const filteredWeb = query
		? WEB_APPS.filter(
				(a) =>
					a.name.toLowerCase().includes(query.toLowerCase()) ||
					a.description.toLowerCase().includes(query.toLowerCase()),
			)
		: WEB_APPS

	return (
		<div className="flex flex-col w-full px-6 py-4 gap-6">
			{/* Header */}
			<div className="flex items-center gap-4">
				<h1 className="text-[20px] font-bold leading-none text-foreground shrink-0">
					Apps
				</h1>

				<div className="flex items-center gap-2 flex-1 bg-card border border-border px-3 h-8 max-w-xs">
					<Search size={13} className="text-muted-foreground shrink-0" strokeWidth={1.75} />
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

			{/* On-chain section */}
			{filteredOnChain.length > 0 && (
				<AppSection
					title="On-Chain"
					apps={filteredOnChain}
					onNavigate={onNavigate}
				/>
			)}

			{/* Web section */}
			{filteredWeb.length > 0 && (
				<AppSection
					title="Web"
					apps={filteredWeb}
					onNavigate={onNavigate}
				/>
			)}

			{/* Empty state when search yields nothing */}
			{filteredOnChain.length === 0 && filteredWeb.length === 0 && (
				<div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
					<Search size={32} strokeWidth={1.5} />
					<span className="text-sm">No apps match &ldquo;{query}&rdquo;</span>
				</div>
			)}
		</div>
	)
}
