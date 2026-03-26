import { ExternalLink, Link2, Sparkles } from 'lucide-react'
import type { InputClassification } from '../../lib/classify-input'

interface SuggestionListProps {
	classification: InputClassification
	input: string
	onSelect: () => void
	selected: boolean
}

export function SuggestionList({
	classification,
	input,
	onSelect,
	selected,
}: SuggestionListProps) {
	if (classification.type === 'app-match' || !input.trim()) return null

	const config = {
		url: {
			icon: ExternalLink,
			label: classification.type === 'url' ? classification.url : input,
			hint: 'Website',
		},
		outpoint: {
			icon: Link2,
			label: 'Open on-chain content',
			hint: 'On-Chain',
		},
		internal: {
			icon: ExternalLink,
			label: classification.type === 'internal' ? classification.page : '',
			hint: 'Internal',
		},
		'ai-query': {
			icon: Sparkles,
			label: input.length > 60 ? `${input.slice(0, 60)}...` : input,
			hint: 'AI Chat',
		},
	}[classification.type]

	if (!config) return null
	const Icon = config.icon

	return (
		<div className="px-2 py-1.5">
			{classification.type !== 'ai-query' && (
				<p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold px-3 py-1.5">
					Results
				</p>
			)}
			<button
				type="button"
				onClick={onSelect}
				className={[
					'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left',
					selected ? 'bg-muted/80' : 'hover:bg-muted/50',
				].join(' ')}
			>
				<div
					className={[
						'size-7 rounded-md flex items-center justify-center shrink-0',
						classification.type === 'ai-query'
							? 'bg-gradient-to-br from-primary to-primary/60'
							: 'bg-muted',
					].join(' ')}
				>
					<Icon
						size={14}
						className={
							classification.type === 'ai-query'
								? 'text-primary-foreground'
								: 'text-muted-foreground'
						}
					/>
				</div>
				<span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
					{config.label}
				</span>
				<span className="text-[11px] text-muted-foreground shrink-0">
					{config.hint}
				</span>
			</button>
		</div>
	)
}
