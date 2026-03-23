import { SyncTerminal } from '@/components/blocks/sync-terminal'
import { Button } from '@/components/ui/button'
import {
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightClose,
	PanelRightOpen,
	Server,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSyncEvents } from '../../hooks/use-sync-events'
import { useWallet } from '../../hooks/use-wallet'
import { onStackOnboardingComplete, onStackOnboardingRequired, rpc } from '../../rpc'
import { BrowserView } from '../../views/browser/index'
import { ChatView } from '../../views/chat/index'
import { CollectionsView } from '../../views/collections/index'
import { OverviewView } from '../../views/dashboard/index'
import { HistoryView } from '../../views/history/index'
import { IdentityView } from '../../views/identity/index'
import { InscribeView } from '../../views/inscribe/index'
import { LocksView } from '../../views/locks/index'
import { OpnsView } from '../../views/opns/index'
import { OrdinalsView } from '../../views/ordinals/index'
import { SettingsView } from '../../views/settings/index'
import { SocialView } from '../../views/social/index'
import { TokensView } from '../../views/tokens/index'
import { SidebarNav } from './sidebar-nav'
import { WalletPanel } from './wallet-panel'

type Route =
	| 'overview'
	| 'browser'
	| 'ordinals'
	| 'tokens'
	| 'history'
	| 'inscribe'
	| 'collections'
	| 'locks'
	| 'opns'
	| 'social'
	| 'chat'
	| 'identity'
	| 'settings'

const TITLEBAR_HEIGHT = 14 // px — space for macOS traffic lights

export function DesktopLayout() {
	const { lockWallet } = useWallet()
	const { events } = useSyncEvents()

	const [route, setRoute] = useState<Route>('overview')
	const [leftCollapsed, setLeftCollapsed] = useState(false)
	const [rightCollapsed, setRightCollapsed] = useState(false)
	const [stackOnboardingUrl, setStackOnboardingUrl] = useState<string | null>(null)

	const toggleLeftSidebar = useCallback(() => {
		setLeftCollapsed((prev) => !prev)
	}, [])

	const toggleRightPanel = useCallback(() => {
		setRightCollapsed((prev) => !prev)
	}, [])

	const handleLock = useCallback(async () => {
		await lockWallet()
	}, [lockWallet])

	// Listen for stack onboarding requirement and completion
	useEffect(() => {
		const unsub1 = onStackOnboardingRequired(({ adminUrl }) => {
			setStackOnboardingUrl(adminUrl)
		})
		const unsub2 = onStackOnboardingComplete(() => {
			setStackOnboardingUrl(null)
		})
		return () => { unsub1(); unsub2() }
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

	// Keyboard shortcuts: [ toggles left, ] toggles right
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			// Ignore when typing in an input/textarea
			const tag = (e.target as HTMLElement).tagName
			if (tag === 'INPUT' || tag === 'TEXTAREA') return

			if (e.key === '[') {
				setLeftCollapsed((prev) => !prev)
			} else if (e.key === ']') {
				setRightCollapsed((prev) => !prev)
			}
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [])

	function renderRoute() {
		switch (route) {
			case 'overview':
				return <OverviewView />
			case 'browser':
				return <BrowserView />
			case 'ordinals':
				return <OrdinalsView />
			case 'tokens':
				return <TokensView />
			case 'history':
				return <HistoryView />
			case 'inscribe':
				return <InscribeView />
			case 'collections':
				return <CollectionsView />
			case 'locks':
				return <LocksView />
			case 'opns':
				return <OpnsView />
			case 'social':
				return <SocialView />
			case 'chat':
				return <ChatView />
			case 'identity':
				return <IdentityView />
			case 'settings':
				return <SettingsView />
		}
	}

	return (
		<div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
			{/* Invisible drag strip for macOS traffic lights */}
			<div
				className="electrobun-webkit-app-region-drag fixed top-0 left-0 right-0 z-[100]"
				style={{ height: TITLEBAR_HEIGHT }}
			/>

			{/* Header */}
			<header
				className="electrobun-webkit-app-region-drag flex-none h-12 border-b border-border bg-card flex items-center justify-between px-4"
				style={{ marginTop: TITLEBAR_HEIGHT }}
			>
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon" onClick={toggleLeftSidebar}>
						{leftCollapsed ? (
							<PanelLeftOpen size={18} />
						) : (
							<PanelLeftClose size={18} />
						)}
					</Button>
					<span className="font-bold text-sm tracking-wider">1Sat Wallet</span>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={handleLock}>
						Lock
					</Button>
					<Button variant="ghost" size="icon" onClick={toggleRightPanel}>
						{rightCollapsed ? (
							<PanelRightOpen size={18} />
						) : (
							<PanelRightClose size={18} />
						)}
					</Button>
				</div>
			</header>

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
						<Button size="sm" className="h-7 text-xs" onClick={handleOpenStackSetup}>
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

			{/* Middle: sidebar + content + wallet panel */}
			<div className="flex flex-1 overflow-hidden">
				<SidebarNav
					activeRoute={route}
					onRouteChange={(r) => setRoute(r as Route)}
					collapsed={leftCollapsed}
				/>
				<main
					className={
						route === 'browser' || route === 'chat'
							? 'flex-1 overflow-hidden'
							: 'flex-1 overflow-y-auto p-6'
					}
				>
					{renderRoute()}
				</main>
				{!rightCollapsed && <WalletPanel />}
			</div>

			{/* Sync terminal */}
			<SyncTerminal events={events} />
		</div>
	)
}
