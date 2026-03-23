import { SyncTerminal } from '@/components/blocks/sync-terminal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
	ArrowLeft,
	ArrowRight,
	ChevronDown,
	Globe,
	Plus,
	RotateCw,
	Server,
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
import { ORDFS_BASE } from '../../lib/url-parser'
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
	onNavigateToUrl,
	onStackOnboardingComplete,
	onStackOnboardingRequired,
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
				backgroundColor: 'oklch(0.17 0.012 96)',
			}}
		>
			<div
				role="tablist"
				className="flex items-stretch h-full electrobun-webkit-app-region-no-drag"
			>
				{tabs.map((tab) => (
					<Tab
						key={tab.id}
						label={getDisplayLabel(tab.nav.current)}
						active={tab.id === activeTabId}
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
					const label = getDisplayLabel(tab.nav.current)
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
							<Globe size={12} className="shrink-0 opacity-60" />
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
	)
}

const PROTOCOLS = [
	{ value: '1sat://', label: '1sat://', bg: 'oklch(0.35 0.12 260)', fg: 'oklch(0.78 0.14 260)' },
	{ value: 'https://', label: 'https://', bg: 'oklch(0.25 0.08 150)', fg: 'oklch(0.7 0.15 150)' },
	{ value: 'http://', label: 'http://', bg: 'oklch(0.25 0.05 50)', fg: 'oklch(0.7 0.1 50)' },
	{ value: 'ai://', label: 'ai://', bg: 'oklch(0.3 0.12 300)', fg: 'oklch(0.75 0.15 300)' },
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
	bookmarksApi: ReturnType<typeof useBookmarks>
	currentUrl: string
	currentTitle: string
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
	bookmarksApi,
	currentUrl,
	currentTitle,
}: ToolbarProps) {
	const [bookmarksOpen, setBookmarksOpen] = useState(false)

	return (
		<div
			className="flex items-center gap-1.5 px-2 shrink-0 bg-background"
			style={{ height: TOOLBAR_HEIGHT, paddingLeft: trafficLightPad ? TRAFFIC_LIGHT_PAD : undefined }}
		>
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

			{/* Address bar */}
			<AddressBar
				route={route}
				onNavigate={onNavigate}
				inputRef={addressBarRef}
			/>

			{/* Identity + action buttons */}
			<IdentityChip />
			<div className="flex items-center gap-0.5">
				<WalletPopover onNavigate={onNavigate} />
				<BookmarksPopover
					bookmarksApi={bookmarksApi}
					currentUrl={currentUrl}
					currentTitle={currentTitle}
					onNavigate={onNavigate}
					open={bookmarksOpen}
					onOpenChange={setBookmarksOpen}
				/>
				<AgentPopover onOpenAgent={onOpenAgent} />
				<MenuPopover
					onNavigate={onNavigate}
					onOpenBookmarks={() => setBookmarksOpen(true)}
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

function WebViewContent({ route }: { route: ParsedRoute }) {
	const containerRef = useRef<HTMLDivElement>(null)
	const webviewRef = useRef<HTMLElement | null>(null)

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

		container.appendChild(webview)
		webviewRef.current = webview

		return () => {
			webview.remove()
			webviewRef.current = null
		}
	}, [route])

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

	// ── Navigation helpers (operate on the active tab's nav state) ─────────

	const dispatchNav = useCallback(
		(action: Parameters<typeof applyNavAction>[1]) => {
			setTabs((prev) =>
				prev.map((tab) =>
					tab.id === activeTabId
						? { ...tab, nav: applyNavAction(tab.nav, action) }
						: tab,
				),
			)
		},
		[activeTabId],
	)

	const navigate = useCallback(
		(input: string) => {
			dispatchNav({ type: 'navigate', input })
		},
		[dispatchNav],
	)

	const goBack = useCallback(() => {
		dispatchNav({ type: 'back' })
	}, [dispatchNav])

	const goForward = useCallback(() => {
		dispatchNav({ type: 'forward' })
	}, [dispatchNav])

	const reload = useCallback(() => {
		setTabs((prev) =>
			prev.map((tab) =>
				tab.id === activeTabId
					? { ...tab, reloadKey: tab.reloadKey + 1 }
					: tab,
			),
		)
	}, [activeTabId])

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

	// ── Keyboard shortcuts via TanStack Hotkeys ──────────────────────────

	useHotkeys([
		{ hotkey: 'Mod+T', callback: () => createNewTab() },
		{ hotkey: 'Mod+W', callback: () => closeCurrentTab() },
		{ hotkey: 'Mod+L', callback: () => focusAddressBar() },
		{ hotkey: 'Mod+K', callback: () => focusAddressBar() },
		{ hotkey: 'Mod+[', callback: () => goBack() },
		{ hotkey: 'Mod+]', callback: () => goForward() },
		{ hotkey: 'Mod+R', callback: () => reload() },
		{ hotkey: 'Mod+Shift+S', callback: () => toggleTabMode() },
		{ hotkey: 'Mod+Shift+A', callback: () => toggleAgentSidebar() },
		{ hotkey: 'Mod+,', callback: () => navigate('1sat://settings') },
		{ hotkey: 'Mod+D', callback: () => { const url = getFullUrl(activeNav.current); bookmarksApi.addBookmark(url, getDisplayLabel(activeNav.current)) } },
		{ hotkey: 'Mod+1', callback: () => switchToTab(0) },
		{ hotkey: 'Mod+2', callback: () => switchToTab(1) },
		{ hotkey: 'Mod+3', callback: () => switchToTab(2) },
		{ hotkey: 'Mod+4', callback: () => switchToTab(3) },
		{ hotkey: 'Mod+5', callback: () => switchToTab(4) },
		{ hotkey: 'Mod+6', callback: () => switchToTab(5) },
		{ hotkey: 'Mod+7', callback: () => switchToTab(6) },
		{ hotkey: 'Mod+8', callback: () => switchToTab(7) },
		{ hotkey: 'Mod+9', callback: () => switchToTab(8) },
	], { preventDefault: true })

	// ── Derived render properties ──────────────────────────────────────────

	const route = activeNav.current
	const currentUrl = getFullUrl(route)
	const currentTitle = getDisplayLabel(route)
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
						<WebViewContent route={route} />
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
						bookmarksApi={bookmarksApi}
						currentUrl={currentUrl}
						currentTitle={currentTitle}
					/>

					{/* Divider */}
					<div className="h-px bg-border shrink-0" />

					{onboardingBanner}
					{contentArea}

					{/* Sync terminal */}
					<SyncTerminal events={events} />
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
				bookmarksApi={bookmarksApi}
				currentUrl={currentUrl}
				currentTitle={currentTitle}
			/>

			{/* Divider */}
			<div className="h-px bg-border shrink-0" />

			{onboardingBanner}
			{contentArea}

			{/* Sync terminal */}
			<SyncTerminal events={events} />

			{/* Permission overlay — modal dialog for wallet access requests */}
			<PermissionOverlay />
		</div>
	)
}
