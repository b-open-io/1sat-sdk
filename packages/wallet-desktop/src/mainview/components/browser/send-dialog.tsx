import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWallet } from '@/hooks/use-wallet'
import { cn } from '@/lib/utils'
import { Utils } from '@bsv/sdk'
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Loader2,
	SendHorizonal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SATS_PER_BSV = 100_000_000

// Fee tiers in sat/byte — amounts are approximate for a standard P2PKH tx
const FEE_TIERS = {
	economy: { label: 'Economy', sats: 15 },
	standard: { label: 'Standard', sats: 50 },
	priority: { label: 'Priority', sats: 120 },
} as const

type FeeTier = keyof typeof FEE_TIERS

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function satsToBsv(sats: number): string {
	return (sats / SATS_PER_BSV).toFixed(8)
}

function formatSats(sats: number): string {
	return sats.toLocaleString()
}

/** Validate a BSV address by decoding Base58Check and verifying the checksum. */
function isValidBsvAddress(address: string): boolean {
	try {
		const { prefix } = Utils.fromBase58Check(address)
		// Mainnet P2PKH = 0x00, P2SH = 0x05
		const byte = Array.isArray(prefix)
			? prefix[0]
			: (prefix as unknown as number)
		return byte === 0x00 || byte === 0x05
	} catch {
		return false
	}
}

const PAYMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidRecipient(value: string): boolean {
	const trimmed = value.trim()
	return isValidBsvAddress(trimmed) || PAYMAIL_RE.test(trimmed)
}

// ---------------------------------------------------------------------------
// Step types
// ---------------------------------------------------------------------------

