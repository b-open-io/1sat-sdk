import { useCallback } from "react"
import { AlertTriangle } from "lucide-react"
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SATS_PER_BSV = 100_000_000
const BSV_USD_ESTIMATE = 50

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function satsToBsv(sats: number): string {
	return (sats / SATS_PER_BSV).toFixed(8)
}

function satsToUsd(sats: number): string {
	const usd = (sats / SATS_PER_BSV) * BSV_USD_ESTIMATE
	if (usd < 0.01) return "< $0.01"
	return `≈ $${usd.toFixed(2)}`
}

function formatSats(sats: number): string {
	return sats.toLocaleString()
}

function truncateAddress(address: string): string {
	if (address.length <= 20) return address
	return `${address.slice(0, 10)}...${address.slice(-8)}`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
	/** Whether the dialog is open */
	open: boolean
	/** Callback when open state changes */
	onOpenChange: (open: boolean) => void
	/** Destination address or paymail */
	toAddress: string
	/** Amount in satoshis to send */
	amountSats: number
	/** Fee in satoshis */
	feeSats: number
	/** Called when user confirms the send */
	onConfirm: () => void
	/** Called when user cancels */
	onCancel: () => void
	/** Whether the confirm action is in progress */
	isLoading?: boolean
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

interface DetailRowProps {
	label: string
	value: string
	valueClassName?: string
	mono?: boolean
}

function DetailRow({ label, value, valueClassName, mono }: DetailRowProps) {
	return (
		<div className="flex items-start justify-between gap-4 px-4 py-3">
			<span className="shrink-0 text-xs text-muted-foreground">{label}</span>
			<span
				className={cn(
					"min-w-0 break-all text-right text-sm",
					mono ? "font-mono" : "",
					valueClassName,
				)}
			>
				{value}
			</span>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmDialog({
	open,
	onOpenChange,
	toAddress,
	amountSats,
	feeSats,
	onConfirm,
	onCancel,
	isLoading = false,
}: ConfirmDialogProps) {
	const totalSats = amountSats + feeSats
	const usdEstimate = satsToUsd(amountSats)

	const handleCancel = useCallback(() => {
		if (!isLoading) {
			onCancel()
		}
	}, [isLoading, onCancel])

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!isLoading) {
				onOpenChange(nextOpen)
			}
		},
		[isLoading, onOpenChange],
	)

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-sm" showCloseButton={!isLoading}>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-base">
						<AlertTriangle className="size-4 text-primary" aria-hidden="true" />
						Confirm Transaction
					</DialogTitle>
				</DialogHeader>

				<div className="divide-y divide-border border border-border">
					<DetailRow
						label="To"
						value={truncateAddress(toAddress)}
						mono
					/>
					<DetailRow
						label="Amount"
						value={`${formatSats(amountSats)} sats`}
						mono
						valueClassName="font-semibold text-foreground"
					/>
					<DetailRow
						label="Fee"
						value={`${formatSats(feeSats)} sats`}
						mono
						valueClassName="text-muted-foreground"
					/>
					<DetailRow
						label="Total"
						value={`${formatSats(totalSats)} sats`}
						mono
						valueClassName="font-semibold text-foreground"
					/>
					<DetailRow
						label="USD estimate"
						value={usdEstimate}
						valueClassName="text-muted-foreground"
					/>
				</div>

				<p className="text-xs text-muted-foreground">
					This action cannot be undone. Verify the address before sending.
				</p>

				<DialogFooter className="gap-2 sm:gap-2">
					<Button
						variant="outline"
						onClick={handleCancel}
						disabled={isLoading}
						className="flex-1"
					>
						Cancel
					</Button>
					<Button
						onClick={onConfirm}
						disabled={isLoading}
						aria-busy={isLoading}
						className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
					>
						{isLoading ? "Sending..." : "Send"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
