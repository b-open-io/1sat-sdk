import { cn } from '@/lib/utils'
import {
	AlertCircle,
	ArrowLeft,
	Check,
	Copy,
	ExternalLink,
	Send,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BalanceInfo } from '../../../shared/types'
import { onBalanceUpdated, rpc } from '../../rpc'
const MONO = 'font-[family-name:var(--font-mono)]'
const SANS = 'font-[family-name:var(--font-sans)]'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SAT_PER_BSV = 100_000_000
/**
 * Static placeholder rate — replace with a live price feed.
 * Keep in sync with dashboard/index.tsx BSV_USD_RATE.
 */
const BSV_USD_RATE = 50
function satsToBsv(sats: number): string {
	return (sats / SAT_PER_BSV).toFixed(8).replace(/\.?0+$/, '') || '0'
}
function formatUsd(sats: number): string {
	const usd = (sats / SAT_PER_BSV) * BSV_USD_RATE
	if (usd === 0) return '$0.00'
	if (usd < 0.01) return '< $0.01'
	return `$${usd.toFixed(2)}`
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
// Row component for the review card
// ---------------------------------------------------------------------------
interface ReviewRowProps {
	label: string
	value: string
	valueMono?: boolean
	valueClass?: string
	breakAll?: boolean
}
function ReviewRow({
	label,
	value,
	valueMono,
	valueClass,
	breakAll,
}: ReviewRowProps) {
	return (
		<div className="flex items-start justify-between gap-4">
			<span className="text-[11px] uppercase tracking-wider text-muted-foreground shrink-0 pt-0.5">
				{label}
			</span>
			<span
				className={`text-[13px] text-right${valueClass ? ` ${valueClass}` : ' text-foreground'}${breakAll ? ' break-all' : ''}`}
			>
				{value}
			</span>
		</div>
	)
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
	// Estimated network fee (placeholder — real fee comes from the wallet action result)
	const ESTIMATED_FEE_SATS = 200
	const totalSats = satoshis + ESTIMATED_FEE_SATS
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
	function handleSendAnother() {
		setAddress('')
		setAmountStr('')
		setTxid('')
		setPhase('form')
	}
	function handleViewTx() {
		onNavigate?.(`1sat://wallet/tx?txid=${txid}`)
	}
	async function handleCopyTxid() {
		try {
			await navigator.clipboard.writeText(txid)
			clearTimeout(copiedTimerRef.current)
			setCopied(true)
			copiedTimerRef.current = setTimeout(() => setCopied(false), 2000)
		} catch {
			// clipboard not available — copy button simply won't toggle
		}
	}
	// ---------------------------------------------------------------------------
	// Header helpers
	// ---------------------------------------------------------------------------
	function headerTitle(): string {
		switch (phase) {
			case 'review':
				return 'Confirm Send'
			case 'sending':
				return 'Sending...'
			case 'success':
				return 'Transaction Sent'
			case 'error':
				return 'Send Failed'
			default:
				return 'Send BSV'
		}
	}
	function handleBack() {
		if (phase === 'review') {
			setPhase('form')
		} else {
			onNavigate?.('1sat://wallet/overview')
		}
	}
	// ---------------------------------------------------------------------------
	// Layout shell
	// ---------------------------------------------------------------------------
	return (
		<div className="mx-auto w-full max-w-md px-4 py-8">
			{/* Header */}
			{phase !== 'success' && (
				<div className="flex items-center gap-3 mb-8">
					<button
						type="button"
						className="flex items-center justify-center size-8 hover:bg-muted transition-colors"
						style={{ borderRadius: 0 }}
						onClick={handleBack}
						aria-label={
							phase === 'review' ? 'Back to form' : 'Back to overview'
						}
					>
						<ArrowLeft size={16} />
					</button>
					<h1 className="text-[15px] font-semibold uppercase tracking-wider">
						{headerTitle()}
					</h1>
				</div>
			)}
			{/* Phase: form */}
			{phase === 'form' && (
				<div className="space-y-5">
					{/* To field */}
					<div className="space-y-1.5">
						<label
							htmlFor="send-address"
							className="text-[11px] uppercase tracking-wider text-muted-foreground"
						>
							To
						</label>
						<input
							id="send-address"
							type="text"
							value={address}
							onChange={(e) => setAddress(e.target.value)}
							placeholder="Enter BSV address or paymail..."
							className={cn(
								'w-full bg-muted border border-border px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors',
								MONO,
							)}
							style={{ borderRadius: 0 }}
							autoComplete="off"
							spellCheck={false}
						/>
					</div>
					{/* Amount field */}
					<div className="space-y-1.5">
						<label
							htmlFor="send-amount"
							className="text-[11px] uppercase tracking-wider text-muted-foreground"
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
								style={{ borderRadius: 0 }}
							/>
							<span className="px-3 text-[11px] uppercase tracking-wider text-muted-foreground select-none">
								sats
							</span>
						</div>
						{/* Available balance hint */}
						<p className="text-[11px] text-muted-foreground">
							Available: <span>{satsToBsv(balance.confirmed)} BSV</span> (
							{balance.confirmed.toLocaleString()} sats)
						</p>
					</div>
					{/* Review button */}
					<button
						type="button"
						disabled={!canReview}
						onClick={handleReview}
						className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
						style={{ borderRadius: 0 }}
					>
						<Send size={14} />
						Review
					</button>
				</div>
			)}
			{/* Phase: review / confirm */}
			{phase === 'review' && (
				<div className="space-y-6">
					{/* Review card */}
					<div className="border border-border divide-y divide-border">
						{/* Recipient */}
						<div className="px-4 py-3 space-y-1">
							<span className="text-[10px] uppercase tracking-wider text-muted-foreground">
								Recipient
							</span>
							<p className="text-[12px] text-foreground break-all leading-relaxed">
								{address.trim()}
							</p>
						</div>
						{/* Amount breakdown */}
						<div className="px-4 py-3 space-y-2.5">
							<ReviewRow
								label="Amount"
								value={`${satoshis.toLocaleString()} sats`}
								valueMono
							/>
							<ReviewRow
								label=""
								value={`${satsToBsv(satoshis)} BSV`}
								valueMono
								valueClass="text-muted-foreground text-[12px]"
							/>
							<ReviewRow
								label=""
								value={formatUsd(satoshis)}
								valueClass="text-muted-foreground text-[12px]"
							/>
						</div>
						{/* Fee row */}
						<div className="px-4 py-3">
							<ReviewRow
								label="Network fee"
								value={`~${ESTIMATED_FEE_SATS} sats`}
								valueMono
								valueClass="text-muted-foreground"
							/>
						</div>
						{/* Total row */}
						<div className="px-4 py-3 bg-muted/40">
							<div className="flex items-center justify-between">
								<span className="text-[11px] uppercase tracking-wider font-semibold">
									Total
								</span>
								<div className="text-right">
									<p className="text-[15px] font-bold leading-none">
										{totalSats.toLocaleString()} sats
									</p>
									<p className="text-[11px] text-muted-foreground mt-0.5">
										{satsToBsv(totalSats)} BSV &middot; {formatUsd(totalSats)}
									</p>
								</div>
							</div>
						</div>
					</div>
					{/* Warning */}
					<p className="text-[11px] text-muted-foreground text-center">
						This transaction cannot be reversed once broadcast.
					</p>
					{/* Actions */}
					<div className="space-y-2">
						<button
							type="button"
							onClick={handleConfirm}
							className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							style={{ borderRadius: 0 }}
						>
							<Check size={14} />
							Confirm Send
						</button>
						<button
							type="button"
							onClick={handleCancel}
							className="w-full px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-muted text-foreground hover:bg-muted/80 transition-colors"
							style={{ borderRadius: 0 }}
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
					<p className="text-[13px] text-muted-foreground">
						Broadcasting transaction...
					</p>
				</div>
			)}
			{/* Phase: success */}
			{phase === 'success' && (
				<div className="mx-auto w-full max-w-md px-4 py-8 space-y-8">
					{/* Icon + heading */}
					<div className="flex flex-col items-center space-y-4 pt-4">
						<div
							className="size-14 flex items-center justify-center border"
							style={{
								borderRadius: 0,
								borderColor: '#22c55e33',
								backgroundColor: '#22c55e10',
							}}
						>
							<Check size={24} style={{ color: '#22c55e' }} />
						</div>
						<h1 className="text-[20px] font-bold tracking-tight">
							Transaction Sent
						</h1>
						<p className="text-[13px] text-muted-foreground text-center">
							{satsToBsv(satoshis)} BSV &middot; {formatUsd(satoshis)}
						</p>
					</div>
					{/* TxID card */}
					<div className="border border-border p-4 space-y-2">
						<p className="text-[10px] uppercase tracking-wider text-muted-foreground">
							Transaction ID
						</p>
						<div className="flex items-center gap-2">
							<span className="flex-1 text-[12px] text-foreground truncate">
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
									<Check size={12} style={{ color: '#22c55e' }} />
								) : (
									<Copy size={12} className="text-muted-foreground" />
								)}
							</button>
						</div>
					</div>
					{/* Navigation actions */}
					<div className="space-y-2">
						<button
							type="button"
							onClick={handleViewTx}
							className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							style={{ borderRadius: 0 }}
						>
							<ExternalLink size={14} />
							View Transaction
						</button>
						<button
							type="button"
							onClick={handleSendAnother}
							className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-muted text-foreground hover:bg-muted/80 transition-colors"
							style={{ borderRadius: 0 }}
						>
							<Send size={14} />
							Send Another
						</button>
						<button
							type="button"
							onClick={handleDone}
							className="w-full px-4 py-3 text-[13px] text-muted-foreground hover:text-foreground uppercase tracking-wider transition-colors"
							style={{ borderRadius: 0 }}
						>
							Back to Wallet
						</button>
					</div>
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
						<p className="text-[15px] font-semibold">Transaction failed</p>
					</div>
					<div className="border border-destructive/30 bg-destructive/5 px-4 py-3">
						<p className="text-[13px] text-destructive">{errorMsg}</p>
					</div>
					<button
						type="button"
						onClick={handleTryAgain}
						className="w-full px-4 py-3 text-[13px] font-medium uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
						style={{ borderRadius: 0 }}
					>
						Try Again
					</button>
				</div>
			)}
		</div>
	)
}
