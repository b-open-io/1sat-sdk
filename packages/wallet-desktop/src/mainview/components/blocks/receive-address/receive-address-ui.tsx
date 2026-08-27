import { AlertCircle, Check, Copy, QrCode, RefreshCw } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Visual variant for the receive address block */
export type ReceiveAddressVariant = 'default' | 'compact' | 'inline'

export interface ReceiveAddressUIProps {
	/** The deposit address to display */
	address: string | null
	/** Visual layout variant */
	variant?: ReceiveAddressVariant
	/** QR code pixel dimensions (default 200) */
	qrSize?: number
	/** Whether the address was just copied */
	copied: boolean
	/** Whether address rotation is in progress */
	isRotating: boolean
	/** Error from address rotation */
	rotateError: Error | null
	/** Whether a rotate callback is available */
	canRotate: boolean
	/** Custom QR code renderer — receives the address and returns a ReactNode */
	renderQr?: (address: string) => ReactNode
	/** Copy the current address */
	onCopy: () => void
	/** Rotate to a new address */
	onRotate: () => void
	/** Additional CSS classes */
	className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate a string for display: "abc123...xyz9" */
function truncate(value: string, startLen = 8, endLen = 6): string {
	if (value.length <= startLen + endLen + 3) return value
	return `${value.slice(0, startLen)}...${value.slice(-endLen)}`
}

/**
 * Generate a deterministic SVG pattern from an address hash.
 * This is a placeholder visualization — consumers should provide a real QR
 * renderer via the `renderQr` prop for production use.
 */
function AddressPattern({ address, size }: { address: string; size: number }) {
	const gridSize = 11
	const cellSize = size / (gridSize + 2) // +2 for quiet zone

	const cells = useMemo(() => {
		// Simple deterministic hash to generate a grid pattern
		const result: boolean[] = []
		for (let i = 0; i < gridSize * gridSize; i++) {
			const charCode = address.charCodeAt(i % address.length)
			const nextCharCode = address.charCodeAt((i + 1) % address.length)
			result.push((charCode * nextCharCode + i) % 3 !== 0)
		}

		// Mirror horizontally for QR-like symmetry
		for (let row = 0; row < gridSize; row++) {
			for (let col = 0; col < Math.floor(gridSize / 2); col++) {
				const mirrorCol = gridSize - 1 - col
				result[row * gridSize + mirrorCol] = result[row * gridSize + col]
			}
		}

		// Add finder patterns (top-left, top-right, bottom-left corners)
		const setFinder = (startRow: number, startCol: number) => {
			for (let r = 0; r < 3; r++) {
				for (let c = 0; c < 3; c++) {
					const idx = (startRow + r) * gridSize + (startCol + c)
					result[idx] = r === 0 || r === 2 || c === 0 || c === 2
				}
			}
			// Center cell
			result[(startRow + 1) * gridSize + (startCol + 1)] = true
		}
		setFinder(0, 0)
		setFinder(0, gridSize - 3)
		setFinder(gridSize - 3, 0)

		return result
	}, [address])

	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			role="img"
			aria-label={`QR placeholder for ${truncate(address)}`}
			className="rounded-md"
		>
			<rect width={size} height={size} fill="white" rx={4} />
			{cells.map((filled, i) => {
				if (!filled) return null
				const row = Math.floor(i / gridSize)
				const col = i % gridSize
				return (
					<rect
						key={i}
						x={cellSize + col * cellSize}
						y={cellSize + row * cellSize}
						width={cellSize}
						height={cellSize}
						fill="#000000"
					/>
				)
			})}
		</svg>
	)
}

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function QrSkeleton({ size }: { size: number }) {
	return (
		<Skeleton className="rounded-md" style={{ width: size, height: size }} />
	)
}

function AddressSkeleton() {
	return (
		<div className="flex items-center gap-2">
			<Skeleton className="h-5 flex-1" />
			<Skeleton className="size-8 rounded-md" />
		</div>
	)
}

// ---------------------------------------------------------------------------
// Variant: Default
// ---------------------------------------------------------------------------

