import { Button } from '@/components/ui/button'
import {
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightClose,
	PanelRightOpen,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSyncEvents } from '../../hooks/use-sync-events'
import { useWallet } from '../../hooks/use-wallet'
import { SyncTerminal } from '@/components/blocks/sync-terminal'
import { HistoryView } from '../../views/history/index'
import { IdentityView } from '../../views/identity/index'
import { InscribeView } from '../../views/inscribe/index'
import { LocksView } from '../../views/locks/index'
import { OpnsView } from '../../views/opns/index'
import { OrdinalsView } from '../../views/ordinals/index'
import { SettingsView } from '../../views/settings/index'
import { SocialView } from '../../views/social/index'
import { TokensView } from '../../views/tokens/index'
import { OverviewView } from '../../views/dashboard/index'
import { SidebarNav } from './sidebar-nav'
import { WalletPanel } from './wallet-panel'

type Route =
	| 'overview'
	| 'ordinals'
	| 'tokens'
	| 'history'
	| 'inscribe'
	| 'locks'
	| 'opns'
	| 'social'
	| 'identity'
	| 'settings'

export function DesktopLayout() {
	const { lockWallet } = useWallet()
	const { events } = useSyncEvents()

	const [route, setRoute] = useState<Route>('overview')
	const [leftCollapsed, setLeftCollapsed] = useState(false)
	const [rightCollapsed, setRightCollapsed] = useState(false)

	const toggleLeftSidebar = useCallback(() => {
		setLeftCollapsed((prev) => !prev)
	}, [])

	const toggleRightPanel = useCallback(() => {
		setRightCollapsed((prev) => !prev)
	}, [])

	const handleLock = useCallback(async () => {
		await lockWallet()
	}, [lockWallet])

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
			case 'ordinals':
				return <OrdinalsView />
			case 'tokens':
				return <TokensView />
			case 'history':
				return <HistoryView />
			case 'inscribe':
				return <InscribeView />
			case 'locks':
				return <LocksView />
			case 'opns':
				return <OpnsView />
			case 'social':
				return <SocialView />
			case 'identity':
				return <IdentityView />
			case 'settings':
				return <SettingsView />
		}
	}

	return (
		<div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
			{/* Header */}
			<header className="flex-none h-12 border-b border-border bg-card flex items-center justify-between px-4">
				<div className="flex items-center gap-3">
					<Button
						variant="ghost"
						size="icon"
						onClick={toggleLeftSidebar}
					>
						{leftCollapsed ? (
							<PanelLeftOpen size={18} />
						) : (
							<PanelLeftClose size={18} />
						)}
					</Button>
					<span className="font-bold text-sm tracking-wider">
						1Sat Wallet
					</span>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={handleLock}>
						Lock
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={toggleRightPanel}
					>
						{rightCollapsed ? (
							<PanelRightOpen size={18} />
						) : (
							<PanelRightClose size={18} />
						)}
					</Button>
				</div>
			</header>

			{/* Middle: sidebar + content + wallet panel */}
			<div className="flex flex-1 overflow-hidden">
				<SidebarNav
					activeRoute={route}
					onRouteChange={(r) => setRoute(r as Route)}
					collapsed={leftCollapsed}
				/>
				<main className="flex-1 overflow-y-auto p-6">
					{renderRoute()}
				</main>
				{!rightCollapsed && <WalletPanel />}
			</div>

			{/* Sync terminal */}
			<SyncTerminal events={events} />
		</div>
	)
}
