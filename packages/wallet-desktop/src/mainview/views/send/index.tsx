import { AlertCircle, ArrowLeft, Check, Copy, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BalanceInfo } from '../../../shared/types'
import { onBalanceUpdated, rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAT_PER_BSV = 100_000_000

function satsToBsv(sats: number): string {
	return (sats / SAT_PER_BSV).toFixed(8).replace(/\.?0+$/, '') || '0'
}

function truncateTxid(txid: string): string {
	if (txid.length <= 20) return txid
	return `${txid.slice(0, 10)}...${txid.slice(-10)}`
}

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

type Phase = 'form' | 'review' | 'sending' | 'success' | 'error'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SendViewProps {
	params?: Record<string, string>
	onNavigate?: (url: string) => void
}

// ---------------------------------------------------------------------------
// SendView
// ---------------------------------------------------------------------------

export function SendView({ params, onNavigate }: SendViewProps) {
	const [address, setAddress] = useState(params?.address ?? '')
	const [amountStr, setAmountStr] = useState(params?.amount ?? '')
	const [phase, setPhase] = useState<Phase>('form')
	const [txid, setTxid] = useState('')
	const [errorMsg, setErrorMsg] = useState('')
	const [copied, setCopied] = useState(false)
	const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>()

	// Clear copied timer on unmount
	useEffect(() => () => clearTimeout(copiedTimerRef.current), [])

	// Balance — fetch once on mount, then stay live via push events
	const [balance, setBalance] = useState<BalanceInfo>({
		confirmed: 0,
		unconfirmed: 0,
	})
	const balanceFetchedRef = useRef(false)

	useEffect(() => {
		if (!balanceFetchedRef.current) {
			balanceFetchedRef.current = true
			rpc.request
				.getBalance()
				.then((r) => setBalance(r))
				.catch(() => {
					// balance stays at zeros — not fatal for the send flow
				})
		}

		const unsub = onBalanceUpdated((payload) => setBalance(payload))
		return unsub
	}, [])

	// ---------------------------------------------------------------------------
	// Derived
	// ---------------------------------------------------------------------------

	const satoshis = Math.floor(Number(amountStr))
	const isValidAddress = address.trim().length > 0
	const isValidAmount = Number.isFinite(satoshis) && satoshis > 0
	const canReview = isValidAddress && isValidAmount

	// ---------------------------------------------------------------------------
	// Handlers
	// ---------------------------------------------------------------------------

	function handleReview() {
		if (!canReview) return
		setPhase('review')
	}

	function handleCancel() {
		setPhase('form')
	}

	async function handleConfirm() {
		setPhase('sending')
		try {
			const result = await rpc.request.sendBsv({
				address: address.trim(),
				amount: satoshis,
			})
			setTxid(result.txid)
			setPhase('success')
		} catch (err) {
			setErrorMsg(
				err instanceof Error
					? err.message
					: 'Transaction failed. Please try again.',
			)
			setPhase('error')
		}
	}

	function handleTryAgain() {
		setErrorMsg('')
		setPhase('form')
	}

	function handleDone() {
		onNavigate?.('1sat://wallet/overview')
	}

	async function handleCopyTxid() {
		try {
			await navigator.clipboard.writeText(txid)
			clearTimeout(copiedTimerRef.current)
			setCopied(true)
			copiedTimerRef.current = setTimeout(() => setCopied(false), 2000)
		} catch {
			// clipboard not available — silent fail, copy button simply won't toggle
		}
	}

	// ---------------------------------------------------------------------------
	// Layout shell
	// ---------------------------------------------------------------------------

	return (
		<div className="mx-auto w-full max-w-md px-4 py-8">
			{/* Header */}
			<div className="flex items-center gap-3 mb-8">
				<button
					type="button"
					className="flex items-center justify-center size-8 hover:bg-muted transition-colors"
					style={{ borderRadius: 0 }}
					onClick={() => onNavigate?.('1sat://wallet/overview')}
					aria-label="Back to overview"
				>
					<ArrowLeft size={16} />
				</button>
				<h1
					className="text-[15px] font-semibold uppercase tracking-wider"
					style={{ fontFamily: 'var(--font-sans)' }}
				>
					Send BSV
				</h1>
			</div>

			{/* Phase: form */}
			{phase === 'form' && (
				<div className="space-y-5">
					{/* To field */}
					<div className="space-y-1.5">
						<label
							htmlFor="send-address"
							className="text-[11px] uppercase tracking-wider text-muted-foreground"
							style={{ fontFamily: 'var(--font-sans)' }}
						>
							To
						</label>
						<input
							id="send-address"
							type="text"
							value={address}
							onChange={(e) => setAddress(e.target.value)}
							placeholder="Enter BSV address or paymail..."
							className="w-full bg-muted border border-border px-3 py-2.5 text-[13px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
							style={{ borderRadius: 0, fontFamily: 'var(--font-mono)' }}
							autoComplete="off"
							spellCheck={false}
						/>
					</div>

					{/* Amount field */}
					<div className="space-y-1.5">
						<label
							htmlFor="send-amount"
							className="text-[11px] uppercase tracking-wider text-muted-foreground"
							style={{ fontFamily: 'var(--font-sans)' }}
						>
							Amount
						</label>
						<div className="flex items-center border border-border bg-muted focus-within:border-primary transition-colors">
							<input
								id="send-amount"
								type="number"
								min="1"
								step="1"
								value={amountStr}
								onChange={(e) => setAmountStr(e.target.value)}
								placeholder="0"
								className="flex-1 bg-transparent px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
								style={{ borderRadius: 0, fontFamily: 'var(--font-mono)' }}
							/>
							<span
								className="px-3 text-[11px] uppercase tracking-wider text-muted-foreground select-none"
								style={{ fontFamily: 'var(--font-sans)' }}
							>
								sats
							</span>
						</div>

						{/* Available balance hint */}
						<p
							className="text-[11px] text-muted-foreground"
							style={{ fontFamily: 'var(--font-sans)' }}
						>
							Available:{' '}
							<span style={{ fontFamily: 'var(--font-mono)' }}>
								{satsToBsv(balance.confirmed)} BSV
							</span>{' '}
							({balance.confirmed.toLocaleString()} sats)
						</p>
					</div>

					{/* Review button */}
					<button
						type="button"
						disabled={!canReview}
						onClick={handleReview}
						className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
						style={{ borderRadius: 0, fontFamily: 'var(--font-sans)' }}
					>
						<Send size={14} />
						Review
					</button>
				</div>
			)}

			{/* Phase: review */}
			{phase === 'review' && (
				<div className="space-y-6">
					<div className="border border-border p-4 space-y-4">
						<p
							className="text-[11px] uppercase tracking-wider text-muted-foreground"
							style={{ fontFamily: 'var(--font-sans)' }}
						>
							Review Transaction
						</p>

						<div className="space-y-3">
							<div className="space-y-0.5">
								<span
									className="text-[10px] uppercase tracking-wider text-muted-foreground"
									style={{ fontFamily: 'var(--font-sans)' }}
								>
									To
								</span>
								<p
									className="text-[13px] text-foreground break-all"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									{address.trim()}
								</p>
							</div>

							<div className="h-px bg-border" />

							<div className="space-y-0.5">
								<span
									className="text-[10px] uppercase tracking-wider text-muted-foreground"
									style={{ fontFamily: 'var(--font-sans)' }}
								>
									Amount
								</span>
								<p
									className="text-[20px] font-bold leading-none"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									{satoshis.toLocaleString()} sats
								</p>
								<p
									className="text-[12px] text-muted-foreground"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									{satsToBsv(satoshis)} BSV
								</p>
							</div>
						</div>
					</div>

					<div className="space-y-2">
						<button
							type="button"
							onClick={handleConfirm}
							className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							style={{ borderRadius: 0, fontFamily: 'var(--font-sans)' }}
						>
							<Check size={14} />
							Confirm &amp; Send
						</button>
						<button
							type="button"
							onClick={handleCancel}
							className="w-full px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-muted text-foreground hover:bg-muted/80 transition-colors"
							style={{ borderRadius: 0, fontFamily: 'var(--font-sans)' }}
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Phase: sending */}
			{phase === 'sending' && (
				<div className="flex flex-col items-center justify-center py-12 space-y-4">
					<div
						className="size-8 border-2 border-primary border-t-transparent animate-spin"
						style={{ borderRadius: 0 }}
					/>
					<p
						className="text-[13px] text-muted-foreground"
						style={{ fontFamily: 'var(--font-sans)' }}
					>
						Broadcasting transaction...
					</p>
				</div>
			)}

			{/* Phase: success */}
			{phase === 'success' && (
				<div className="space-y-6">
					<div className="flex flex-col items-center py-8 space-y-3">
						<div
							className="size-12 flex items-center justify-center bg-green-500/10 border border-green-500/30"
							style={{ borderRadius: 0 }}
						>
							<Check size={22} className="text-green-400" />
						</div>
						<p
							className="text-[15px] font-semibold"
							style={{ fontFamily: 'var(--font-sans)' }}
						>
							Transaction sent
						</p>
					</div>

					<div className="border border-border p-4 space-y-2">
						<p
							className="text-[10px] uppercase tracking-wider text-muted-foreground"
							style={{ fontFamily: 'var(--font-sans)' }}
						>
							Transaction ID
						</p>
						<div className="flex items-center gap-2">
							<span
								className="flex-1 text-[12px] text-foreground truncate"
								style={{ fontFamily: 'var(--font-mono)' }}
							>
								{truncateTxid(txid)}
							</span>
							<button
								type="button"
								onClick={handleCopyTxid}
								className="flex items-center justify-center size-7 bg-muted hover:bg-muted/80 transition-colors shrink-0"
								style={{ borderRadius: 0 }}
								aria-label="Copy transaction ID"
							>
								{copied ? (
									<Check size={12} className="text-green-400" />
								) : (
									<Copy size={12} className="text-muted-foreground" />
								)}
							</button>
						</div>
					</div>

					<button
						type="button"
						onClick={handleDone}
						className="w-full px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-muted text-foreground hover:bg-muted/80 transition-colors"
						style={{ borderRadius: 0, fontFamily: 'var(--font-sans)' }}
					>
						Done
					</button>
				</div>
			)}

			{/* Phase: error */}
			{phase === 'error' && (
				<div className="space-y-6">
					<div className="flex flex-col items-center py-8 space-y-3">
						<div
							className="size-12 flex items-center justify-center bg-destructive/10 border border-destructive/30"
							style={{ borderRadius: 0 }}
						>
							<AlertCircle size={22} className="text-destructive" />
						</div>
						<p
							className="text-[15px] font-semibold"
							style={{ fontFamily: 'var(--font-sans)' }}
						>
							Transaction failed
						</p>
					</div>

					<div className="border border-destructive/30 bg-destructive/5 px-4 py-3">
						<p
							className="text-[13px] text-destructive"
							style={{ fontFamily: 'var(--font-sans)' }}
						>
							{errorMsg}
						</p>
					</div>

					<button
						type="button"
						onClick={handleTryAgain}
						className="w-full px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
						style={{ borderRadius: 0, fontFamily: 'var(--font-sans)' }}
					>
						Try Again
					</button>
				</div>
			)}
		</div>
	)
}