type SendStep = 'input' | 'review' | 'broadcasting' | 'success' | 'error'

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FeeTierButton({
	tier,
	active,
	onClick,
	disabled,
}: {
	tier: FeeTier
	active: boolean
	onClick: () => void
	disabled?: boolean
}) {
	const { label, sats } = FEE_TIERS[tier]
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				'flex-1 border px-2 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
				// Sharp corners matching the zero-radius theme
				'first:rounded-l-none last:rounded-r-none',
				active
					? 'border-primary bg-primary/10 text-primary'
					: 'border-border bg-transparent text-muted-foreground hover:border-border/80 hover:text-foreground',
			)}
			aria-pressed={active}
		>
			<span className="block font-medium">{label}</span>
			<span className="block font-mono text-[10px] opacity-70">{sats}s</span>
		</button>
	)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface SendDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function SendDialog({ open, onOpenChange }: SendDialogProps) {
	const { sendBsv } = useWallet()

	// Form state
	const [recipient, setRecipient] = useState('')
	const [amountInput, setAmountInput] = useState('')
	const [feeTier, setFeeTier] = useState<FeeTier>('standard')
	const [step, setStep] = useState<SendStep>('input')
	const [txid, setTxid] = useState<string | null>(null)
	const [errorMsg, setErrorMsg] = useState<string | null>(null)

	// Reset on open
	useEffect(() => {
		if (open) {
			setRecipient('')
			setAmountInput('')
			setFeeTier('standard')
			setStep('input')
			setTxid(null)
			setErrorMsg(null)
		}
	}, [open])

	// Derived amounts
	const satoshis = useMemo(() => {
		const parsed = Number.parseInt(amountInput, 10)
		if (Number.isNaN(parsed) || parsed <= 0) return 0
		return parsed
	}, [amountInput])

	const feeSats = FEE_TIERS[feeTier].sats
	const totalSats = satoshis + feeSats

	// Validation
	const recipientValid = isValidRecipient(recipient)
	const amountValid = satoshis >= 1

	const canReview = recipientValid && amountValid

	// Input step handlers
	const handleAmountChange = useCallback((value: string) => {
		setAmountInput(value.replace(/\D/g, ''))
	}, [])

	const handleReview = useCallback(() => {
		if (!canReview) return
		setStep('review')
	}, [canReview])

	const handleBack = useCallback(() => {
		setStep('input')
	}, [])

	const handleSend = useCallback(async () => {
		setStep('broadcasting')
		setErrorMsg(null)
		try {
			const result = await sendBsv(recipient.trim(), satoshis)
			setTxid(result.txid)
			setStep('success')
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed to send BSV'
			setErrorMsg(msg)
			setStep('error')
		}
	}, [sendBsv, recipient, satoshis])

	const handleClose = useCallback(
		(nextOpen: boolean) => {
			if (step === 'broadcasting') return
			onOpenChange(nextOpen)
		},
		[step, onOpenChange],
	)

	// ---------------------------------------------------------------------------
	// Render helpers
	// ---------------------------------------------------------------------------

	function renderInput() {
		return (
			<>
				<div className="flex flex-col gap-4">
					{/* Recipient */}
					<div className="flex flex-col gap-1.5">
						<Label
							htmlFor="send-recipient"
							className="text-xs uppercase tracking-wider text-muted-foreground"
						>
							Recipient
						</Label>
						<Input
							id="send-recipient"
							type="text"
							placeholder="Address or paymail"
							value={recipient}
							onChange={(e) => setRecipient(e.target.value)}
							className="font-mono text-sm"
							autoComplete="off"
							spellCheck={false}
							aria-invalid={recipient.length > 0 && !recipientValid}
						/>
						{recipient.length > 0 && !recipientValid && (
							<p className="text-xs text-destructive">
								Enter a valid BSV address or paymail
							</p>
						)}
					</div>

					{/* Amount */}
					<div className="flex flex-col gap-1.5">
						<Label
							htmlFor="send-amount"
							className="text-xs uppercase tracking-wider text-muted-foreground"
						>
							Amount
						</Label>
						<div className="relative">
							<Input
								id="send-amount"
								type="text"
								inputMode="numeric"
								placeholder="0"
								value={amountInput}
								onChange={(e) => handleAmountChange(e.target.value)}
								className="pr-14 font-mono text-sm"
							/>
							<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
								sats
							</span>
						</div>
						{satoshis > 0 && (
							<p className="text-xs font-mono text-muted-foreground">
								{satsToBsv(satoshis)} BSV
							</p>
						)}
					</div>

					{/* Fee selector */}
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs uppercase tracking-wider text-muted-foreground">
							Network Fee
						</Label>
						<div className="flex">
							{(Object.keys(FEE_TIERS) as FeeTier[]).map((tier) => (
								<FeeTierButton
									key={tier}
									tier={tier}
									active={feeTier === tier}
									onClick={() => setFeeTier(tier)}
								/>
							))}
						</div>
					</div>

					{/* Total line */}
					{satoshis > 0 && (
						<div className="flex items-center justify-between border-t border-border pt-3">
							<span className="text-xs text-muted-foreground">
								Total (incl. fee)
							</span>
							<span className="font-mono text-sm font-medium">
								{formatSats(totalSats)} sats
							</span>
						</div>
					)}
				</div>

				{/* CTA */}
				<Button
					className="mt-6 w-full bg-primary text-primary-foreground hover:bg-primary/90"
					onClick={handleReview}
					disabled={!canReview}
				>
					Review
					<SendHorizonal className="ml-2 size-4" />
				</Button>
			</>
		)
	}

	function renderReview() {
		const rows: Array<{
			label: string
			value: string
			mono?: boolean
			bold?: boolean
		}> = [
			{ label: 'To', value: recipient.trim(), mono: true },
			{
				label: 'Amount',
				value: `${formatSats(satoshis)} sats (BSV)`,
				mono: true,
				bold: true,
			},
			{ label: 'Fee', value: `${feeSats} sats`, mono: true },
			{
				label: 'Total',
				value: `${formatSats(totalSats)} sats`,
				mono: true,
				bold: true,
			},
		]

		return (
			<>
				<div className="flex flex-col divide-y divide-border border border-border">
					{rows.map(({ label, value, mono, bold }) => (
						<div
							key={label}
							className="flex items-start justify-between gap-4 px-4 py-3"
						>
							<span className="shrink-0 text-xs text-muted-foreground">
								{label}
							</span>
							<span
								className={cn(
									'min-w-0 break-all text-right text-sm',
									mono && 'font-mono',
									bold && 'font-semibold text-foreground',
									!bold && 'text-muted-foreground',
								)}
							>
								{value}
							</span>
						</div>
					))}
				</div>

				<div className="mt-4 flex gap-2">
					<Button variant="outline" className="flex-1" onClick={handleBack}>
						<ArrowLeft className="size-4" />
						Back
					</Button>
					<Button
						className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
						onClick={handleSend}
					>
						Send
						<SendHorizonal className="ml-1 size-4" />
					</Button>
				</div>
			</>
		)
	}

	function renderBroadcasting() {
		return (
			<div className="flex flex-col items-center justify-center gap-4 py-8">
				<Loader2 className="size-8 animate-spin text-primary" />
				<div className="text-center">
					<p className="text-sm font-medium">Broadcasting transaction</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Signing and sending to the network...
					</p>
				</div>
			</div>
		)
	}

	function renderSuccess() {
		return (
			<div className="flex flex-col items-center gap-4 py-6">
				<div className="flex size-12 items-center justify-center border border-primary/30 bg-primary/10">
					<CheckCircle2 className="size-6 text-primary" />
				</div>
				<div className="text-center">
					<p className="text-sm font-semibold">Transaction sent</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{formatSats(satoshis)} sats to {recipient.slice(0, 12)}...
					</p>
				</div>
				{txid && (
					<div className="w-full border border-border p-3">
						<p className="mb-1 text-xs text-muted-foreground">Transaction ID</p>
						<p className="break-all font-mono text-xs text-foreground">
							{txid}
						</p>
					</div>
				)}
				<Button
					variant="outline"
					className="w-full"
					onClick={() => onOpenChange(false)}
				>
					Close
				</Button>
			</div>
		)
	}

	function renderError() {
		return (
			<div className="flex flex-col gap-4 py-4">
				<div className="flex items-start gap-3 border border-destructive/30 bg-destructive/5 p-4">
					<AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
					<div>
						<p className="text-sm font-medium text-destructive">Send failed</p>
						{errorMsg && (
							<p className="mt-1 text-xs text-muted-foreground">{errorMsg}</p>
						)}
					</div>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" className="flex-1" onClick={handleBack}>
						<ArrowLeft className="size-4" />
						Back
					</Button>
					<Button className="flex-1" onClick={handleSend}>
						Retry
					</Button>
				</div>
			</div>
		)
	}

	// ---------------------------------------------------------------------------
	// Title per step
	// ---------------------------------------------------------------------------

	const titleMap: Record<SendStep, string> = {
		input: 'Send BSV',
		review: 'Confirm Transaction',
		broadcasting: 'Sending...',
		success: 'Sent',
		error: 'Send Failed',
	}

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent
				className="sm:max-w-sm"
				showCloseButton={step !== 'broadcasting'}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-base">
						{step === 'review' && (
							<button
								type="button"
								onClick={handleBack}
								className="mr-1 opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								aria-label="Back to input"
							>
								<ArrowLeft className="size-4" />
							</button>
						)}
						{titleMap[step]}
					</DialogTitle>
					<DialogDescription className="sr-only">
						Send BSV to an address or paymail
					</DialogDescription>
				</DialogHeader>

				{step === 'input' && renderInput()}
				{step === 'review' && renderReview()}
				{step === 'broadcasting' && renderBroadcasting()}
				{step === 'success' && renderSuccess()}
				{step === 'error' && renderError()}
			</DialogContent>
		</Dialog>
	)
}
