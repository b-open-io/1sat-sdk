import { SyncTerminal } from '@/components/blocks/sync-terminal'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
	ArrowLeft,
	ArrowRight,
	ChevronDown,
	Coins,
	Gem,
	Globe,
	Home,
	Plus,
	RotateCw,
	Search,
	Server,
	Settings2,
	Wallet,
	X,
} from 'lucide-react'
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react'
import { useHotkeys } from '@tanstack/react-hotkeys'
import type { ParsedRoute } from '../../../shared/url-types'
import { getDisplayLabel } from '../../../shared/url-types'
import { ORDFS_BASE, parseUrl } from '../../lib/url-parser'
import { AiChatView } from '../../views/ai-chat/index'
import { AgentPopover } from '../browser/agent-popover'
import { AgentSidebar } from '../browser/agent-sidebar'
import { BookmarksPopover } from '../browser/bookmarks-popover'
import { BrowserContextMenu } from '../browser/browser-context-menu'
import { MenuPopover } from '../browser/menu-popover'
import { PermissionOverlay } from '../browser/permission-overlay'
import { WalletPopover } from '../browser/wallet-popover'
import {
	NAV_INITIAL_STATE,
	type NavState,
	applyNavAction,
} from '../../hooks/use-browser-navigation'
import { useBookmarks } from '../../hooks/use-bookmarks'
import { useSyncEvents } from '../../hooks/use-sync-events'
import { renderPage } from '../../lib/page-registry'
import {
	type BrowserSettings,
	loadBrowserSettings,
	saveBrowserSettings,
} from '../../../shared/constants'
import {
	onNavigateToUrl,
	onStackOnboardingComplete,
	onStackOnboardingRequired,
	onToggleSyncLog,
	rpc,
} from '../../rpc'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Left padding to clear macOS traffic light buttons */
const TRAFFIC_LIGHT_PAD = 60

/** Height of the tab bar row */
const TAB_BAR_HEIGHT = 30

/** Height of the toolbar row */
const TOOLBAR_HEIGHT = 36

/** Home page URL for new tabs */
const NEW_TAB_URL = '1sat://browser/new'

// ---------------------------------------------------------------------------
// Tab state
// ---------------------------------------------------------------------------

interface TabState {
	id: string
	/** Each tab owns its own navigation history */
	nav: NavState
	/** Incremented to force re-mount of the current page (reload) */
	reloadKey: number
	/** Page title reported by the webview (overrides getDisplayLabel) */
	customTitle?: string
	/** Favicon URL for web tabs (fetched from origin/favicon.ico) */
	faviconUrl?: string
}

// ---------------------------------------------------------------------------
// Tab icon helpers
// ---------------------------------------------------------------------------

function getFaviconUrl(url: string): string {
	try {
		const u = new URL(url)
		return `${u.origin}/favicon.ico`
	} catch {
		return ''
	}
}

function getTabIcon(route: ParsedRoute, faviconUrl?: string): React.ReactNode {
	if (faviconUrl) {
		return (
			<img
				src={faviconUrl}
				alt=""
				className="size-3 shrink-0"
				onError={(e) => {
					;(e.target as HTMLImageElement).style.display = 'none'
				}}
			/>
		)
	}
	if (route.type !== 'internal') {
		return <Globe size={12} className="shrink-0 opacity-60" />
	}
	const { page } = route
	if (page.startsWith('wallet/')) return <Wallet size={12} className="shrink-0 opacity-60" />
	if (page.startsWith('ordinals/')) return <Gem size={12} className="shrink-0 opacity-60" />
	if (page.startsWith('tokens/') || page === 'market') return <Coins size={12} className="shrink-0 opacity-60" />
	if (page.startsWith('settings')) return <Settings2 size={12} className="shrink-0 opacity-60" />
	if (page === 'browser/new') return <Home size={12} className="shrink-0 opacity-60" />
	return <Globe size={12} className="shrink-0 opacity-60" />
}

function makeTabId(): string {
	return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function makeNewTab(): TabState {
	const nav = applyNavAction(NAV_INITIAL_STATE, {
		type: 'navigate',
		input: NEW_TAB_URL,
	})
	return { id: makeTabId(), nav, reloadKey: 0 }
}

// ---------------------------------------------------------------------------
// Tab bar sub-components
// ---------------------------------------------------------------------------

interface TabProps {
	label: string
	active: boolean
	favicon?: React.ReactNode
	onClick: () => void
	onClose: () => void
}

function Tab({ label, active, favicon, onClick, onClose }: TabProps) {
	return (
		<div
			role="tab"
			aria-selected={active}
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') onClick()
			}}
			onClick={onClick}
			className={cn(
				'group relative flex items-center gap-1.5 px-3 h-full min-w-[120px] max-w-[200px] select-none cursor-default',
				active
					? 'bg-background text-foreground'
					: 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30',
			)}
		>
			{favicon ?? <Globe size={12} className="shrink-0 opacity-60" />}
			<span className="truncate text-[11px] font-medium">{label}</span>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation()
					onClose()
				}}
				className="ml-auto shrink-0 rounded-[3px] p-0.5 opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:bg-muted/50 transition-opacity"
				aria-label={`Close ${label}`}
			>
				<X size={10} />
			</button>
		</div>
	)
}

interface NewTabButtonProps {
	onClick: () => void
}

function NewTabButton({ onClick }: NewTabButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center justify-center h-full px-2 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
			aria-label="New tab"
		>
			<Plus size={12} />
		</button>
	)
}

