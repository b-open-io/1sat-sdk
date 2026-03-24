import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Check, Copy, QrCode } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { rpc } from '../../rpc'

interface ReceiveViewProps {
	params?: Record<string, string>
	onNavigate?: (url: string) => void
}

export function ReceiveView({ onNavigate }: ReceiveViewProps) {
	const [address, setAddress] = useState<string | null>(null)
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const fetchedRef = useRef(false)

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
					width: 240,
					margin: 2,
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
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}

	const loading = address === null && error === null

	return (
		<div className="mx-auto w-full max-w-md py-8 px-4">
			{/* Header */}
			<div className="flex items-center gap-3 mb-8">
				<button
					type="button"
					className="flex items-center justify-center size-8 text-muted-foreground hover:text-foreground transition-colors"
					style={{ borderRadius: 0 }}
					onClick={() => onNavigate?.('1sat://wallet/overview')}
					aria-label="Back"
				>
					<ArrowLeft size={18} />
				</button>
				<h1
					className="text-[15px] font-semibold tracking-tight"
					style={{ fontFamily: 'var(--font-sans)' }}
				>
					Receive BSV
				</h1>
			</div>

			{/* Card */}
			<div className="border border-border p-6 space-y-6">
				{/* QR Code */}
				<div className="flex flex-col items-center gap-4">
					{loading ? (
						<>
							<Skeleton className="size-[240px]" style={{ borderRadius: 0 }} />
							<div className="space-y-2 w-full">
								<Skeleton className="h-3 w-full" />
								<Skeleton className="h-3 w-3/4 mx-auto" />
							</div>
						</>
					) : error !== null ? (
						<div className="flex flex-col items-center gap-3 py-8">
							<QrCode size={48} className="text-muted-foreground" />
							<p
								className="text-[13px] text-destructive text-center"
								style={{ fontFamily: 'var(--font-sans)' }}
							>
								{error}
							</p>
						</div>
					) : (
						<>
							{qrDataUrl ? (
								<img
									src={qrDataUrl}
									alt="QR code for receive address"
									width={240}
									height={240}
									style={{ imageRendering: 'pixelated', borderRadius: 0 }}
								/>
							) : (
								<Skeleton
									className="size-[240px]"
									style={{ borderRadius: 0 }}
								/>
							)}

							{/* Address box */}
							<div className="w-full border border-border bg-muted/40 px-3 py-2 flex items-center gap-2">
								<span
									className="flex-1 text-[11px] break-all leading-relaxed text-foreground select-all"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									{address}
								</span>
								<button
									type="button"
									className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
									style={{ borderRadius: 0 }}
									onClick={handleCopy}
									aria-label="Copy address"
								>
									{copied ? (
										<Check size={14} className="text-green-400" />
									) : (
										<Copy size={14} />
									)}
								</button>
							</div>
						</>
					)}
				</div>

				{/* Divider */}
				<div className="h-px bg-border" />

				{/* Copy button */}
				<button
					type="button"
					disabled={!address || copied}
					className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					style={{ borderRadius: 0, fontFamily: 'var(--font-sans)' }}
					onClick={handleCopy}
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
			</div>
		</div>
	)
}
