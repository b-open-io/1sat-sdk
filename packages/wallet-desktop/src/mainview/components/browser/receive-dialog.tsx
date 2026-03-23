import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import QRCode from "qrcode"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useWallet } from "@/hooks/use-wallet"

// ---------------------------------------------------------------------------
// QR canvas renderer
// ---------------------------------------------------------------------------

function QrCanvas({ address }: { address: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const el = canvasRef.current
		if (!el || !address) return

		QRCode.toCanvas(el, address, {
			width: 200,
			margin: 2,
			color: {
				// White modules on black — good contrast in dark UI
				dark: "#ffffff",
				light: "#000000",
			},
			errorCorrectionLevel: "M",
		}).catch(() => {
			// Non-fatal: canvas stays blank
		})
	}, [address])

	return (
		<div className="inline-flex border border-border bg-black p-3">
			<canvas ref={canvasRef} aria-label={`QR code for ${address}`} />
		</div>
	)
}

// ---------------------------------------------------------------------------
// Truncation helper
// ---------------------------------------------------------------------------

function truncateAddress(address: string): string {
	if (address.length <= 24) return address
	return `${address.slice(0, 12)}...${address.slice(-8)}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ReceiveDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function ReceiveDialog({ open, onOpenChange }: ReceiveDialogProps) {
	const { getReceiveInfo } = useWallet()

	const [address, setAddress] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Fetch address when dialog opens
	useEffect(() => {
		if (!open) return

		setAddress(null)
		setError(null)
		setCopied(false)
		setLoading(true)

		getReceiveInfo().then(
			(info) => {
				setAddress(info.address)
				setLoading(false)
			},
			(err) => {
				setError(err instanceof Error ? err.message : "Failed to get address")
				setLoading(false)
			},
		)
	}, [open, getReceiveInfo])

	// Clean up copy timeout on unmount
	useEffect(() => {
		return () => {
			if (copyTimeoutRef.current !== null) {
				clearTimeout(copyTimeoutRef.current)
			}
		}
	}, [])

	const handleCopy = useCallback(() => {
		if (!address) return

		navigator.clipboard.writeText(address).then(
			() => {
				setCopied(true)
				if (copyTimeoutRef.current !== null) {
					clearTimeout(copyTimeoutRef.current)
				}
				copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
			},
			() => {
				// Clipboard API unavailable — silently fail
			},
		)
	}, [address])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xs">
				<DialogHeader>
					<DialogTitle className="text-base">Receive BSV</DialogTitle>
					<DialogDescription className="sr-only">
						Your BSV receive address and QR code
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col items-center gap-5 py-2">
					{/* QR code area */}
					{loading && (
						<Skeleton className="size-[228px]" />
					)}

					{!loading && error && (
						<div className="flex h-[228px] w-full items-center justify-center border border-destructive/30 bg-destructive/5">
							<p className="text-sm text-destructive">{error}</p>
						</div>
					)}

					{!loading && !error && address && (
						<QrCanvas address={address} />
					)}

					{/* Address display */}
					{loading && (
						<Skeleton className="h-8 w-full" />
					)}

					{!loading && address && (
						<div className="w-full">
							<div className="flex items-center gap-2 border border-border bg-muted/30 px-3 py-2">
								<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
									{address}
								</span>
								<button
									type="button"
									onClick={handleCopy}
									className={cn(
										"shrink-0 p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										copied
											? "text-primary"
											: "text-muted-foreground hover:text-foreground",
									)}
									aria-label={copied ? "Address copied" : "Copy address"}
								>
									{copied ? (
										<Check className="size-3.5" aria-hidden="true" />
									) : (
										<Copy className="size-3.5" aria-hidden="true" />
									)}
								</button>
							</div>
						</div>
					)}

					{/* Copy button */}
					{!loading && address && (
						<Button
							className="w-full"
							onClick={handleCopy}
							aria-live="polite"
						>
							{copied ? (
								<>
									<Check className="size-4" aria-hidden="true" />
									Copied
								</>
							) : (
								<>
									<Copy className="size-4" aria-hidden="true" />
									Copy Address
								</>
							)}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
