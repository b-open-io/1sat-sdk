import { Input } from '@/components/ui/input'
import { useCallback } from 'react'

interface MnemonicGridProps {
	words: string[]
	editable?: boolean
	onChange?: (words: string[]) => void
}

export function MnemonicGrid({ words, editable, onChange }: MnemonicGridProps) {
	const handleWordChange = useCallback(
		(index: number, value: string) => {
			if (!onChange) return
			const next = [...words]
			next[index] = value.trim().toLowerCase()
			onChange(next)
		},
		[words, onChange],
	)

	return (
		<div className="grid grid-cols-4 gap-2">
			{words.map((word, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: word position is its stable identity
					key={i}
					className="flex items-center gap-2 border border-border bg-muted/50 p-2"
				>
					<span className="text-xs font-mono text-muted-foreground w-5 text-right shrink-0">
						{i + 1}.
					</span>
					{editable ? (
						<Input
							type="text"
							value={word}
							onChange={(e) => handleWordChange(i, e.target.value)}
							className="bg-transparent border-0 p-0 h-auto text-sm outline-none placeholder:text-muted-foreground/50 focus:border-0"
							placeholder={`word ${i + 1}`}
							autoComplete="off"
							spellCheck={false}
						/>
					) : (
						<span className="text-sm font-mono text-foreground select-all">
							{word}
						</span>
					)}
				</div>
			))}
		</div>
	)
}
