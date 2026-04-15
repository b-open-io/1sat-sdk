'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AlertCircle, Check, Loader2, Palette, RotateCcw } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { ThemeTokenStatus } from './use-theme-token'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Color swatch entry for the compact preview strip */
interface ColorSwatch {
	label: string
	variable: string
}

/** Props for the settings panel UI */
export interface ThemeTokenSettingsUiProps {
	/** Currently active theme origin, or null */
	origin: string | null
	/** Theme name from the fetched ThemeToken */
	themeName: string | null
	/** Current lifecycle status */
	status: ThemeTokenStatus
	/** Error message if status is "error" */
	errorMessage: string | null
	/** Callback to apply a theme by origin */
	onApply: (origin: string) => void
	/** Callback to clear the active theme */
	onClear: () => void
	/** Additional CSS classes */
	className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOR_SWATCHES: ColorSwatch[] = [
	{ label: 'Bg', variable: 'background' },
	{ label: 'Primary', variable: 'primary' },
	{ label: 'Secondary', variable: 'secondary' },
	{ label: 'Accent', variable: 'accent' },
	{ label: 'Muted', variable: 'muted' },
	{ label: 'Destructive', variable: 'destructive' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Compact inline settings row for selecting and applying on-chain themes.
 *
 * Intentionally minimal — no Card wrapper. Fits naturally inside a settings
 * section row alongside other content.
 */
export function ThemeTokenSettingsUi({
	origin,
	themeName,
	status,
	errorMessage,
	onApply,
	onClear,
	className,
}: ThemeTokenSettingsUiProps) {
	const [inputValue, setInputValue] = useState(origin ?? '')

	const handleApply = useCallback(() => {
		const trimmed = inputValue.trim()
		if (trimmed.length === 0) return
		onApply(trimmed)
	}, [inputValue, onApply])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Enter') handleApply()
		},
		[handleApply],
	)

	const isLoading = status === 'loading'
	const isApplied = status === 'applied'
	const isError = status === 'error'

	return (
		<div className={cn('space-y-3 w-full', className)}>
			{/* Origin input row */}
			<div className="flex items-center gap-2">
				<Input
					id="theme-origin"
					placeholder="txid_vout origin"
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={isLoading}
					className="h-8 text-xs font-[family-name:var(--font-mono)] flex-1"
					aria-label="Theme Token origin"
				/>
				<Button
					size="sm"
					variant="secondary"
					onClick={handleApply}
					disabled={isLoading || inputValue.trim().length === 0}
					aria-busy={isLoading}
					className="h-8 shrink-0"
				>
					{isLoading ? (
						<Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
					) : (
						<Palette className="size-3.5" aria-hidden="true" />
					)}
					<span className="ml-1.5">Apply</span>
				</Button>
				{isApplied && (
					<Button
						size="sm"
						variant="ghost"
						onClick={onClear}
						disabled={isLoading}
						className="h-8 shrink-0 text-muted-foreground hover:text-foreground"
						aria-label="Reset theme"
					>
						<RotateCcw className="size-3.5" aria-hidden="true" />
					</Button>
				)}
			</div>

			{/* Status + active theme name */}
			{isApplied && (
				<div className="flex items-center gap-2 flex-wrap">
					<Badge
						variant="secondary"
						className="gap-1.5 text-[11px] py-0.5 font-normal"
					>
						<Check
							className="size-3 text-primary shrink-0"
							aria-hidden="true"
						/>
						{themeName ?? 'Custom theme'}
					</Badge>
					{/* Compact color swatch dots */}
					<div
						className="flex items-center gap-1 ml-1"
						aria-label="Active colors"
					>
						{COLOR_SWATCHES.map((swatch) => (
							<div
								key={swatch.variable}
								className="size-3.5 rounded-full border border-border/50 shrink-0"
								style={{ backgroundColor: `var(--${swatch.variable})` }}
								title={swatch.label}
							/>
						))}
					</div>
				</div>
			)}

			{/* Error message */}
			{isError && (
				<div className="flex items-start gap-2 p-2 border border-destructive/40 bg-destructive/5 rounded-sm">
					<AlertCircle
						className="size-3.5 text-destructive mt-0.5 shrink-0"
						aria-hidden="true"
					/>
					<p className="text-xs text-destructive leading-relaxed">
						{errorMessage ?? 'Failed to apply theme'}
					</p>
				</div>
			)}
		</div>
	)
}
