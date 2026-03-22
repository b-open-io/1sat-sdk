interface MetadataEntry {
	key: string;
	value: string;
}

interface MetadataEditorProps {
	entries: MetadataEntry[];
	onChange: (entries: MetadataEntry[]) => void;
}

export type { MetadataEntry };

export function MetadataEditor({ entries, onChange }: MetadataEditorProps) {
	const updateEntry = (
		index: number,
		field: "key" | "value",
		val: string,
	) => {
		const next = entries.map((e, i) =>
			i === index ? { ...e, [field]: val } : e,
		);
		onChange(next);
	};

	const removeEntry = (index: number) => {
		onChange(entries.filter((_, i) => i !== index));
	};

	const addEntry = () => {
		onChange([...entries, { key: "", value: "" }]);
	};

	return (
		<div className="space-y-2">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
				Metadata (MAP)
			</div>
			{entries.map((entry, i) => (
				<div key={`meta-${i}`} className="flex items-center gap-2">
					<input
						type="text"
						value={entry.key}
						onChange={(e) => updateEntry(i, "key", e.target.value)}
						className="flex-1 p-2 bg-muted border border-border text-foreground font-mono text-xs outline-none focus:border-primary"
						placeholder="key"
						spellCheck={false}
					/>
					<input
						type="text"
						value={entry.value}
						onChange={(e) => updateEntry(i, "value", e.target.value)}
						className="flex-1 p-2 bg-muted border border-border text-foreground font-mono text-xs outline-none focus:border-primary"
						placeholder="value"
						spellCheck={false}
					/>
					<button
						type="button"
						onClick={() => removeEntry(i)}
						className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
					>
						X
					</button>
				</div>
			))}
			<button
				type="button"
				onClick={addEntry}
				className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
			>
				+ Add Field
			</button>
		</div>
	);
}
