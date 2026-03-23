import { SyncTerminal } from '@/components/blocks/sync-terminal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
	ArrowLeft,
	ArrowRight,
	Bot,
	ChevronDown,
	EllipsisVertical,
	Globe,
	Plus,
	RotateCw,
	Server,
	Wallet,
	X,
} from 'lucide-react'
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from 'react'
import type { ParsedRoute } from '../../../shared/url-types'
import { getDisplayLabel } from '../../../shared/url-types'
import {
	NAV_INITIAL_STATE,
	type NavState,
	applyNavAction,
} from '../../hooks/use-browser-navigation'
import { useSyncEvents } from '../../hooks/use-sync-events'
import { renderPage } from '../../lib/page-registry'
import {
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

function ProtocolBadge({ protocol }: { protocol: string }) {
	return (
		<span
			className="inline-flex items-center px-1.5 text-[10px] font-mono font-semibold shrink-0"
			style={{
				borderRadius: 4,
				backgroundColor: 'oklch(0.35 0.12 260)',
				color: 'oklch(0.78 0.14 260)',
				lineHeight: '16px',
			}}
		>
			{protocol}
		</span>
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
			<ProtocolBadge protocol="1sat://" />
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
}: ToolbarProps) {
	return (
		<div
			className="flex items-center gap-1.5 px-2 shrink-0 bg-background"
			style={{ height: TOOLBAR_HEIGHT }}
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
				<NavButton icon={<Wallet size={14} />} label="Wallet" />
				<NavButton icon={<Bot size={14} />} label="Agent" />
				<NavButton icon={<EllipsisVertical size={14} />} label="Menu" />
			</div>
		</div>
	)
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

	// ── Global keyboard shortcuts ──────────────────────────────────────────

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			// Don't intercept when user is typing in an input or textarea
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			) {
				return
			}

			if (!e.metaKey) return

			switch (e.key) {
				case 't':
					e.preventDefault()
					createNewTab()
					break
				case 'w':
					e.preventDefault()
					closeCurrentTab()
					break
				case 'l':
					e.preventDefault()
					focusAddressBar()
					break
				case '[':
					e.preventDefault()
					goBack()
					break
				case ']':
					e.preventDefault()
					goForward()
					break
				default:
					if (e.key >= '1' && e.key <= '9') {
						e.preventDefault()
						switchToTab(Number.parseInt(e.key) - 1)
					}
					break
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [createNewTab, closeCurrentTab, focusAddressBar, goBack, goForward, switchToTab])

	// ── Derived render properties ──────────────────────────────────────────

	const route = activeNav.current
	const isFullHeight =
		route.type === 'internal' &&
		(route.page === 'chat' || route.page === 'browser/new')

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
			/>

			{/* Divider */}
			<div className="h-px bg-border shrink-0" />

			{/* Stack onboarding banner */}
			{stackOnboardingUrl && (
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
			)}

			{/* Content area — keyed by reloadKey to force re-mount on reload */}
			<main
				key={`${activeTabId}-${activeTab.reloadKey}`}
				className={
					isFullHeight ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto p-6'
				}
			>
				{renderPage(route, navigate)}
			</main>

			{/* Sync terminal */}
			<SyncTerminal events={events} />
		</div>
	)
}
