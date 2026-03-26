import { Globe, Link2, Plus } from 'lucide-react'
import { useState } from 'react'
import type { Bookmark } from '../../hooks/use-bookmarks'

interface AppGridProps {
	bookmarks: Bookmark[]
	filter: string
	onSelect: (bookmark: Bookmark) => void
	onExplore: () => void
	selectedIndex: number
}

function hashColor(str: string): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		hash = str.charCodeAt(i) + ((hash << 5) - hash)
	}
	const hue = Math.abs(hash) % 360
	return `hsl(${hue}, 60%, 45%)`
}

function getInitials(name: string): string {
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? '')
		.join('')
}

export function AppGrid({
	bookmarks,
	filter,
	onSelect,
	onExplore,
	selectedIndex,
}: AppGridProps) {
	const filtered = filter
		? bookmarks.filter((b) => {
				const q = filter.toLowerCase()
				return (
					b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
				)
			})
		: bookmarks

	if (filtered.length === 0 && !filter) {
		return (
			<div className="flex flex-col items-center justify-center py-8 gap-3">
				<Globe size={24} className="text-muted-foreground" />
				<p className="text-sm text-muted-foreground">
					Bookmark apps to see them here
				</p>
				<button
					type="button"
					onClick={onExplore}
					className="text-xs text-primary hover:underline"
				>
					Explore Apps
				</button>
			</div>
		)
	}

	return (
		<div className="grid grid-cols-6 gap-3">
			{filtered.map((bookmark, idx) => (
				<AppIcon
					key={bookmark.id}
					bookmark={bookmark}
					selected={idx === selectedIndex}
					onSelect={() => onSelect(bookmark)}
				/>
			))}
			<button
				type="button"
				onClick={onExplore}
				className="flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-muted/50 transition-colors"
			>
				<div className="size-12 rounded-xl border-2 border-dashed border-border flex items-center justify-center">
					<Plus size={18} className="text-muted-foreground" />
				</div>
				<span className="text-[10px] text-muted-foreground">Explore</span>
			</button>
		</div>
	)
}

function AppIcon({
	bookmark,
	selected,
	onSelect,
}: {
	bookmark: Bookmark
	selected: boolean
	onSelect: () => void
}) {
	const [imgError, setImgError] = useState(false)
	const color = hashColor(bookmark.title)

	return (
		<button
			type="button"
			onClick={onSelect}
			className={[
				'flex flex-col items-center gap-1.5 p-2 rounded-lg transition-colors',
				selected ? 'bg-muted' : 'hover:bg-muted/50',
			].join(' ')}
		>
			<div
				className="size-12 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
				style={{
					background: bookmark.favicon && !imgError ? undefined : color,
				}}
			>
				{bookmark.favicon && !imgError ? (
					<img
						src={bookmark.favicon}
						alt=""
						className="size-full object-cover"
						onError={() => setImgError(true)}
					/>
				) : (
					<span className="text-sm font-bold text-primary-foreground">
						{getInitials(bookmark.title)}
					</span>
				)}
			</div>
			<span className="text-[10px] text-foreground truncate w-full text-center leading-tight">
				{bookmark.title}
			</span>
			{bookmark.category === 'onchain' && (
				<Link2 size={8} className="text-primary" />
			)}
		</button>
	)
}
