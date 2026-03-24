import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ArrowLeft, Check, Copy, QrCode } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { rpc } from '../../rpc'

interface ReceiveViewProps {
	params?: Record<string, string>
	onNavigate?: (url: string) => void
}

/** Truncate a string to show leading and trailing characters with an ellipsis. */
function truncateMiddle(str: string, leading = 12, trailing = 10): string {
	if (str.length <= leading + trailing + 3) return str
	return `${str.slice(0, leading)}...${str.slice(-trailing)}`
}

export function ReceiveView({ onNavigate }: ReceiveViewProps) {
	const [address, setAddress] = useState<string | null>(null)
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const fetchedRef = useRef(false)
	const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>()

	// Clear copied timer on unmount
	useEffect(() => () => clearTimeout(copiedTimerRef.current), [])

	useEffect(() => {
		if (fetchedRef.current) return
		fetchedRef.current = true

		let cancelled = false

		rpc.request
			.getReceiveInfo(undefined)
			.then(async ({ address: addr }) => {
				if (cancelled) return
				setAddress(addr)
				const dataUrl = await QRCode.toDataURL(addr, {
					width: 256,
					margin: 1,
					color: { dark: '#000000', light: '#ffffff' },
				})
				if (!cancelled) setQrDataUrl(dataUrl)
			})
			.catch((err: unknown) => {
				if (cancelled) return
				setError(
					err instanceof Error ? err.message : 'Failed to load receive address',
				)
			})

		return () => {
			cancelled = true
		}
	}, [])

	function handleCopy() {
		if (!address) return
		navigator.clipboard.writeText(address).then(() => {
			clearTimeout(copiedTimerRef.current)
			setCopied(true)
			copiedTimerRef.current = setTimeout(() => setCopied(false), 1500)
		})
	}

	const loading = address === null && error === null

	return (
		<div className="flex flex-col items-center justify-start w-full min-h-full py-8 px-4">
			<div className="w-full max-w-sm">
				{/* Header */}
				<div className="flex items-center gap-3 mb-8">
					<button
						type="button"
						className="flex items-center justify-center size-8 text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => onNavigate?.('1sat://wallet/overview')}
						aria-label="Back"
					>
						<ArrowLeft size={18} />
					</button>
					<h1 className="text-[15px] font-semibold tracking-tight font-[family-name:var(--font-sans)]">
						Receive BSV
					</h1>
				</div>

				{/* Card */}
				<div className="border border-border p-6 space-y-6">
					{loading ? (
						<LoadingSkeleton />
					) : error !== null ? (
						<ErrorState message={error} />
					) : (
						<ReadyState
							address={address}
							qrDataUrl={qrDataUrl}
							copied={copied}
							onCopy={handleCopy}
						/>
					)}
				</div>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Sub-states
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
	return (
		<div className="flex flex-col items-center gap-5">
			<Skeleton className="size-64 rounded-none" />
			<div className="space-y-2 w-full">
				<Skeleton className="h-3 w-full rounded-none" />
				<Skeleton className="h-3 w-3/4 mx-auto rounded-none" />
			</div>
			<Skeleton className="h-9 w-full rounded-none" />
		</div>
	)
}

function ErrorState({ message }: { message: string }) {
	return (
		<div className="flex flex-col items-center gap-3 py-8">
			<QrCode size={48} className="text-muted-foreground" />
			<p className="text-[13px] text-destructive text-center font-[family-name:var(--font-sans)]">
				{message}
			</p>
		</div>
	)
}

interface ReadyStateProps {
	address: string | null
	qrDataUrl: string | null
	copied: boolean
	onCopy: () => void
}

function ReadyState({ address, qrDataUrl, copied, onCopy }: ReadyStateProps) {
	return (
		<>
			{/* QR Code */}
			<div className="flex justify-center">
				{qrDataUrl ? (
					<div className="border border-border p-3 bg-white">
						<img
							src={qrDataUrl}
							alt="QR code for receive address"
							width={232}
							height={232}
							style={{ imageRendering: 'pixelated', display: 'block' }}
						/>
					</div>
				) : (
					<Skeleton className="size-[256px] rounded-none" />
				)}
			</div>

			{/* Address row */}
			{address && (
				<div className="w-full border border-border bg-muted/40 px-3 py-2.5 flex items-center gap-2">
					<span
						className="flex-1 text-[12px] leading-none text-foreground select-all font-[family-name:var(--font-mono)] truncate"
						title={address}
					>
						{truncateMiddle(address, 14, 10)}
					</span>
					<button
						type="button"
						className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
						onClick={onCopy}
						aria-label="Copy address"
					>
						{copied ? (
							<Check size={14} className="text-emerald-500" />
						) : (
							<Copy size={14} />
						)}
					</button>
				</div>
			)}

			{/* Divider */}
			<div className="h-px bg-border" />

			{/* Copy button */}
			<button
				type="button"
				disabled={!address || copied}
				className={cn(
					'w-full flex items-center justify-center gap-2 px-4 py-2.5',
					'text-sm font-medium font-[family-name:var(--font-sans)]',
					'bg-primary text-primary-foreground',
					'hover:bg-primary/90 transition-colors',
					'disabled:opacity-50 disabled:cursor-not-allowed',
				)}
				onClick={onCopy}
			>
				{copied ? (
					<>
						<Check size={15} />
						Copied!
					</>
				) : (
					<>
						<Copy size={15} />
						Copy Address
					</>
				)}
			</button>

			{/* Address type note */}
			<p className="text-[11px] text-muted-foreground text-center leading-relaxed font-[family-name:var(--font-sans)]">
				BSV P2PKH address &mdash; compatible with all BSV wallets
			</p>
		</>
	)
}