function DefaultVariant({
	address,
	qrSize,
	copied,
	isRotating,
	rotateError,
	canRotate,
	renderQr,
	onCopy,
	onRotate,
	className,
}: ReceiveAddressUIProps) {
	if (!address) {
		return (
			<Card className={cn('w-full', className)}>
				<CardContent className="flex flex-col items-center gap-3 py-10">
					<div className="flex size-12 items-center justify-center rounded-full bg-muted">
						<QrCode
							className="size-6 text-muted-foreground"
							aria-hidden="true"
						/>
					</div>
					<div className="text-center">
						<p className="text-sm font-medium text-foreground">
							No address available
						</p>
						<p className="text-sm text-muted-foreground">
							Connect a wallet to generate a receive address
						</p>
					</div>
				</CardContent>
			</Card>
		)
	}

	const effectiveSize = qrSize ?? 200

	return (
		<Card className={cn('w-full', className)}>
			<CardHeader className="pb-2">
				<CardTitle className="text-base font-semibold">Receive</CardTitle>
			</CardHeader>

			<CardContent className="flex flex-col items-center gap-4">
				{/* QR code area */}
				<div className="flex items-center justify-center rounded-lg border border-border bg-background p-3">
					{renderQr ? (
						renderQr(address)
					) : (
						<AddressPattern address={address} size={effectiveSize} />
					)}
				</div>

				{/* Address with copy */}
				<div className="flex w-full items-center gap-2">
					<Badge
						variant="secondary"
						className="min-w-0 flex-1 justify-center truncate font-mono text-xs"
					>
						{truncate(address, 12, 8)}
					</Badge>
					<TooltipProvider delayDuration={200}>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="outline"
									size="icon"
									className="size-8 flex-shrink-0"
									onClick={onCopy}
									aria-label={copied ? 'Copied' : 'Copy address'}
								>
									{copied ? (
										<Check
											className="size-3.5 text-primary"
											data-icon
											aria-hidden="true"
										/>
									) : (
										<Copy className="size-3.5" data-icon aria-hidden="true" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>{copied ? 'Copied!' : 'Copy address'}</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</div>

				{/* Rotation error */}
				{rotateError && (
					<div className="flex w-full items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
						<AlertCircle
							className="size-4 flex-shrink-0 text-destructive"
							aria-hidden="true"
						/>
						<p className="text-sm text-destructive">{rotateError.message}</p>
					</div>
				)}
			</CardContent>

			{canRotate && (
				<CardFooter>
					<Button
						variant="outline"
						size="sm"
						className="w-full gap-1.5"
						onClick={onRotate}
						disabled={isRotating}
						aria-label="Generate new address"
					>
						<RefreshCw
							className={cn('size-4', isRotating && 'animate-spin')}
							data-icon
							aria-hidden="true"
						/>
						{isRotating ? 'Generating...' : 'New Address'}
					</Button>
				</CardFooter>
			)}
		</Card>
	)
}

// ---------------------------------------------------------------------------
// Variant: Compact
// ---------------------------------------------------------------------------

function CompactVariant({
	address,
	qrSize,
	copied,
	renderQr,
	onCopy,
	className,
}: ReceiveAddressUIProps) {
	const effectiveSize = qrSize ?? 120

	if (!address) {
		return <QrSkeleton size={effectiveSize} />
	}

	return (
		<div className={cn('flex flex-col items-center gap-2', className)}>
			<TooltipProvider delayDuration={200}>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={onCopy}
							className="cursor-pointer rounded-lg border border-border bg-background p-2 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-label={copied ? 'Copied' : 'Copy address'}
						>
							{renderQr ? (
								renderQr(address)
							) : (
								<AddressPattern address={address} size={effectiveSize} />
							)}
						</button>
					</TooltipTrigger>
					<TooltipContent>
						<p>{copied ? 'Copied!' : 'Tap to copy address'}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			{copied && (
				<Badge variant="secondary" className="gap-1 text-xs">
					<Check className="size-3" data-icon aria-hidden="true" />
					Copied
				</Badge>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Variant: Inline
// ---------------------------------------------------------------------------

function InlineVariant({
	address,
	copied,
	onCopy,
	className,
}: ReceiveAddressUIProps) {
	if (!address) {
		return <AddressSkeleton />
	}

	return (
		<div className={cn('flex items-center gap-2', className)}>
			<span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
				{truncate(address, 12, 8)}
			</span>
			<TooltipProvider delayDuration={200}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="size-8 flex-shrink-0"
							onClick={onCopy}
							aria-label={copied ? 'Copied' : 'Copy address'}
						>
							{copied ? (
								<Check
									className="size-3.5 text-primary"
									data-icon
									aria-hidden="true"
								/>
							) : (
								<Copy className="size-3.5" data-icon aria-hidden="true" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>{copied ? 'Copied!' : 'Copy address'}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Main UI
// ---------------------------------------------------------------------------

/**
 * Pure presentation component for the receive-address block.
 *
 * Displays a QR code (or deterministic placeholder) and the deposit address
 * with copy and optional rotation controls. Supports three variants:
 * - **default**: Card with QR + address + rotate button
 * - **compact**: Tappable QR only (smaller)
 * - **inline**: Address text with copy icon (no QR)
 *
 * All data and callbacks are provided via props. For a real QR code,
 * pass a `renderQr` function.
 */
export function ReceiveAddressUI(props: ReceiveAddressUIProps) {
	const variant = props.variant ?? 'default'

	switch (variant) {
		case 'compact':
			return <CompactVariant {...props} />
		case 'inline':
			return <InlineVariant {...props} />
		default:
			return <DefaultVariant {...props} />
	}
}
