import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { type VariantProps, cva } from 'class-variance-authority'
import {
	AlertCircle,
	CheckCircle2,
	ExternalLink,
	Loader2,
	ShoppingCart,
} from 'lucide-react'
import type { PurchaseOrdinalResult } from './use-buy-listing'

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

export const buyListingVariants = cva(
	'group overflow-hidden transition-shadow hover:shadow-lg',
	{
		variants: {
			size: {
				sm: 'max-w-[200px]',
				default: '',
				lg: 'max-w-[400px]',
			},
		},
		defaultVariants: {
			size: 'default',
		},
	},
)

const thumbnailVariants = cva('relative overflow-hidden bg-muted', {
	variants: {
		size: {
			sm: 'aspect-square',
			default: 'aspect-square',
			lg: 'aspect-[4/3]',
		},
	},
	defaultVariants: {
		size: 'default',
	},
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuyListingUIProps
	extends VariantProps<typeof buyListingVariants> {
	/** Optional CSS class name */
	className?: string
	/** Name of the ordinal */
	name?: string
	/** Seller display name or address */
	seller?: string
	/** Content type (MIME type) for the thumbnail */
	contentType?: string
	/** Price in satoshis */
	price: number
	/** Thumbnail URL */
	thumbnailUrl: string
	/** Whether the thumbnail image failed to load */
	imgError: boolean
	/** Handle thumbnail image error */
	onImgError: () => void
	/** Marketplace fee in satoshis */
	marketFee: number
	/** Total cost in satoshis */
	totalCost: number
	/** Whether a purchase is in progress */
	isPurchasing: boolean
	/** Purchase result */
	result: PurchaseOrdinalResult | null
	/** Error message */
	error: string | null
	/** Execute the purchase */
	onPurchase: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function satsToBsv(sats: number): string {
	return (sats / 100000000).toFixed(8)
}

function formatPrice(sats: number): string {
	if (sats >= 100000000) {
		return `${satsToBsv(sats)} BSV`
	}
	if (sats >= 1000000) {
		return `${(sats / 1000000).toFixed(2)}M sats`
	}
	if (sats >= 1000) {
		return `${(sats / 1000).toFixed(1)}K sats`
	}
	return `${sats.toLocaleString()} sats`
}

function truncateAddress(address: string, chars = 6): string {
	if (address.length <= chars * 2 + 3) return address
	return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BuyListingUI({
	size = 'default',
	className,
	name,
	seller,
	contentType,
	price,
	thumbnailUrl,
	imgError,
	onImgError,
	marketFee,
	totalCost,
	isPurchasing,
	result,
	error,
	onPurchase,
}: BuyListingUIProps) {
	return (
		<Card className={cn(buyListingVariants({ size }), className)}>
			{/* Thumbnail */}
			<div className={thumbnailVariants({ size })}>
				{!imgError ? (
					<img
						src={thumbnailUrl}
						alt={name ?? 'Ordinal listing'}
						className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
						onError={onImgError}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center">
						<div className="text-center text-muted-foreground">
							<ShoppingCart className="mx-auto size-8 opacity-30" />
							<p className="mt-2 text-xs">{contentType ?? 'Unknown type'}</p>
						</div>
					</div>
				)}

				{/* Price badge */}
				<Badge
					variant="secondary"
					className="absolute bottom-2 right-2 bg-background/90 backdrop-blur-sm"
				>
					{formatPrice(price)}
				</Badge>
			</div>

			<CardHeader className="p-4 pb-2">
				<div className="flex flex-col gap-1">
					<h3 className="truncate text-sm font-semibold leading-none">
						{name ?? 'Unnamed Ordinal'}
					</h3>
					{seller && (
						<p className="text-xs text-muted-foreground">
							Seller: {truncateAddress(seller)}
						</p>
					)}
				</div>
			</CardHeader>

			<CardContent className="flex flex-col gap-2 px-4 pb-2">
				{/* Cost breakdown */}
				<div className="flex flex-col gap-1 text-xs text-muted-foreground">
					<div className="flex justify-between">
						<span>Price</span>
						<span>{price.toLocaleString()} sats</span>
					</div>
					{marketFee > 0 && (
						<div className="flex justify-between">
							<span>Marketplace fee</span>
							<span>{marketFee.toLocaleString()} sats</span>
						</div>
					)}
					{marketFee > 0 && (
						<>
							<Separator />
							<div className="flex justify-between pt-1 font-medium text-foreground">
								<span>Total</span>
								<span>{totalCost.toLocaleString()} sats</span>
							</div>
						</>
					)}
				</div>

				{/* Success */}
				{result?.txid && (
					<div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-2">
						<CheckCircle2 className="mt-0.5 size-4 flex-shrink-0 text-primary" />
						<div className="min-w-0 flex-1">
							<p className="text-xs font-medium">Purchased</p>
							<a
								href={`https://whatsonchain.com/tx/${result.txid}`}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 text-[10px] transition-colors hover:text-foreground"
							>
								<Badge
									variant="outline"
									className="max-w-full truncate text-[10px] font-mono"
								>
									{result.txid}
								</Badge>
								<ExternalLink className="size-2.5 flex-shrink-0" />
							</a>
						</div>
					</div>
				)}

				{/* Error */}
				{error && (
					<div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-2">
						<AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
						<p className="text-xs text-muted-foreground">{error}</p>
					</div>
				)}
			</CardContent>

			<CardFooter className="p-4 pt-2">
				<Button
					className="w-full gap-2"
					onClick={onPurchase}
					disabled={isPurchasing || !!result?.txid}
					aria-busy={isPurchasing}
				>
					{isPurchasing ? (
						<>
							<Loader2 className="animate-spin" data-icon="inline-start" />
							Purchasing...
						</>
					) : result?.txid ? (
						<>
							<CheckCircle2 data-icon="inline-start" />
							Purchased
						</>
					) : (
						<>
							<ShoppingCart data-icon="inline-start" />
							Buy Now
						</>
					)}
				</Button>
			</CardFooter>
		</Card>
	)
}
