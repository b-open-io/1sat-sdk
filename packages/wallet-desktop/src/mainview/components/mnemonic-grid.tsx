import { useCallback } from "react";

interface MnemonicGridProps {
	words: string[];
	editable?: boolean;
	onChange?: (words: string[]) => void;
}

export function MnemonicGrid({ words, editable, onChange }: MnemonicGridProps) {
	const handleWordChange = useCallback(
		(index: number, value: string) => {
			if (!onChange) return;
			const next = [...words];
			next[index] = value.trim().toLowerCase();
			onChange(next);
		},
		[words, onChange],
	);

	return (
		<div className="grid grid-cols-4 gap-2">
			{words.map((word, i) => (
				<div
					key={i}
					className="flex items-center gap-2 border border-border bg-muted/50 p-2"
				>
					<span className="text-xs font-mono text-muted-foreground w-5 text-right shrink-0">
						{i + 1}.
					</span>
					{editable ? (
						<input
							type="text"
							value={word}
							onChange={(e) => handleWordChange(i, e.target.value)}
							className="bg-transparent text-foreground text-sm font-mono w-full outline-none placeholder:text-muted-foreground/50"
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
	);
}