interface TabBarProps {
	tabs: TabState[]
	activeTabId: string
	onTabClick: (id: string) => void
	onTabClose: (id: string) => void
	onNewTab: () => void
}

function TabBar({
	tabs,
	activeTabId,
	onTabClick,
	onTabClose,
	onNewTab,
}: TabBarProps) {
	return (
		<div
			className="electrobun-webkit-app-region-drag flex items-end shrink-0"
			style={{
				height: TAB_BAR_HEIGHT,
				paddingLeft: TRAFFIC_LIGHT_PAD,
				backgroundColor: 'var(--tab-bar-bg)',
			}}
		>
			<div
				role="tablist"
				className="flex items-stretch h-full electrobun-webkit-app-region-no-drag"
			>
				{tabs.map((tab) => (
					<Tab
						key={tab.id}
						label={tab.customTitle ?? getDisplayLabel(tab.nav.current)}
						active={tab.id === activeTabId}
						favicon={getTabIcon(tab.nav.current, tab.faviconUrl)}
						onClick={() => onTabClick(tab.id)}
						onClose={() => onTabClose(tab.id)}
					/>
				))}
				<NewTabButton onClick={onNewTab} />
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Vertical tab sidebar
// ---------------------------------------------------------------------------

const VERTICAL_SIDEBAR_WIDTH = 220

interface VerticalTabSidebarProps {
	tabs: TabState[]
	activeTabId: string
	onTabClick: (id: string) => void
	onTabClose: (id: string) => void
	onNewTab: () => void
}

function VerticalTabSidebar({
	tabs,
	activeTabId,
	onTabClick,
	onTabClose,
	onNewTab,
}: VerticalTabSidebarProps) {
	return (
		<div
			className="electrobun-webkit-app-region-drag flex flex-col shrink-0 border-r border-border bg-card"
			style={{ width: VERTICAL_SIDEBAR_WIDTH }}
		>
			{/* Traffic light spacer + header row */}
			<div
				className="flex items-center justify-between shrink-0 px-2"
				style={{ height: TAB_BAR_HEIGHT + TOOLBAR_HEIGHT, paddingTop: TAB_BAR_HEIGHT }}
			>
				<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground select-none electrobun-webkit-app-region-no-drag">
					Tabs
				</span>
				<button
					type="button"
					onClick={onNewTab}
					className="flex items-center justify-center p-1 text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors electrobun-webkit-app-region-no-drag"
					aria-label="New tab"
				>
					<Plus size={12} />
				</button>
			</div>

			{/* Tab list */}
			<div
				role="tablist"
				aria-orientation="vertical"
				className="flex flex-col flex-1 overflow-y-auto electrobun-webkit-app-region-no-drag"
			>
				{tabs.map((tab) => {
					const active = tab.id === activeTabId
					const label = tab.customTitle ?? getDisplayLabel(tab.nav.current)
					return (
						<div
							key={tab.id}
							role="tab"
							aria-selected={active}
							tabIndex={0}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') onTabClick(tab.id)
							}}
							onClick={() => onTabClick(tab.id)}
							className={cn(
								'group flex items-center gap-2 px-3 py-1.5 select-none cursor-default transition-colors',
								active
									? 'bg-muted/50 text-foreground'
									: 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
							)}
						>
							{getTabIcon(tab.nav.current, tab.faviconUrl)}
							<span className="truncate text-[11px] font-medium flex-1 min-w-0">{label}</span>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation()
									onTabClose(tab.id)
								}}
								className="shrink-0 rounded-[3px] p-0.5 opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:bg-muted/50 transition-opacity"
								aria-label={`Close ${label}`}
							>
								<X size={10} />
							</button>
						</div>
					)
				})}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Toolbar sub-components
// ---------------------------------------------------------------------------

interface NavButtonProps {
	icon: React.ReactNode
	label: string
	disabled?: boolean
	onClick?: () => void
}

function NavButton({ icon, label, disabled = false, onClick }: NavButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon-xs"
					disabled={disabled}
					onClick={onClick}
					className="text-muted-foreground disabled:opacity-30"
					style={{ borderRadius: 5 }}
					aria-label={label}
				>
					{icon}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="text-xs">
				{label}
			</TooltipContent>
		</Tooltip>
	)
}

const PROTOCOLS = [
	{ value: '1sat://', label: '1sat://', bg: 'var(--protocol-1sat-bg)', fg: 'var(--protocol-1sat-fg)' },
	{ value: 'https://', label: 'https://', bg: 'var(--protocol-https-bg)', fg: 'var(--protocol-https-fg)' },
	{ value: 'http://', label: 'http://', bg: 'var(--protocol-http-bg)', fg: 'var(--protocol-http-fg)' },
	{ value: 'ai://', label: 'ai://', bg: 'var(--protocol-ai-bg)', fg: 'var(--protocol-ai-fg)' },
] as const

function getProtocolFromRoute(route: ParsedRoute): string {
	switch (route.type) {
		case 'internal':
		case 'onchain-outpoint':
		case 'onchain-opns':
			return '1sat://'
		case 'web':
			return route.url.startsWith('http://') ? 'http://' : 'https://'
		case 'search':
			return 'https://'
		case 'ai-chat':
			return 'ai://'
		default:
			return '1sat://'
	}
}

interface ProtocolBadgeProps {
	route: ParsedRoute
	onProtocolChange: (protocol: string) => void
}

