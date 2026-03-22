import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface MetadataEntry {
	key: string
	value: string
}

interface MetadataEditorProps {
	entries: MetadataEntry[]
	onChange: (entries: MetadataEntry[]) => void
}

export type { MetadataEntry }

export function MetadataEditor({ entries, onChange }: MetadataEditorProps) {
	const updateEntry = (index: number, field: 'key' | 'value', val: string) => {
		const next = entries.map((e, i) =>
			i === index ? { ...e, [field]: val } : e,
		)
		onChange(next)
	}

	const removeEntry = (index: number) => {
		onChange(entries.filter((_, i) => i !== index))
	}

	const addEntry = () => {
		onChange([...entries, { key: '', value: '' }])
	}

	return (
		<div className="space-y-2">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
				Metadata (MAP)
			</div>
			{entries.map((entry, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: no stable id for metadata entries
				<div key={`meta-${i}`} className="flex items-center gap-2">
					<Input
						type="text"
						value={entry.key}
						onChange={(e) => updateEntry(i, 'key', e.target.value)}
						className="flex-1 text-xs"
						placeholder="key"
						spellCheck={false}
					/>
					<Input
						type="text"
						value={entry.value}
						onChange={(e) => updateEntry(i, 'value', e.target.value)}
						className="flex-1 text-xs"
						placeholder="value"
						spellCheck={false}
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => removeEntry(i)}
						className="flex-shrink-0 text-muted-foreground hover:text-destructive"
					>
						✕
					</Button>
				</div>
			))}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={addEntry}
				className="text-xs font-mono text-muted-foreground hover:text-foreground px-0"
			>
				+ Add Field
			</Button>
		</div>
	)
}
