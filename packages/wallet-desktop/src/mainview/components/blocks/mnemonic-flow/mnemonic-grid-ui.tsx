import { useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single word slot that can be read-only, editable, or a verification blank */
export type WordSlotMode = 'readonly' | 'editable' | 'blank'

/** Props for an individual word slot in the grid */
export interface WordSlotProps {
	/** 1-based position number */
	position: number
	/** The word to display (empty string for blanks) */
	word: string
	/** How the slot behaves */
	slotMode: WordSlotMode
	/** Called when the user changes a word (editable or blank mode) */
	onChange?: (value: string) => void
	/** Placeholder text for input fields */
	placeholder?: string
}

/** Props for the full mnemonic grid */
export interface MnemonicGridUiProps {
	/** The word list to render */
	words: string[]
	/** How many columns to show (default: 4) */
	columns?: 3 | 4
	/** Set of positions (0-indexed) that should be editable inputs */
	editablePositions?: Set<number>
	/** Set of positions (0-indexed) that are verification blanks */
	blankPositions?: Set<number>
	/** Called when a word changes (index, value) */
	onWordChange?: (index: number, value: string) => void
	/** Values for blank/verification positions keyed by index */
	blankValues?: Record<number, string>
	/** Called when a blank value changes (index, value) */
	onBlankChange?: (index: number, value: string) => void
	/** Additional CSS classes */
	className?: string
}

// ---------------------------------------------------------------------------
// Word Slot
// ---------------------------------------------------------------------------

function WordSlot({
	position,
	word,
	slotMode,
	onChange,
	placeholder,
}: WordSlotProps) {
	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			onChange?.(e.target.value)
		},
		[onChange],
	)

	return (
		<div
			className={cn(
				'flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2',
				slotMode === 'blank' && 'border-primary/50 bg-primary/5',
			)}
		>
			<span className="shrink-0 w-6 text-right text-xs font-mono text-muted-foreground">
				{position}.
			</span>
			{slotMode === 'readonly' ? (
				<span className="text-sm font-mono text-foreground select-all">
					{word}
				</span>
			) : (
				<Input
					type="text"
					value={slotMode === 'blank' ? undefined : word}
					defaultValue={slotMode === 'blank' ? '' : undefined}
					onChange={handleChange}
					className="h-auto border-0 bg-transparent p-0 text-sm font-mono shadow-none focus-visible:ring-0"
					placeholder={placeholder ?? `word ${position}`}
					autoComplete="off"
					spellCheck={false}
					autoCapitalize="none"
					aria-label={`Word ${position}`}
				/>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Mnemonic Grid
// ---------------------------------------------------------------------------

/**
 * A numbered grid of mnemonic seed words.
 *
 * Supports three slot modes:
 * - **readonly**: Displays the word as text (display/create modes)
 * - **editable**: Renders an input for the user to type a word (import mode)
 * - **blank**: Shows an empty input the user must fill in (verify mode)
 *
 * Pure presentation component — receives all data and callbacks via props.
 */
export function MnemonicGridUi({
	words,
	columns = 4,
	editablePositions,
	blankPositions,
	onWordChange,
	blankValues,
	onBlankChange,
	className,
}: MnemonicGridUiProps) {
	const gridCols = columns === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'

	return (
		<div className={cn('grid gap-2', gridCols, className)}>
			{words.map((word, index) => {
				const isBlank = blankPositions?.has(index) ?? false
				const isEditable = editablePositions?.has(index) ?? false

				let slotMode: WordSlotMode = 'readonly'
				if (isBlank) slotMode = 'blank'
				else if (isEditable) slotMode = 'editable'

				const displayWord = isBlank ? (blankValues?.[index] ?? '') : word

				const handleSlotChange = isBlank
					? (value: string) => onBlankChange?.(index, value)
					: isEditable
						? (value: string) => onWordChange?.(index, value)
						: undefined

				return (
					<WordSlot
						// Position is the stable identity for mnemonic grids
						key={index}
						position={index + 1}
						word={displayWord}
						slotMode={slotMode}
						onChange={handleSlotChange}
						placeholder={
							isBlank
								? `word ${index + 1}`
								: isEditable
									? `word ${index + 1}`
									: undefined
						}
					/>
				)
			})}
		</div>
	)
}
