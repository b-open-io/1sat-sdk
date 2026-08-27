import { Image as ImageIcon, Upload, X } from 'lucide-react'
import { type ChangeEvent, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Bsv21FormData {
	/** Token symbol (no spaces) */
	symbol: string
	/** Token icon file */
	icon: File | null
	/** Preview URL for the icon (created via URL.createObjectURL) */
	iconPreviewUrl: string | null
	/** Maximum token supply */
	maxSupply: string
	/** Decimal precision (default 8) */
	decimals: string
}

export interface Bsv21FormProps {
	/** Current form data */
	data: Bsv21FormData
	/** Callback when any field changes */
	onDataChange: (data: Bsv21FormData) => void
	/** Optional CSS class name */
	className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultBsv21Data(): Bsv21FormData {
	return {
		symbol: '',
		icon: null,
		iconPreviewUrl: null,
		maxSupply: '21000000',
		decimals: '8',
	}
}

export { createDefaultBsv21Data }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Form for deploying a new BSV21 token. Includes symbol input, icon upload
 * with live preview, max supply, and decimal precision.
 */
export function Bsv21Form({ data, onDataChange, className }: Bsv21FormProps) {
	const lastPreviewUrlRef = useRef<string | null>(null)

	// Track the current preview URL for unmount cleanup
	useEffect(() => {
		lastPreviewUrlRef.current = data.iconPreviewUrl
	}, [data.iconPreviewUrl])

	// Revoke object URL on unmount to prevent memory leaks
	useEffect(() => {
		return () => {
			if (lastPreviewUrlRef.current) {
				URL.revokeObjectURL(lastPreviewUrlRef.current)
			}
		}
	}, [])

	const updateField = useCallback(
		<K extends keyof Bsv21FormData>(field: K, value: Bsv21FormData[K]) => {
			onDataChange({ ...data, [field]: value })
		},
		[data, onDataChange],
	)

	const handleIconSelect = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => {
			const selectedFile = e.target.files?.[0]
			if (!selectedFile) return

			if (!selectedFile.type.startsWith('image/')) {
				return
			}

			// Revoke previous preview URL
			if (data.iconPreviewUrl) {
				URL.revokeObjectURL(data.iconPreviewUrl)
			}

			const previewUrl = URL.createObjectURL(selectedFile)
			onDataChange({
				...data,
				icon: selectedFile,
				iconPreviewUrl: previewUrl,
			})
		},
		[data, onDataChange],
	)

	const handleIconRemove = useCallback(() => {
		if (data.iconPreviewUrl) {
			URL.revokeObjectURL(data.iconPreviewUrl)
		}
		onDataChange({
			...data,
			icon: null,
			iconPreviewUrl: null,
		})
	}, [data, onDataChange])

	return (
		<div className={cn('flex flex-col gap-4', className)}>
			<p className="text-sm text-muted-foreground">
				Deploy a new BSV21 token with an icon. All tokens are minted to your
				wallet on deployment.
			</p>

			{/* Symbol */}
			<div className="grid gap-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="bsv21-symbol">Symbol</Label>
					<span className="text-xs text-muted-foreground">
						Does not need to be unique
					</span>
				</div>
				<Input
					id="bsv21-symbol"
					placeholder="e.g. MYTOKEN"
					value={data.symbol}
					maxLength={255}
					onKeyDown={(e) => {
						if (e.key === ' ') {
							e.preventDefault()
						}
					}}
					onChange={(e) =>
						updateField('symbol', e.target.value.replace(/\s/g, ''))
					}
				/>
			</div>

			{/* Icon upload */}
			<div className="grid gap-2">
				<div className="flex items-center justify-between">
					<Label>Token Icon</Label>
					<span className="text-xs text-muted-foreground">
						Square image recommended
					</span>
				</div>
				<div className="flex items-center gap-4">
					{data.iconPreviewUrl ? (
						<div className="relative size-20 flex-shrink-0 overflow-hidden rounded-lg border bg-muted">
							<img
								src={data.iconPreviewUrl}
								alt="Token icon preview"
								className="h-full w-full object-cover"
							/>
							<Button
								type="button"
								variant="destructive"
								size="icon"
								className="absolute right-1 top-1 size-6"
								onClick={handleIconRemove}
								aria-label="Remove icon"
							>
								<X data-icon="inline-start" />
							</Button>
						</div>
					) : (
						<div className="flex size-20 flex-shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/50">
							<ImageIcon className="size-8 text-muted-foreground/50" />
						</div>
					)}

					<div className="flex-1">
						<Label
							htmlFor="bsv21-icon-input"
							className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors hover:bg-muted/50"
						>
							<Upload className="size-4" />
							{data.icon ? 'Change Icon' : 'Select Image'}
						</Label>
						<input
							type="file"
							id="bsv21-icon-input"
							accept="image/*"
							className="sr-only"
							onChange={handleIconSelect}
						/>
					</div>
				</div>
			</div>

			{/* Max Supply */}
			<div className="grid gap-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="bsv21-max">Max Supply</Label>
					<span className="text-xs text-muted-foreground">Whole tokens</span>
				</div>
				<Input
					id="bsv21-max"
					type="text"
					inputMode="numeric"
					pattern="[0-9]*"
					placeholder="21000000"
					value={data.maxSupply}
					onChange={(e) =>
						updateField('maxSupply', e.target.value.replace(/[^0-9]/g, ''))
					}
				/>
			</div>

			{/* Decimals */}
			<div className="grid gap-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="bsv21-decimals">Decimal Precision</Label>
					<span className="text-xs text-muted-foreground">Default: 8</span>
				</div>
				<Input
					id="bsv21-decimals"
					type="text"
					inputMode="numeric"
					pattern="[0-9]*"
					min={0}
					max={18}
					placeholder="8"
					value={data.decimals}
					onChange={(e) =>
						updateField('decimals', e.target.value.replace(/[^0-9]/g, ''))
					}
				/>
			</div>

			{/* Info banner */}
			<Card className="bg-muted/50">
				<CardContent className="p-3 text-sm text-muted-foreground">
					BSV21 deployments are indexed immediately. A listing fee may be
					required before it appears in some marketplace interfaces.
				</CardContent>
			</Card>
		</div>
	)
}
