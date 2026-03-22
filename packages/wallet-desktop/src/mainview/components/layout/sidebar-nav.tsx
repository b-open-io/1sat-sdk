import { Button } from '@/components/ui/button'
import {
	Coins,
	History,
	Image,
	LayoutDashboard,
	PenTool,
	Settings,
} from 'lucide-react'
import { cn } from '../../lib/utils'

const NAV_ITEMS = [
	{ id: 'overview', label: 'Overview', icon: LayoutDashboard },
	{ id: 'ordinals', label: 'Ordinals', icon: Image },
	{ id: 'tokens', label: 'Tokens', icon: Coins },
	{ id: 'history', label: 'History', icon: History },
	{ id: 'inscribe', label: 'Inscribe', icon: PenTool },
	{ id: 'settings', label: 'Settings', icon: Settings },
] as const

interface SidebarNavProps {
	activeRoute: string
	onRouteChange: (route: string) => void
	collapsed: boolean
}

export function SidebarNav({
	activeRoute,
	onRouteChange,
	collapsed,
}: SidebarNavProps) {
	return (
		<nav
			className={cn(
				'flex-none flex flex-col gap-1 border-r border-border bg-card py-3 transition-all duration-200',
				collapsed ? 'w-16 px-2' : 'w-56 px-3',
			)}
		>
			{NAV_ITEMS.map((item) => {
				const Icon = item.icon
				const isActive = activeRoute === item.id
				return (
					<Button
						key={item.id}
						variant="ghost"
						className={cn(
							'justify-start gap-3',
							collapsed ? 'justify-center px-0' : 'px-3',
							isActive
								? 'bg-secondary text-secondary-foreground'
								: 'text-muted-foreground hover:text-foreground hover:bg-accent',
						)}
						onClick={() => onRouteChange(item.id)}
					>
						<Icon size={18} className="shrink-0" />
						{!collapsed && (
							<span className="text-sm truncate">{item.label}</span>
						)}
					</Button>
				)
			})}
		</nav>
	)
}
