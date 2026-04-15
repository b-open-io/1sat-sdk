import { useCallback, useMemo, useState } from 'react'
import type { Bookmark } from '../../hooks/use-bookmarks'
import { classifyInput, classifyInputSecondary } from '../../lib/classify-input'
import { AppGrid } from './app-grid'
import { LauncherInput } from './launcher-input'
import { SuggestionList } from './suggestion-list'

interface LauncherOverlayProps {
	bookmarks: Bookmark[]
	onClose: () => void
	onNavigate: (url: string) => void
	onOpenAi: (query: string) => void
	initialQuery?: string
}

export function LauncherOverlay({
	bookmarks,
	onClose,
	onNavigate,
	onOpenAi,
	initialQuery = '',
}: LauncherOverlayProps) {
	const [query, setQuery] = useState(initialQuery)
	const [selectedIndex, setSelectedIndex] = useState(0)

	const classification = useMemo(
		() => classifyInput(query, bookmarks),
		[query, bookmarks],
	)

	const secondaryClassification = useMemo(
		() =>
			classification.type === 'app-match'
				? classifyInputSecondary(query)
				: null,
		[classification, query],
	)

	const handleSelect = useCallback(
		(bookmark: Bookmark) => {
			onNavigate(bookmark.url)
			onClose()
		},
		[onNavigate, onClose],
	)

	const handleExplore = useCallback(() => {
		onNavigate('1sat://apps')
		onClose()
	}, [onNavigate, onClose])

	const handleSubmit = useCallback(() => {
		if (!query.trim()) return

		switch (classification.type) {
			case 'app-match':
				if (classification.apps.length > 0) {
					const target =
						classification.apps[
							Math.min(selectedIndex, classification.apps.length - 1)
						]
					onNavigate(target.url)
				}
				break
			case 'url':
				onNavigate(classification.url)
				break
			case 'outpoint':
				onNavigate(`1sat://${classification.txid}_${classification.vout}`)
				break
			case 'internal':
				onNavigate(`1sat://${classification.page}`)
				break
			case 'ai-query':
				onOpenAi(classification.text)
				onClose()
				break
		}
	}, [query, classification, selectedIndex, onNavigate, onOpenAi, onClose])

	const showGrid = classification.type === 'app-match' || !query.trim()
	const hasResults = showGrid
		? classification.type === 'app-match'
			? classification.apps.length > 0
			: bookmarks.length > 0
		: classification.type !== 'ai-query'

	return (
		<div
			className="fixed inset-0 z-50 flex items-start justify-center"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === 'Escape') onClose()
			}}
		>
			{/* Backdrop */}
			<div className="absolute inset-0 bg-background/80 backdrop-blur-md" />

			{/* Dia/Raycast-style panel — centered, generous sizing */}
			<div
				className="launcher-overlay relative w-[680px] max-h-[min(520px,75vh)] mt-[15vh] bg-card border border-border/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-[0.97] duration-150"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				{/* Search input */}
				<LauncherInput
					value={query}
					onChange={(v) => {
						setQuery(v)
						setSelectedIndex(0)
					}}
					onEscape={onClose}
					onSubmit={handleSubmit}
				/>

				{/* Results area */}
				<div className="flex-1 overflow-y-auto min-h-0">
					{showGrid && (
						<div className="px-5 py-4">
							{!query.trim() && bookmarks.length > 0 && (
								<p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
									Bookmarked Apps
								</p>
							)}
							<AppGrid
								bookmarks={
									classification.type === 'app-match'
										? classification.apps
										: bookmarks
								}
								filter=""
								onSelect={handleSelect}
								onExplore={handleExplore}
								selectedIndex={selectedIndex}
							/>
						</div>
					)}

					<SuggestionList
						classification={secondaryClassification ?? classification}
						input={query}
						onSelect={handleSubmit}
						selected={classification.type !== 'app-match'}
					/>
				</div>

				{/* Footer — only show when there are results */}
				{(hasResults || query.trim()) && (
					<div className="border-t border-border/30 px-5 py-2 flex justify-between items-center shrink-0">
						<div className="flex gap-4">
							<span className="text-[10px] text-muted-foreground/60">
								Open{' '}
								<kbd className="bg-muted/60 px-1.5 py-0.5 rounded text-[9px] ml-1">
									&#x23CE;
								</kbd>
							</span>
						</div>
						<span className="text-[10px] text-muted-foreground/40">
							Ask AI{' '}
							<kbd className="bg-muted/60 px-1.5 py-0.5 rounded text-[9px] ml-1">
								Tab
							</kbd>
						</span>
					</div>
				)}
			</div>
		</div>
	)
}
