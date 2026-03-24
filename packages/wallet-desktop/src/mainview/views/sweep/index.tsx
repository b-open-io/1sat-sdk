import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	ArrowLeft,
	Check,
	Copy,
	Download,
	Loader2,
	ShieldCheck,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import type { SweepScanResult } from '../../../shared/types'
import { rpc } from '../../rpc'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4

interface SweepViewProps {
	onNavigate?: (url: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateTxid(txid: string): string {
	if (txid.length <= 16) return txid
	return `${txid.slice(0, 10)}…${txid.slice(-10)}`
}

function formatSats(sats: number): string {
	if (sats >= 100_000_000) {
		return `${(sats / 100_000_000).toFixed(8)} BSV`
	}
	return `${sats.toLocaleString()} sats`
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

const STEP_LABELS = ['Input', 'Scanning', 'Results', 'Done'] as const

function StepCircle({
	index,
	currentStep,
}: {
	index: number
	currentStep: Step
}) {
	const stepNumber = (index + 1) as Step
	const isCompleted = stepNumber < currentStep
	const isActive = stepNumber === currentStep

	return (
		<div className="flex flex-col items-center">
			<div
				className={[
					'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border transition-colors',
					isCompleted
						? 'bg-primary border-primary text-primary-foreground'
						: isActive
							? 'bg-primary border-primary text-primary-foreground'
							: 'bg-transparent border-border text-muted-foreground',
				].join(' ')}
			>
				{isCompleted ? (
					<Check className="size-4" strokeWidth={2.5} />
				) : (
					stepNumber
				)}
			</div>
			<span
				className={[
					'text-[9px] mt-1 text-center leading-tight',
					isActive ? 'text-foreground font-medium' : 'text-muted-foreground',
				].join(' ')}
			>
				{STEP_LABELS[index]}
			</span>
		</div>
	)
}

function VerticalStepper({ currentStep }: { currentStep: Step }) {
	return (
		<div className="w-20 border-r border-border flex flex-col items-center py-8 shrink-0">
			{STEP_LABELS.map((_, i) => (
				<div key={STEP_LABELS[i]} className="flex flex-col items-center">
					<StepCircle index={i} currentStep={currentStep} />
					{i < STEP_LABELS.length - 1 && (
						<div
							className={[
								'w-px flex-shrink-0 my-1 transition-colors',
								// segment height — 4 steps need 3 connectors
								'h-8',
								i + 1 < currentStep ? 'bg-primary' : 'bg-border',
							].join(' ')}
						/>
					)}
				</div>
			))}
		</div>
	)
}

// ─── Step 1: Input ────────────────────────────────────────────────────────────

function StepInput({
	onScanComplete,
}: {
	onScanComplete: (wif: string, result: SweepScanResult) => void
}) {
	const [wif, setWif] = useState('')
	const [error, setError] = useState('')
	const [scanning, setScanning] = useState(false)

	const handleScan = useCallback(async () => {
		const trimmed = wif.trim()
		if (!trimmed) {
			setError('Please enter a WIF-encoded private key.')
			return
		}
		setError('')
		setScanning(true)
		try {
			const result = await rpc.request.sweepScan({ wif: trimmed })
			onScanComplete(trimmed, result)
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Scan failed. Check the key and try again.',
			)
		} finally {
			setScanning(false)
		}
	}, [wif, onScanComplete])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Enter') handleScan()
		},
		[handleScan],
	)

