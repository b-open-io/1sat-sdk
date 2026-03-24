import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
	Bookmark,
	Bot,
	Clock,
	Download,
	EllipsisVertical,
	PanelLeftClose,
	Settings,
	Shield,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MenuItem {
	icon: React.ReactNode
	label: string
	shortcut?: string
	onClick: () => void
	disabled?: boolean
}

interface MenuGroup {
	items: MenuItem[]
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MenuItemRow({ item }: { item: MenuItem }) {
	return (
		<button
			type="button"
			onClick={item.onClick}
			disabled={item.disabled}
			className={cn(
				'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
				'text-[12px] rounded-[3px]',
				item.disabled
					? 'text-muted-foreground/40 cursor-not-allowed'
					: 'text-foreground hover:bg-muted/50 cursor-default',
			)}
		>
			<span className="shrink-0 text-muted-foreground size-3.5 flex items-center justify-center">
				{item.icon}
			</span>
			<span
				className="flex-1"
				style={{ fontFamily: 'var(--font-sans)' }}
			>
				{item.label}
			</span>
			{item.shortcut && (
				<Kbd className="shrink-0">{item.shortcut}</Kbd>
			)}
		</button>
	)
}

// ---------------------------------------------------------------------------
// MenuPopover
// ---------------------------------------------------------------------------

interface MenuPopoverProps {
	onNavigate: (url: string) => void
	onToggleAgent?: () => void
	onOpenBookmarks?: () => void
	onToggleTabMode?: () => void
	onOpenChange?: (open: boolean) => void
}

export function MenuPopover({ onNavigate, onToggleAgent, onOpenBookmarks, onToggleTabMode, onOpenChange }: MenuPopoverProps) {
	const [openInternal, setOpenInternal] = useState(false)
	const setOpen = useCallback((v: boolean) => { setOpenInternal(v); onOpenChange?.(v) }, [onOpenChange])
	const open = openInternal

	const navigate = (url: string) => {
		setOpen(false)
		onNavigate(url)
	}

	const groups: MenuGroup[] = [
		{
			items: [
				{
					icon: <Bookmark size={13} />,
					label: 'Bookmarks',
					shortcut: '⌘B',
					onClick: () => {
						setOpen(false)
						onOpenBookmarks?.()
					},
				},
				{
					icon: <Clock size={13} />,
					label: 'History',
					shortcut: '⌘Y',
					onClick: () => navigate('1sat://wallet/history'),
				},
				{
					icon: <Download size={13} />,
					label: 'Downloads',
					shortcut: '⌘J',
					onClick: () => navigate('1sat://wallet/history'),
				},
			],
		},
		{
			items: [
				{
					icon: <Bot size={13} />,
					label: 'AI Agent',
					shortcut: '⌘⇧A',
					onClick: () => {
						setOpen(false)
						onToggleAgent?.()
					},
				},
				{
					icon: <Shield size={13} />,
					label: 'Permissions',
					onClick: () => navigate('1sat://settings'),
				},
			],
		},
		{
			items: [
				{
					icon: <PanelLeftClose size={13} />,
					label: 'Vertical Tabs',
					shortcut: '⌘⇧S',
					onClick: () => {
						setOpen(false)
						onToggleTabMode?.()
					},
				},
				{
					icon: <Settings size={13} />,
					label: 'Settings',
					shortcut: '⌘,',
					onClick: () => navigate('1sat://settings'),
				},
			],
		},
	]

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger>
				<Button
					variant="ghost"
					size="icon-xs"
					className="text-muted-foreground"
					style={{ borderRadius: 5 }}
					aria-label="Menu"
				>
					<EllipsisVertical size={14} />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={6}
				className="p-2 border-border shadow-xl"
				style={{ width: 220, borderRadius: 0 }}
			>
				{groups.map((group, gi) => (
					<div key={gi}>
						{gi > 0 && <Separator className="mx-1 my-1.5" />}
						<div className="flex flex-col gap-0.5">
							{group.items.map((item) => (
								<MenuItemRow key={item.label} item={item} />
							))}
						</div>
					</div>
				))}
			</PopoverContent>
		</Popover>
	)
}