function ProtocolBadge({ route, onProtocolChange }: ProtocolBadgeProps) {
	const [open, setOpen] = useState(false)
	const current = getProtocolFromRoute(route)
	const style = PROTOCOLS.find((p) => p.value === current) ?? PROTOCOLS[0]

	return (
		<div className="relative shrink-0">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="inline-flex items-center gap-0.5 px-1.5 text-[10px] font-mono font-semibold cursor-pointer hover:opacity-80 transition-opacity"
				style={{
					borderRadius: 4,
					backgroundColor: style.bg,
					color: style.fg,
					lineHeight: '16px',
				}}
			>
				{style.label}
				<ChevronDown size={8} style={{ color: style.fg }} />
			</button>
			{open && (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
					<div
						className="absolute top-full left-0 mt-1 z-50 border border-border bg-card shadow-lg"
						style={{ borderRadius: 4, minWidth: 100 }}
					>
						{PROTOCOLS.map((p) => (
							<button
								key={p.value}
								type="button"
								onClick={() => {
									onProtocolChange(p.value)
									setOpen(false)
								}}
								className={cn(
									'flex items-center w-full px-2 py-1.5 text-[10px] font-mono font-semibold hover:bg-muted/50 transition-colors',
									p.value === current ? 'text-foreground' : 'text-muted-foreground',
								)}
							>
								<span
									className="inline-block w-2 h-2 mr-2 shrink-0"
									style={{ backgroundColor: p.bg }}
								/>
								{p.label}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	)
}

interface AddressBarProps {
	route: ParsedRoute
	onNavigate: (input: string) => void
	inputRef: React.RefObject<HTMLInputElement | null>
}

function AddressBar({ route, onNavigate, inputRef }: AddressBarProps) {
	const displayLabel = getDisplayLabel(route)
	const fullUrl =
		route.type === 'internal'
			? `1sat://${route.page}`
			: route.type === 'web'
				? route.url
				: route.type === 'onchain-outpoint'
					? `1sat://${route.partition}/${route.txid}_${route.vout}${route.path ?? ''}`
					: route.type === 'onchain-opns'
						? `1sat://${route.partition}/${route.name}${route.path ?? ''}`
						: route.type === 'search'
							? route.url
							: ''

	const [editing, setEditing] = useState(false)
	const [inputValue, setInputValue] = useState(fullUrl)

	// Keep input value in sync when route changes while not editing
	useEffect(() => {
		if (!editing) setInputValue(fullUrl)
	}, [fullUrl, editing])

	const handleFocus = useCallback(() => {
		setEditing(true)
		setInputValue(fullUrl)
		// Select all text for easy replacement
		setTimeout(() => inputRef.current?.select(), 0)
	}, [fullUrl, inputRef])

	const handleBlur = useCallback(() => {
		setEditing(false)
		setInputValue(fullUrl)
	}, [fullUrl])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Enter') {
				onNavigate(inputValue)
				inputRef.current?.blur()
			} else if (e.key === 'Escape') {
				setEditing(false)
				setInputValue(fullUrl)
				inputRef.current?.blur()
			}
		},
		[inputValue, fullUrl, onNavigate, inputRef],
	)

	return (
		<div
			className="flex items-center gap-1.5 flex-1 min-w-0 px-2 border border-border bg-muted/40"
			style={{ height: 26, borderRadius: 6 }}
		>
			<ProtocolBadge
				route={route}
				onProtocolChange={(proto) => {
					if (proto === 'ai://') {
						// Switch to AI chat with current address bar content as query
						const stripped = fullUrl.replace(/^(1sat|https?|ordfs|ai):\/\//, '')
						onNavigate(`ai://${stripped}`)
						return
					}
					// Switch protocol: strip current scheme and prepend new one
					const stripped = fullUrl.replace(/^(1sat|https?|ordfs|ai):\/\//, '')
					onNavigate(`${proto}${stripped}`)
				}}
			/>
			{editing ? (
				<input
					ref={inputRef}
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					onFocus={handleFocus}
					onBlur={handleBlur}
					onKeyDown={handleKeyDown}
					className="flex-1 min-w-0 bg-transparent text-xs font-mono text-foreground outline-none"
					spellCheck={false}
					autoCapitalize="off"
					autoCorrect="off"
				/>
			) : (
				<button
					type="button"
					onClick={handleFocus}
					className="flex-1 min-w-0 text-left truncate text-xs font-mono text-muted-foreground bg-transparent"
				>
					{displayLabel}
				</button>
			)}
		</div>
	)
}

function IdentityChip() {
	return (
		<button
			type="button"
			className="flex items-center gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
			style={{ borderRadius: 5 }}
		>
			<span className="font-mono text-[10px]">anonymous</span>
			<ChevronDown size={10} />
		</button>
	)
}

interface ToolbarProps {
	route: ParsedRoute
	canGoBack: boolean
	canGoForward: boolean
	onBack: () => void
	onForward: () => void
	onReload: () => void
	onNavigate: (input: string) => void
	addressBarRef: React.RefObject<HTMLInputElement | null>
	trafficLightPad?: boolean
	onOpenAgent: () => void
	onToggleTabMode: () => void
	bookmarksApi: ReturnType<typeof useBookmarks>
	currentUrl: string
	currentTitle: string
	onPopoverOpen?: () => void
	onPopoverClose?: () => void
}

function Toolbar({
	route,
	canGoBack,
	canGoForward,
	onBack,
	onForward,
	onReload,
	onNavigate,
	addressBarRef,
	trafficLightPad = false,
	onOpenAgent,
	onToggleTabMode,
	bookmarksApi,
	currentUrl,
	currentTitle,
	onPopoverOpen,
	onPopoverClose,
}: ToolbarProps) {
	const [bookmarksOpen, setBookmarksOpen] = useState(false)

	// Notify parent when any popover opens/closes (for webview passthrough)
	const trackPopover = useCallback((open: boolean) => {
		if (open) onPopoverOpen?.()
		else onPopoverClose?.()
	}, [onPopoverOpen, onPopoverClose])

	return (
		<div
			className="flex items-center gap-1.5 px-2 shrink-0 bg-background"
			style={{ height: TOOLBAR_HEIGHT, paddingLeft: trafficLightPad ? TRAFFIC_LIGHT_PAD : undefined }}
		>
			<TooltipProvider delayDuration={300}>
		{/* Navigation buttons */}
			<div className="flex items-center gap-0.5">
				<NavButton
					icon={<ArrowLeft size={14} />}
					label="Back"
					disabled={!canGoBack}
					onClick={onBack}
				/>
				<NavButton
					icon={<ArrowRight size={14} />}
					label="Forward"
					disabled={!canGoForward}
					onClick={onForward}
				/>
				<NavButton
					icon={<RotateCw size={13} />}
					label="Reload"
					onClick={onReload}
				/>
			</div>

			</TooltipProvider>

		{/* Address bar */}
			<AddressBar
				route={route}
				onNavigate={onNavigate}
				inputRef={addressBarRef}
			/>

			{/* Identity + action buttons */}
			<IdentityChip />
			<div className="flex items-center gap-0.5">
				<WalletPopover onNavigate={onNavigate} onOpenChange={trackPopover} />
				<BookmarksPopover
					bookmarksApi={bookmarksApi}
					currentUrl={currentUrl}
					currentTitle={currentTitle}
					onNavigate={onNavigate}
					open={bookmarksOpen}
					onOpenChange={(v) => { setBookmarksOpen(v); trackPopover(v) }}
				/>
				<AgentPopover onOpenAgent={onOpenAgent} />
				<MenuPopover
					onNavigate={onNavigate}
					onOpenBookmarks={() => setBookmarksOpen(true)}
					onToggleTabMode={onToggleTabMode}
					onOpenChange={trackPopover}
				/>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// WebView content renderer for non-internal routes
// ---------------------------------------------------------------------------

function resolveWebViewUrl(route: ParsedRoute): string | null {
	switch (route.type) {
		case 'web':
			return route.url
		case 'search':
			return route.url
		case 'onchain-outpoint':
			return `${ORDFS_BASE}${route.txid}_${route.vout}${route.path ?? ''}`
		case 'onchain-opns':
			return `${ORDFS_BASE}${route.name}${route.path ?? ''}`
		default:
			return null
	}
}

interface WebViewContentProps {
	route: ParsedRoute
	onNavigated?: (url: string) => void
	onTitleChanged?: (title: string) => void
	webviewRef?: React.RefObject<HTMLElement | null>
}

function WebViewContent({ route, onNavigated, onTitleChanged, webviewRef }: WebViewContentProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const localRef = useRef<HTMLElement | null>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const url = resolveWebViewUrl(route)
		if (!url) return

		// Create electrobun-webview element
		const webview = document.createElement('electrobun-webview')
		webview.setAttribute('src', url)
		webview.style.position = 'absolute'
		webview.style.inset = '0'
		webview.style.width = '100%'
		webview.style.height = '100%'

		// Set partition for on-chain content (origin isolation)
		if (route.type === 'onchain-outpoint' || route.type === 'onchain-opns') {
			const partition = route.type === 'onchain-opns'
				? route.name
				: `${route.txid}_${route.vout}`
			webview.setAttribute('partition', `persist:1sat-${partition}`)
		}

		const handleNavigated = (e: Event) => {
			const url = (e as CustomEvent).detail?.url
			if (url) onNavigated?.(url)
		}

		const handleTitleChanged = (e: Event) => {
			const title = (e as CustomEvent).detail?.title
			if (title) onTitleChanged?.(title)
		}

		webview.addEventListener('did-navigate', handleNavigated)
		webview.addEventListener('page-title-updated', handleTitleChanged)

		container.appendChild(webview)
		localRef.current = webview
		if (webviewRef) webviewRef.current = webview

		return () => {
			webview.removeEventListener('did-navigate', handleNavigated)
			webview.removeEventListener('page-title-updated', handleTitleChanged)
			webview.remove()
			localRef.current = null
			if (webviewRef) webviewRef.current = null
		}
	}, [route, onNavigated, onTitleChanged, webviewRef])

	return (
		<div ref={containerRef} className="absolute inset-0" />
	)
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function getFullUrl(route: ParsedRoute): string {
	switch (route.type) {
		case 'internal':
			return `1sat://${route.page}`
		case 'web':
			return route.url
		case 'search':
			return route.url
		case 'onchain-outpoint':
			return `1sat://${route.partition}/${route.txid}_${route.vout}${route.path ?? ''}`
		case 'onchain-opns':
			return `1sat://${route.partition}/${route.name}${route.path ?? ''}`
		case 'ai-chat':
			return `ai://${route.query}`
		default:
			return ''
	}
}

// ---------------------------------------------------------------------------
// BrowserLayout
// ---------------------------------------------------------------------------

const INITIAL_TAB = makeNewTab()
// Override initial tab to start at wallet/overview (same as legacy behavior)
const FIRST_TAB: TabState = {
	...INITIAL_TAB,
	nav: NAV_INITIAL_STATE,
}

export function BrowserLayout() {
	const { events } = useSyncEvents()
	const [stackOnboardingUrl, setStackOnboardingUrl] = useState<string | null>(
		null,
	)

	// ── Browser settings (search mode) ────────────────────────────────────
	const [browserSettings, setBrowserSettings] = useState<BrowserSettings>(loadBrowserSettings)

	// Keep settings in sync when localStorage changes from the Settings tab
	useEffect(() => {
		const handler = () => {
			setBrowserSettings(loadBrowserSettings())
		}
		window.addEventListener('storage', handler)
		return () => window.removeEventListener('storage', handler)
	}, [])

	// ── Bookmarks ──────────────────────────────────────────────────────────
	const bookmarksApi = useBookmarks()

	// ── Agent sidebar ──────────────────────────────────────────────────────
	const [agentSidebarOpen, setAgentSidebarOpen] = useState(false)

	const toggleAgentSidebar = useCallback(() => {
		setAgentSidebarOpen((prev) => !prev)
	}, [])

	const closeAgentSidebar = useCallback(() => {
		setAgentSidebarOpen(false)
	}, [])

	// ── Sync log visibility ───────────────────────────────────────────────
	const [syncLogEnabled, setSyncLogEnabled] = useState(true)

	useEffect(() => {
		return onToggleSyncLog(() => {
			setSyncLogEnabled((prev) => !prev)
		})
	}, [])

	// ── Link hover tooltip (Chrome-style status bar) ──────────────────────
	const [hoveredLink, setHoveredLink] = useState<string | null>(null)

	useEffect(() => {
		function handleMouseOver(e: MouseEvent) {
			const target = (e.target as HTMLElement).closest('a[href]')
			if (target) {
				setHoveredLink((target as HTMLAnchorElement).href)
			}
		}
		function handleMouseOut(e: MouseEvent) {
			const target = (e.target as HTMLElement).closest('a[href]')
			if (target) {
				setHoveredLink(null)
			}
		}
		document.addEventListener('mouseover', handleMouseOver)
		document.addEventListener('mouseout', handleMouseOut)
		return () => {
			document.removeEventListener('mouseover', handleMouseOver)
			document.removeEventListener('mouseout', handleMouseOut)
		}
	}, [])

	// ── Tab mode ───────────────────────────────────────────────────────────
	const [tabMode, setTabMode] = useState<'horizontal' | 'vertical'>('horizontal')

	const toggleTabMode = useCallback(() => {
		setTabMode((prev) => (prev === 'horizontal' ? 'vertical' : 'horizontal'))
	}, [])

	// ── Tab state ──────────────────────────────────────────────────────────
	const [tabs, setTabs] = useState<TabState[]>([FIRST_TAB])
	const [activeTabId, setActiveTabId] = useState<string>(FIRST_TAB.id)

	// Derived: always defined because we never allow 0 tabs
	const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
	const activeNav = activeTab.nav

	// Address bar ref for programmatic focus
	const addressBarRef = useRef<HTMLInputElement | null>(null)

	// Ref to the active electrobun-webview element (set by WebViewContent)
	const activeWebviewRef = useRef<HTMLElement | null>(null)

	// Track open popovers — when any is open, passthrough the webview so popover clicks work
	const openPopoverCount = useRef(0)
	const setWebviewPassthrough = useCallback((passthrough: boolean) => {
		const wv = activeWebviewRef.current as HTMLElement & { togglePassthrough?: (v: boolean) => void } | null
		if (wv?.togglePassthrough) wv.togglePassthrough(passthrough)
	}, [])
	const onPopoverOpen = useCallback(() => {
		openPopoverCount.current++
		if (openPopoverCount.current === 1) setWebviewPassthrough(true)
	}, [setWebviewPassthrough])
	const onPopoverClose = useCallback(() => {
		openPopoverCount.current = Math.max(0, openPopoverCount.current - 1)
		if (openPopoverCount.current === 0) setWebviewPassthrough(false)
	}, [setWebviewPassthrough])

	// ── Find on page ───────────────────────────────────────────────────────
	const [findBarOpen, setFindBarOpen] = useState(false)
	const [findQuery, setFindQuery] = useState('')

	const closeFindBar = useCallback(() => {
		setFindBarOpen(false)
		setFindQuery('')
		const wv = activeWebviewRef.current
		if (wv) (wv as HTMLElement & { stopFindInPage?: () => void }).stopFindInPage?.()
	}, [])

	const openFindBar = useCallback(() => {
		setFindBarOpen(true)
	}, [])

	// Ref to track the current active tab ID without closing over stale state
	const activeTabIdRef = useRef(activeTabId)
	activeTabIdRef.current = activeTabId

	// ── Navigation helpers (operate on the active tab's nav state) ─────────

	const dispatchNav = useCallback(
		(action: Parameters<typeof applyNavAction>[1]) => {
			setTabs((prev) =>
				prev.map((tab) => {
					if (tab.id !== activeTabIdRef.current) return tab
					const nav = applyNavAction(tab.nav, action)
					// Proactively set favicon when navigating to a web URL
					const faviconUrl =
						nav.current.type === 'web' ? getFaviconUrl(nav.current.url) : undefined
					return { ...tab, nav, faviconUrl }
				}),
			)
		},
		[], // stable — reads current tab ID from ref
	)

	const navigate = useCallback(
		(input: string) => {
			// Pre-parse to check if this resolves to a bare search query,
			// then redirect based on the user's configured search mode.
			const preliminary = parseUrl(input)
			if (preliminary?.type === 'search') {
				const { query } = preliminary
				const { searchMode, customSearchUrl } = browserSettings
				if (searchMode === 'ai') {
					dispatchNav({ type: 'navigate', input: `ai://${query}` })
					return
				}
				if (searchMode === 'google') {
					dispatchNav({
						type: 'navigate',
						input: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
					})
					return
				}
				if (searchMode === 'custom' && customSearchUrl) {
					dispatchNav({
						type: 'navigate',
						input: customSearchUrl.replace('{query}', encodeURIComponent(query)),
					})
					return
				}
				// 'duckduckgo' or custom without URL: use the default DuckDuckGo URL
				dispatchNav({ type: 'navigate', input: preliminary.url })
				return
			}
			dispatchNav({ type: 'navigate', input })
		},
		[dispatchNav, browserSettings],
	)

	const goBack = useCallback(() => {
		const route = activeTab.nav.current
		if (route.type === 'web' || route.type === 'search' || route.type === 'onchain-outpoint' || route.type === 'onchain-opns') {
			const wv = activeWebviewRef.current
			if (wv) {
				;(wv as HTMLElement & { goBack?: () => void }).goBack?.()
				return
			}
		}
		dispatchNav({ type: 'back' })
	}, [dispatchNav, activeTab])

	const goForward = useCallback(() => {
		const route = activeTab.nav.current
		if (route.type === 'web' || route.type === 'search' || route.type === 'onchain-outpoint' || route.type === 'onchain-opns') {
			const wv = activeWebviewRef.current
			if (wv) {
				;(wv as HTMLElement & { goForward?: () => void }).goForward?.()
				return
			}
		}
		dispatchNav({ type: 'forward' })
	}, [dispatchNav, activeTab])

	const reload = useCallback(() => {
		setTabs((prev) =>
			prev.map((tab) =>
				tab.id === activeTabId
					? { ...tab, reloadKey: tab.reloadKey + 1 }
					: tab,
			),
		)
	}, [activeTabId])

	// Called when the webview itself navigates (link click, redirect, etc.).
	// We push the new URL into the active tab's nav history so Back works,
	// but we do NOT create a new webview — it already navigated internally.
	const handleWebViewNavigated = useCallback((url: string) => {
		const parsed = parseUrl(url)
		if (!parsed) return
		const tabId = activeTabIdRef.current
		setTabs((prev) =>
			prev.map((tab) => {
				if (tab.id !== tabId) return tab
				const back = [...tab.nav.back, tab.nav.current]
				const nav: NavState = {
					back,
					current: parsed,
					forward: [],
					canGoBack: true,
					canGoForward: false,
				}
				// Clear customTitle on URL change so stale titles don't persist
				// Set favicon for web routes, clear it for internal/onchain routes
				const faviconUrl = parsed.type === 'web' ? getFaviconUrl(parsed.url) : undefined
				return { ...tab, nav, customTitle: undefined, faviconUrl }
			}),
		)
	}, [])

	// Called when the webview's document title updates.
	const handleWebViewTitleChanged = useCallback((title: string) => {
		const tabId = activeTabIdRef.current
		setTabs((prev) =>
			prev.map((tab) =>
				tab.id === tabId ? { ...tab, customTitle: title } : tab,
			),
		)
	}, [])

	// ── Tab management ─────────────────────────────────────────────────────

	const createNewTab = useCallback(() => {
		const tab = makeNewTab()
		setTabs((prev) => [...prev, tab])
		setActiveTabId(tab.id)
	}, [])

	const switchToTab = useCallback(
		(index: number) => {
			setTabs((prev) => {
				const tab = prev[index]
				if (tab) setActiveTabId(tab.id)
				return prev
			})
		},
		[],
	)

	const handleTabClick = useCallback((id: string) => {
		setActiveTabId(id)
	}, [])

	const closeTab = useCallback(
		(id: string) => {
			setTabs((prev) => {
				if (prev.length === 1) {
					// Never allow 0 tabs: replace with a fresh new tab
					const replacement = makeNewTab()
					setActiveTabId(replacement.id)
					return [replacement]
				}

				const closedIndex = prev.findIndex((t) => t.id === id)
				const next = prev.filter((t) => t.id !== id)

				if (id === activeTabId) {
					// Activate the tab to the left, or the new last tab
					const newIndex = Math.min(closedIndex, next.length - 1)
					setActiveTabId(next[newIndex].id)
				}

				return next
			})
		},
		[activeTabId],
	)

	const closeCurrentTab = useCallback(() => {
		closeTab(activeTabId)
	}, [closeTab, activeTabId])

	const focusAddressBar = useCallback(() => {
		addressBarRef.current?.focus()
	}, [])

	// ── Stack onboarding ───────────────────────────────────────────────────

	useEffect(() => {
		const unsub1 = onStackOnboardingRequired(({ adminUrl }) => {
			setStackOnboardingUrl(adminUrl)
		})
		const unsub2 = onStackOnboardingComplete(() => {
			setStackOnboardingUrl(null)
		})
		return () => {
			unsub1()
			unsub2()
		}
	}, [])

	const handleOpenStackSetup = useCallback(() => {
		if (!stackOnboardingUrl) return
		rpc.request.openBrowserWindow({
			url: stackOnboardingUrl,
			title: '1Sat Stack Setup',
		})
	}, [stackOnboardingUrl])

	const dismissOnboarding = useCallback(() => {
		setStackOnboardingUrl(null)
	}, [])

	// ── Deep link handler (1sat:// URLs from macOS) ────────────────────────

	useEffect(() => {
		const unsub = onNavigateToUrl(({ url }) => {
			navigate(url)
		})
		return unsub
	}, [navigate])

	// Onboarding is handled by App.tsx — BrowserLayout only renders when unlocked

	// ── Keyboard shortcuts via TanStack Hotkeys ──────────────────────────

	useHotkeys([
		// Tab management
		{ hotkey: 'Mod+T', callback: () => createNewTab() },
		{ hotkey: 'Mod+W', callback: () => closeCurrentTab() },
		{ hotkey: 'Mod+1', callback: () => switchToTab(0) },
		{ hotkey: 'Mod+2', callback: () => switchToTab(1) },
		{ hotkey: 'Mod+3', callback: () => switchToTab(2) },
		{ hotkey: 'Mod+4', callback: () => switchToTab(3) },
		{ hotkey: 'Mod+5', callback: () => switchToTab(4) },
		{ hotkey: 'Mod+6', callback: () => switchToTab(5) },
		{ hotkey: 'Mod+7', callback: () => switchToTab(6) },
		{ hotkey: 'Mod+8', callback: () => switchToTab(7) },
		{ hotkey: 'Mod+9', callback: () => switchToTab(8) },
		{ hotkey: 'Mod+Shift+]', callback: () => { /* next tab */ const idx = tabs.findIndex(t => t.id === activeTabId); if (idx < tabs.length - 1) switchToTab(idx + 1) } },
		{ hotkey: 'Mod+Shift+[', callback: () => { /* prev tab */ const idx = tabs.findIndex(t => t.id === activeTabId); if (idx > 0) switchToTab(idx - 1) } },

		// Navigation
		{ hotkey: 'Mod+[', callback: () => goBack() },
		{ hotkey: 'Mod+]', callback: () => goForward() },
		{ hotkey: 'Mod+ArrowLeft', callback: () => goBack() },
		{ hotkey: 'Mod+ArrowRight', callback: () => goForward() },
		{ hotkey: 'Mod+R', callback: () => reload() },
		{ hotkey: 'Mod+Shift+R', callback: () => reload() },

		// Address bar
		{ hotkey: 'Mod+L', callback: () => focusAddressBar() },
		{ hotkey: 'Mod+K', callback: () => focusAddressBar() },

		// Features
		{ hotkey: 'Mod+D', callback: () => { const url = getFullUrl(activeNav.current); bookmarksApi.addBookmark(url, getDisplayLabel(activeNav.current)) } },
		{ hotkey: 'Mod+Shift+S', callback: () => toggleTabMode() },
		{ hotkey: 'Mod+Shift+A', callback: () => toggleAgentSidebar() },
		{ hotkey: 'Mod+Alt+I', callback: () => { rpc.request.toggleDevTools() } },
		{ hotkey: 'Mod+,', callback: () => navigate('1sat://settings') },

		// Find on page
		{ hotkey: 'Mod+F', callback: () => openFindBar() },
		{
			hotkey: 'Mod+G',
			callback: () => {
				if (!findBarOpen || !findQuery) return
				const wv = activeWebviewRef.current
				if (wv) (wv as HTMLElement & { findInPage?: (text: string, opts?: object) => void }).findInPage?.(findQuery, { forward: true })
			},
		},
		{
			hotkey: 'Mod+Shift+G',
			callback: () => {
				if (!findBarOpen || !findQuery) return
				const wv = activeWebviewRef.current
				if (wv) (wv as HTMLElement & { findInPage?: (text: string, opts?: object) => void }).findInPage?.(findQuery, { forward: false })
			},
		},

		// Home
		{ hotkey: 'Mod+Shift+H', callback: () => navigate('1sat://browser/new') },
	], { preventDefault: true })

	// ── Derived render properties ──────────────────────────────────────────

	const route = activeNav.current
	const currentUrl = getFullUrl(route)
	const currentTitle = activeTab.customTitle ?? getDisplayLabel(route)
	const isFullHeight =
		route.type === 'ai-chat' ||
		(route.type === 'internal' &&
			(route.page === 'chat' || route.page === 'browser/new'))

	// Content area with optional docked agent sidebar
	const contentArea = (
		<div className="flex flex-row flex-1 overflow-hidden min-h-0">
			<BrowserContextMenu
				onBack={goBack}
				onForward={goForward}
				onReload={reload}
				canGoBack={activeNav.canGoBack}
				canGoForward={activeNav.canGoForward}
				currentUrl={currentUrl}
				onBookmark={() => bookmarksApi.addBookmark(currentUrl, currentTitle)}
			>
				<main
					key={`${activeTabId}-${activeTab.reloadKey}`}
					className={
						isFullHeight || route.type !== 'internal'
							? 'flex-1 overflow-hidden relative'
							: 'flex-1 overflow-y-auto p-6'
					}
				>
					{route.type === 'internal' ? (
						renderPage(route, navigate)
					) : route.type === 'ai-chat' ? (
						<AiChatView
							initialQuery={route.query}
							onNavigate={navigate}
						/>
					) : (
						<WebViewContent
							route={route}
							onNavigated={handleWebViewNavigated}
							onTitleChanged={handleWebViewTitleChanged}
							webviewRef={activeWebviewRef}
						/>
					)}
				</main>
			</BrowserContextMenu>
			<AgentSidebar
				open={agentSidebarOpen}
				onClose={closeAgentSidebar}
				currentRoute={route}
				onNavigate={navigate}
			/>
		</div>
	)

	// Shared onboarding banner
	const onboardingBanner = stackOnboardingUrl ? (
		<div className="flex-none flex items-center justify-between px-4 py-2 border-b border-primary/30 bg-primary/5">
			<div className="flex items-center gap-2">
				<Server size={14} className="text-primary" />
				<span className="text-xs font-medium text-foreground">
					1Sat Stack needs setup to sync blockchain data
				</span>
			</div>
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					className="h-7 text-xs"
					onClick={handleOpenStackSetup}
				>
					Complete Setup
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-xs text-muted-foreground"
					onClick={dismissOnboarding}
				>
					Dismiss
				</Button>
			</div>
		</div>
	) : null

	// ── Find bar (shown between toolbar and content for webview routes) ──────

	const findBar = findBarOpen ? (
		<div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border shrink-0">
			<Search size={13} className="text-muted-foreground" />
			<input
				// biome-ignore lint/a11y/noAutofocus: intentional focus for find bar
				autoFocus
				value={findQuery}
				onChange={(e) => {
					setFindQuery(e.target.value)
					const wv = activeWebviewRef.current
					if (wv && e.target.value) {
						;(wv as HTMLElement & { findInPage?: (text: string, opts?: object) => void }).findInPage?.(e.target.value)
					}
				}}
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						closeFindBar()
					} else if (e.key === 'Enter') {
						const wv = activeWebviewRef.current
						if (wv && findQuery) {
							;(wv as HTMLElement & { findInPage?: (text: string, opts?: object) => void }).findInPage?.(findQuery, { forward: !e.shiftKey })
						}
					}
				}}
				placeholder="Find on page..."
				className="flex-1 bg-transparent text-xs text-foreground outline-none"
			/>
			<Button variant="ghost" size="icon-xs" onClick={closeFindBar} aria-label="Close find bar">
				<X size={12} />
			</Button>
		</div>
	) : null

	// ── Minimal chrome for onboarding states ───────────────────────────────

	if (tabMode === 'vertical') {
		return (
			<div className="flex flex-row h-screen bg-background text-foreground overflow-hidden">
				{/* Vertical tab sidebar */}
				<VerticalTabSidebar
					tabs={tabs}
					activeTabId={activeTabId}
					onTabClick={handleTabClick}
					onTabClose={closeTab}
					onNewTab={createNewTab}
				/>

				{/* Main column: toolbar + content */}
				<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
					{/* Toolbar — no traffic light pad, sidebar handles that region */}
					<Toolbar
						route={route}
						canGoBack={activeNav.canGoBack}
						canGoForward={activeNav.canGoForward}
						onBack={goBack}
						onForward={goForward}
						onReload={reload}
						onNavigate={navigate}
						addressBarRef={addressBarRef}
						trafficLightPad={false}
						onOpenAgent={toggleAgentSidebar}
						onToggleTabMode={toggleTabMode}
						bookmarksApi={bookmarksApi}
						currentUrl={currentUrl}
						currentTitle={currentTitle}
						onPopoverOpen={onPopoverOpen}
						onPopoverClose={onPopoverClose}
					/>

					{/* Divider */}
					<Separator className="shrink-0" />

					{onboardingBanner}
					{findBar}
					{contentArea}

					{/* Sync terminal — toggled via Cmd+Shift+J */}
					{syncLogEnabled && <SyncTerminal events={events} />}

					{/* Link hover tooltip — Chrome-style status bar */}
					{hoveredLink && (
						<div className="absolute bottom-0 left-0 max-w-[60%] px-2 py-1 text-xs text-muted-foreground bg-card/95 border border-border rounded-tr-md truncate z-50">
							{hoveredLink}
						</div>
					)}
				</div>

				{/* Permission overlay — modal dialog for wallet access requests */}
				<PermissionOverlay />
			</div>
		)
	}

	return (
		<div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
			{/* Tab bar row — draggable for window movement */}
			<TabBar
				tabs={tabs}
				activeTabId={activeTabId}
				onTabClick={handleTabClick}
				onTabClose={closeTab}
				onNewTab={createNewTab}
			/>

			{/* Toolbar row */}
			<Toolbar
				route={route}
				canGoBack={activeNav.canGoBack}
				canGoForward={activeNav.canGoForward}
				onBack={goBack}
				onForward={goForward}
				onReload={reload}
				onNavigate={navigate}
				addressBarRef={addressBarRef}
				trafficLightPad={false}
				onOpenAgent={toggleAgentSidebar}
				onToggleTabMode={toggleTabMode}
				bookmarksApi={bookmarksApi}
				currentUrl={currentUrl}
				currentTitle={currentTitle}
			/>

			{/* Divider */}
			<Separator className="shrink-0" />

			{onboardingBanner}
			{findBar}
			{contentArea}

			{/* Sync terminal — toggled via Cmd+Shift+J */}
			{syncLogEnabled && <SyncTerminal events={events} />}

			{/* Link hover tooltip — Chrome-style status bar */}
			{hoveredLink && (
				<div className="absolute bottom-0 left-0 max-w-[60%] px-2 py-1 text-xs text-muted-foreground bg-card/95 border border-border rounded-tr-md truncate z-50">
					{hoveredLink}
				</div>
			)}

			{/* Permission overlay — modal dialog for wallet access requests */}
			<PermissionOverlay />
		</div>
	)
}