	return (
		<div className="flex flex-col gap-6">
			<div>
				<div className="flex items-center gap-2 mb-1">
					<Download className="size-4 text-muted-foreground" />
					<h2 className="text-base font-semibold text-foreground">
						Import Private Key
					</h2>
				</div>
				<p className="text-sm text-muted-foreground">
					Paste a WIF-encoded private key to scan its address for BSV, ordinals,
					and tokens.
				</p>
			</div>

			<div className="space-y-3">
				<label
					htmlFor="wif-input"
					className="text-xs font-medium text-muted-foreground uppercase tracking-widest"
				>
					Private Key (WIF)
				</label>
				<Input
					id="wif-input"
					value={wif}
					onChange={(e) => setWif(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="L5K4..."
					className="font-mono text-sm"
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
					spellCheck={false}
					disabled={scanning}
				/>
				{error && <p className="text-xs text-destructive font-mono">{error}</p>}
			</div>

			<Button
				onClick={handleScan}
				disabled={scanning || !wif.trim()}
				className="w-full"
			>
				{scanning ? (
					<>
						<Loader2 className="size-4 mr-2 animate-spin" />
						Scanning…
					</>
				) : (
					<>
						<Download className="size-4 mr-2" />
						Scan for Assets
					</>
				)}
			</Button>
		</div>
	)
}

// ─── Step 2: Scanning ─────────────────────────────────────────────────────────

function StepScanning() {
	return (
		<div className="flex flex-col items-center justify-center h-48 gap-4">
			<div className="flex gap-1.5">
				{[0, 1, 2].map((i) => (
					<span
						key={i}
						className="w-2 h-2 rounded-full bg-primary animate-pulse"
						style={{ animationDelay: `${i * 150}ms` }}
					/>
				))}
			</div>
			<p className="text-sm text-muted-foreground">
				Scanning address for assets…
			</p>
		</div>
	)
}

// ─── Step 3: Results ──────────────────────────────────────────────────────────

function StepResults({
	scanResult,
	onSweep,
}: {
	scanResult: SweepScanResult
	onSweep: () => void
}) {
	const [sweepBsv, setSweepBsv] = useState(true)
	const [error, setError] = useState('')
	const [sweeping, setSweeping] = useState(false)

	const handleSweep = useCallback(async () => {
		setError('')
		setSweeping(true)
		try {
			await onSweep()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Sweep failed.')
			setSweeping(false)
		}
	}, [onSweep])

	const hasAnything =
		scanResult.totalSats > 0 ||
		scanResult.ordinals.length > 0 ||
		scanResult.tokens.length > 0

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h2 className="text-base font-semibold text-foreground mb-1">
					Assets Found
				</h2>
				<p className="text-sm text-muted-foreground">
					Select the assets you want to sweep into your wallet.
				</p>
			</div>

			{!hasAnything ? (
				<div className="rounded-md border border-border bg-muted/30 px-4 py-8 text-center">
					<p className="text-sm text-muted-foreground">
						No assets found at this address.
					</p>
				</div>
			) : (
				<div className="space-y-2">
					{/* BSV row */}
					{scanResult.totalSats > 0 && (
						<label className="flex items-center justify-between rounded-md border border-border px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors">
							<div className="flex items-center gap-3">
								<input
									type="checkbox"
									checked={sweepBsv}
									onChange={(e) => setSweepBsv(e.target.checked)}
									className="accent-primary w-4 h-4"
								/>
								<div>
									<p className="text-sm font-medium text-foreground">BSV</p>
									<p className="text-xs text-muted-foreground">
										{scanResult.funding.length}{' '}
										{scanResult.funding.length === 1 ? 'UTXO' : 'UTXOs'}
									</p>
								</div>
							</div>
							<span className="text-sm font-mono text-foreground">
								{formatSats(scanResult.totalSats)}
							</span>
						</label>
					)}

					{/* Ordinals row (future — display only) */}
					{scanResult.ordinals.length > 0 && (
						<div className="flex items-center justify-between rounded-md border border-border px-4 py-3 opacity-60">
							<div className="flex items-center gap-3">
								<input type="checkbox" disabled className="w-4 h-4" />
								<div>
									<p className="text-sm font-medium text-foreground">
										Ordinals
									</p>
									<p className="text-xs text-muted-foreground">
										{scanResult.ordinals.length} ordinal
										{scanResult.ordinals.length !== 1 ? 's' : ''} found
									</p>
								</div>
							</div>
							<span className="text-xs text-muted-foreground font-mono">
								Coming soon
							</span>
						</div>
					)}

					{/* Tokens row (future — display only) */}
					{scanResult.tokens.length > 0 && (
						<div className="flex items-center justify-between rounded-md border border-border px-4 py-3 opacity-60">
							<div className="flex items-center gap-3">
								<input type="checkbox" disabled className="w-4 h-4" />
								<div>
									<p className="text-sm font-medium text-foreground">Tokens</p>
									<p className="text-xs text-muted-foreground">
										{scanResult.tokens.length} token type
										{scanResult.tokens.length !== 1 ? 's' : ''} found
									</p>
								</div>
							</div>
							<span className="text-xs text-muted-foreground font-mono">
								Coming soon
							</span>
						</div>
					)}
				</div>
			)}

			{error && <p className="text-xs text-destructive font-mono">{error}</p>}

			<Button
				onClick={handleSweep}
				disabled={sweeping || !sweepBsv || scanResult.totalSats === 0}
				className="w-full"
			>
				{sweeping ? (
					<>
						<Loader2 className="size-4 mr-2 animate-spin" />
						Sweeping…
					</>
				) : (
					'Sweep Selected'
				)}
			</Button>
		</div>
	)
}

// ─── Step 4: Success ──────────────────────────────────────────────────────────

function StepSuccess({
	txid,
	onViewHistory,
	onSweepAnother,
}: {
	txid: string
	onViewHistory: () => void
	onSweepAnother: () => void
}) {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(txid).catch(() => {})
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [txid])

