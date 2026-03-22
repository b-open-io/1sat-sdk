export type Tab =
	| 'overview'
	| 'ordinals'
	| 'tokens'
	| 'history'
	| 'inscribe'
	| 'settings'

interface TabBarProps {
	activeTab: Tab
	onTabChange: (tab: Tab) => void
}

const TABS: { id: Tab; label: string }[] = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'ordinals', label: 'Ordinals' },
	{ id: 'tokens', label: 'Tokens' },
	{ id: 'history', label: 'History' },
	{ id: 'inscribe', label: 'Inscribe' },
	{ id: 'settings', label: 'Settings' },
]

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
	return (
		<div className="flex border-b border-border overflow-x-auto">
			{TABS.map((tab) => (
				<button
					key={tab.id}
					type="button"
					onClick={() => onTabChange(tab.id)}
					className={`px-4 py-2 text-xs font-mono uppercase tracking-wider whitespace-nowrap transition-colors ${
						activeTab === tab.id
							? 'border-b-2 border-primary text-foreground'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					{tab.label}
				</button>
			))}
		</div>
	)
}
