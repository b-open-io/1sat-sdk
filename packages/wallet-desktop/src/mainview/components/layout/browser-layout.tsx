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
	Wallet,
	X,
} from 'lucide-react'
import { useSyncEvents } from '../../hooks/use-sync-events'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Left padding to clear macOS traffic light buttons */
const TRAFFIC_LIGHT_PAD = 60

/** Height of the tab bar row */
const TAB_BAR_HEIGHT = 30

/** Height of the toolbar row */
const TOOLBAR_HEIGHT = 36

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

interface TabProps {
	label: string
	active: boolean
	favicon?: React.ReactNode
}

function Tab({ label, active, favicon }: TabProps) {
	return (
		<div
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
				className="ml-auto shrink-0 rounded-[3px] p-0.5 opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:bg-muted/50 transition-opacity"
				aria-label={`Close ${label}`}
			>
				<X size={10} />
			</button>
		</div>
	)
}

function NewTabButton() {
	return (
		<button
			type="button"
			className="flex items-center justify-center h-full px-2 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
			aria-label="New tab"
		>
			<Plus size={12} />
		</button>
	)
}

function TabBar() {
	return (
		<div
			className="electrobun-webkit-app-region-drag flex items-end shrink-0"
			style={{
				height: TAB_BAR_HEIGHT,
				paddingLeft: TRAFFIC_LIGHT_PAD,
				backgroundColor: 'oklch(0.17 0.012 96)',
			}}
		>
			<div className="flex items-stretch h-full electrobun-webkit-app-region-no-drag">
				<Tab label="1Sat Ordinals" active />
				<Tab label="docs.1satordinals.com" active={false} />
				<NewTabButton />
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function NavButton({
	icon,
	label,
	disabled = true,
}: { icon: React.ReactNode; label: string; disabled?: boolean }) {
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			disabled={disabled}
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

function AddressBar() {
	return (
		<div
			className="flex items-center gap-1.5 flex-1 min-w-0 px-2 border border-border bg-muted/40"
			style={{ height: 26, borderRadius: 6 }}
		>
			<ProtocolBadge protocol="1sat://" />
			<span className="truncate text-xs font-mono text-muted-foreground">
				cb9355de...3d31988_0
			</span>
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

function Toolbar() {
	return (
		<div
			className="flex items-center gap-1.5 px-2 shrink-0 bg-background"
			style={{ height: TOOLBAR_HEIGHT }}
		>
			{/* Navigation buttons */}
			<div className="flex items-center gap-0.5">
				<NavButton icon={<ArrowLeft size={14} />} label="Back" />
				<NavButton icon={<ArrowRight size={14} />} label="Forward" />
				<NavButton icon={<RotateCw size={13} />} label="Reload" />
			</div>

			{/* Address bar */}
			<AddressBar />

			{/* Identity + action buttons */}
			<IdentityChip />
			<div className="flex items-center gap-0.5">
				<NavButton
					icon={<Wallet size={14} />}
					label="Wallet"
					disabled={false}
				/>
				<NavButton icon={<Bot size={14} />} label="Agent" disabled={false} />
				<NavButton
					icon={<EllipsisVertical size={14} />}
					label="Menu"
					disabled={false}
				/>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Content placeholder
// ---------------------------------------------------------------------------

function ContentPlaceholder() {
	return (
		<div className="flex flex-1 items-center justify-center bg-background">
			<div className="text-center">
				<div className="text-sm text-muted-foreground">Content goes here</div>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// BrowserLayout
// ---------------------------------------------------------------------------

export function BrowserLayout() {
	const { events } = useSyncEvents()

	return (
		<div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
			{/* Tab bar row — draggable for window movement */}
			<TabBar />

			{/* Toolbar row */}
			<Toolbar />

			{/* Divider */}
			<div className="h-px bg-border shrink-0" />

			{/* Content area */}
			<ContentPlaceholder />

			{/* Sync terminal */}
			<SyncTerminal events={events} />
		</div>
	)
}
