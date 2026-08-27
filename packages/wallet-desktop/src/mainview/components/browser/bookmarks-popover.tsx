import { Bookmark, Globe, Link, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { UseBookmarksReturn } from '../../hooks/use-bookmarks'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BookmarksPopoverProps {
	bookmarksApi: UseBookmarksReturn
	currentUrl: string
	currentTitle: string
	onNavigate: (url: string) => void
	/** Optionally control open state from outside */
	open?: boolean
	onOpenChange?: (open: boolean) => void
}

// ---------------------------------------------------------------------------
// BookmarkRow
// ---------------------------------------------------------------------------

interface BookmarkRowProps {
	url: string
	title: string
	onNavigate: (url: string) => void
	onRemove: () => void
}

function BookmarkRow({ url, title, onNavigate, onRemove }: BookmarkRowProps) {
	const [hovered, setHovered] = useState(false)

	// Truncate URL for display: strip protocol prefix
	const displayUrl = url
		.replace(/^(1sat|https?|ordfs):\/\//, '')
		.replace(/\/$/, '')

	return (
		<div
			className="group flex items-center gap-2 px-3 py-1.5 rounded-[3px] hover:bg-muted/50 cursor-default transition-colors"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<button
				type="button"
				className="flex items-center gap-2 flex-1 min-w-0 text-left"
				onClick={onNavigate.bind(null, url)}
			>
				<span className="shrink-0 text-muted-foreground">
					<Globe size={11} />
				</span>
				<span className="flex-1 min-w-0">
					<span
						className="block text-[11px] text-foreground truncate"
						style={{ fontFamily: 'var(--font-sans)' }}
					>
						{title}
					</span>
					<span className="block text-[10px] text-muted-foreground/60 truncate font-mono">
						{displayUrl}
					</span>
				</span>
			</button>
			{hovered && (
				<button
					type="button"
					onClick={onRemove}
					className="shrink-0 p-0.5 rounded-[3px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
					aria-label="Remove bookmark"
				>
					<Trash2 size={11} />
				</button>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

function SectionLabel({ label }: { label: string }) {
	return (
		<div className="px-3 pt-2 pb-0.5">
			<span
				className="text-[9px] font-semibold tracking-widest text-muted-foreground/50 uppercase"
				style={{ fontFamily: 'var(--font-sans)', letterSpacing: '0.12em' }}
			>
				{label}
			</span>
		</div>
	)
}

// ---------------------------------------------------------------------------
// BookmarksPopover
// ---------------------------------------------------------------------------

export function BookmarksPopover({
	bookmarksApi,
	currentUrl,
	currentTitle,
	onNavigate,
	open: controlledOpen,
	onOpenChange: onControlledOpenChange,
}: BookmarksPopoverProps) {
	const [internalOpen, setInternalOpen] = useState(false)
	const open = controlledOpen ?? internalOpen
	const setOpen = onControlledOpenChange ?? setInternalOpen
	const [query, setQuery] = useState('')

	const { bookmarks, addBookmark, removeBookmark, isBookmarked } = bookmarksApi

	const handleNavigate = (url: string) => {
		setOpen(false)
		onNavigate(url)
	}

	const handleAddCurrent = () => {
		addBookmark(currentUrl, currentTitle)
	}

	const alreadyBookmarked = isBookmarked(currentUrl)

	// Filter by search query
	const filtered = query.trim()
		? bookmarks.filter(
				(b) =>
					b.title.toLowerCase().includes(query.toLowerCase()) ||
					b.url.toLowerCase().includes(query.toLowerCase()),
			)
		: bookmarks

	const onchain = filtered.filter((b) => b.category === 'onchain')
	const web = filtered.filter((b) => b.category === 'web')
	const hasAny = onchain.length > 0 || web.length > 0

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger>
				<Button
					variant="ghost"
					size="icon-xs"
					className={cn(
						'text-muted-foreground',
						alreadyBookmarked && 'text-primary',
					)}
					style={{ borderRadius: 5 }}
					aria-label={
						alreadyBookmarked ? 'Manage bookmarks' : 'Bookmark this page'
					}
					onClick={(e) => {
						if (!alreadyBookmarked) {
							e.stopPropagation()
							addBookmark(currentUrl, currentTitle)
						}
						// When already bookmarked, let Radix handle the toggle
					}}
				>
					<Bookmark
						size={14}
						className={alreadyBookmarked ? 'fill-primary' : ''}
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={6}
				className="p-0 border-border shadow-xl"
				style={{ width: 300, borderRadius: 0 }}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-3 py-2 border-b border-border">
					<span
						className="text-[12px] font-semibold text-foreground"
						style={{ fontFamily: 'var(--font-sans)' }}
					>
						Bookmarks
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
						onClick={handleAddCurrent}
						disabled={alreadyBookmarked}
					>
						<Plus size={11} />
						{alreadyBookmarked ? 'Saved' : '+ Add'}
					</Button>
				</div>

				{/* Search */}
				<div className="px-3 py-2 border-b border-border">
					<div className="relative flex items-center">
						<Search
							size={11}
							className="absolute left-2 text-muted-foreground/50 pointer-events-none"
						/>
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search bookmarks..."
							className="h-6 pl-6 text-[11px] font-mono bg-muted/30 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
							style={{ borderRadius: 3 }}
						/>
					</div>
				</div>

				{/* Bookmark list */}
				<ScrollArea className="max-h-[320px]">
					<div className="py-1">
						{!hasAny && (
							<div className="flex flex-col items-center justify-center py-8 gap-2">
								<Link size={20} className="text-muted-foreground/30" />
								<p
									className="text-[11px] text-muted-foreground/50"
									style={{ fontFamily: 'var(--font-sans)' }}
								>
									{query.trim() ? 'No matches' : 'No bookmarks yet'}
								</p>
							</div>
						)}

						{onchain.length > 0 && (
							<>
								<SectionLabel label="On-Chain" />
								{onchain.map((b) => (
									<BookmarkRow
										key={b.id}
										url={b.url}
										title={b.title}
										onNavigate={handleNavigate}
										onRemove={() => removeBookmark(b.id)}
									/>
								))}
							</>
						)}

						{web.length > 0 && (
							<>
								<SectionLabel label="Web" />
								{web.map((b) => (
									<BookmarkRow
										key={b.id}
										url={b.url}
										title={b.title}
										onNavigate={handleNavigate}
										onRemove={() => removeBookmark(b.id)}
									/>
								))}
							</>
						)}
					</div>
				</ScrollArea>
			</PopoverContent>
		</Popover>
	)
}
