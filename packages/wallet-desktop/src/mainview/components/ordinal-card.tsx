import type { OrdinalInfo } from '../../shared/types'

interface OrdinalCardProps {
	ordinal: OrdinalInfo
	onClick: () => void
}

function extractTag(tags: string[], prefix: string): string | undefined {
	const tag = tags.find((t) => t.startsWith(`${prefix}:`))
	return tag ? tag.slice(prefix.length + 1) : undefined
}

export function OrdinalCard({ ordinal, onClick }: OrdinalCardProps) {
	const origin = extractTag(ordinal.tags, 'origin')
	const name = extractTag(ordinal.tags, 'name')
	const type = extractTag(ordinal.tags, 'type')

	const originForUrl = origin?.replace('.', '_')
	const imageUrl = originForUrl
		? `https://ordfs.network/content/${originForUrl}`
		: undefined

	const isImage = type?.startsWith('image/') ?? false

	return (
		<button
			type="button"
			onClick={onClick}
			className="border border-border bg-card overflow-hidden cursor-pointer text-left group relative hover:border-primary transition-colors"
		>
			<div className="aspect-square w-full bg-muted flex items-center justify-center overflow-hidden">
				{isImage && imageUrl ? (
					<img
						src={imageUrl}
						alt={name ?? 'Ordinal'}
						loading="lazy"
						className="w-full h-full object-cover"
					/>
				) : (
					<span className="text-xs font-mono text-muted-foreground px-2 text-center">
						{type ?? 'unknown'}
					</span>
				)}
			</div>
			{name && (
				<div className="px-2 py-1.5 text-xs text-foreground truncate">
					{name}
				</div>
			)}
			<div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
				<span className="text-xs font-mono text-white">
					{ordinal.satoshis.toLocaleString()} sats
				</span>
			</div>
		</button>
	)
}