	return (
		<div className="flex flex-col items-center gap-6 py-4">
			{/* Checkmark */}
			<div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
				<ShieldCheck className="size-8 text-green-500" strokeWidth={1.5} />
			</div>

			<div className="text-center">
				<h2 className="text-base font-semibold text-foreground">
					Sweep Complete
				</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Assets have been swept into your wallet.
				</p>
			</div>

			{/* TxID */}
			<div className="w-full rounded-md border border-border bg-muted/30 px-4 py-3">
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
					Transaction ID
				</p>
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs font-mono text-foreground truncate">
						{truncateTxid(txid)}
					</span>
					<button
						type="button"
						onClick={handleCopy}
						className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
						aria-label="Copy txid"
					>
						{copied ? (
							<Check className="size-3.5 text-green-500" />
						) : (
							<Copy className="size-3.5" />
						)}
					</button>
				</div>
			</div>

			<div className="flex flex-col gap-2 w-full">
				<button
					type="button"
					onClick={onViewHistory}
					className="text-sm text-primary hover:underline text-center"
				>
					View in History
				</button>

				<Button variant="secondary" onClick={onSweepAnother} className="w-full">
					<ArrowLeft className="size-4 mr-2" />
					Sweep Another
				</Button>
			</div>
		</div>
	)
}

// ─── Main SweepView ───────────────────────────────────────────────────────────

export function SweepView({ onNavigate }: SweepViewProps) {
	const [step, setStep] = useState<Step>(1)
	const [pendingWif, setPendingWif] = useState('')
	const [scanResult, setScanResult] = useState<SweepScanResult | null>(null)
	const [sweepTxid, setSweepTxid] = useState('')

	const handleScanComplete = useCallback(
		(wif: string, result: SweepScanResult) => {
			setPendingWif(wif)
			setScanResult(result)
			setStep(3)
		},
		[],
	)

	const handleSweep = useCallback(async () => {
		if (!pendingWif || !scanResult) {
			throw new Error('Scan data missing. Please re-scan.')
		}
		const result = await rpc.request.sweepBsv({
			wif: pendingWif,
			assets: scanResult,
		})
		if (result.error) {
			throw new Error(result.error)
		}
		setSweepTxid(result.txid ?? '')
		setStep(4)
	}, [pendingWif, scanResult])

	const handleReset = useCallback(() => {
		setPendingWif('')
		setScanResult(null)
		setSweepTxid('')
		setStep(1)
	}, [])

	const handleViewHistory = useCallback(() => {
		onNavigate?.('1sat://wallet/history')
	}, [onNavigate])

	return (
		<div className="w-full min-h-full flex items-start justify-center py-10 px-4">
			<div className="w-full max-w-2xl bg-card border border-border rounded-lg overflow-hidden">
				{/* Header */}
				<div className="px-6 py-4 border-b border-border">
					<h1 className="text-lg font-bold text-foreground">Sweep / Import</h1>
					<p className="text-xs text-muted-foreground mt-0.5">
						Move assets from an external private key into your wallet
					</p>
				</div>

				{/* Body: stepper + content */}
				<div className="flex min-h-[340px]">
					<VerticalStepper currentStep={step} />

					<div className="flex-1 p-6 overflow-y-auto">
						{step === 1 && <StepInput onScanComplete={handleScanComplete} />}
						{step === 2 && <StepScanning />}
						{step === 3 && scanResult && (
							<StepResults scanResult={scanResult} onSweep={handleSweep} />
						)}
						{step === 4 && (
							<StepSuccess
								txid={sweepTxid}
								onViewHistory={handleViewHistory}
								onSweepAnother={handleReset}
							/>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
