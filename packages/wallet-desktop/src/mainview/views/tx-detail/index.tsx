import { cn } from '@/lib/utils'
import {
	ArrowLeft,
	ArrowRight,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	Copy,
	ExternalLink,
	Hash,
	Layers,
	ShieldCheck,
	Zap,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { STACK_URL } from '../../../shared/constants'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TxDetailViewProps {
	onNavigate?: (url: string) => void
	params?: Record<string, string>
}

interface TxInput {
	address?: string
	satoshis?: number
	outpoint?: string
}

interface TxOutput {
	address?: string
	satoshis?: number
	vout?: number
	isChange?: boolean
	spent?: boolean
}

interface TxData {
	txid: string
	timestamp?: string
	blockHeight?: number
	confirmations?: number
	fee?: number
	satoshis?: number
	inputs?: TxInput[]
	outputs?: TxOutput[]
	rawhex?: string
	[key: string]: unknown
}

interface ProofData {
	blockHeight?: number
	confirmations?: number
	fee?: number
	merkleRoot?: string
	timestamp?: string
	[key: string]: unknown
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSatoshis(satoshis: number): string {
	const bsv = Math.abs(satoshis) / 1e8
	return `${bsv.toFixed(8)} BSV`
}

function formatTimestamp(ts: string | number | undefined): string {
	if (!ts) return 'Unknown'
	const d = new Date(typeof ts === 'number' ? ts * 1000 : ts)
	if (Number.isNaN(d.getTime())) return 'Unknown'
	return d.toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function truncateAddress(addr: string): string {
	if (addr.length <= 20) return addr
	return `${addr.slice(0, 10)}…${addr.slice(-8)}`
}

function truncateTxid(txid: string): string {
	if (txid.length <= 20) return txid
	return `${txid.slice(0, 10)}…${txid.slice(-10)}`
}

// Normalise whatever the Stack API returns into our internal shape.
function normaliseTxData(raw: unknown): TxData | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>

	// Array of TXO records
	if (Array.isArray(raw)) {
		if (raw.length === 0) return null
		const first = raw[0] as Record<string, unknown>
		const txid =
			typeof first.txid === 'string' ? first.txid : String(first.txid ?? '')

		const outputs: TxOutput[] = (raw as Record<string, unknown>[]).map(
			(txo) => ({
				address: typeof txo.address === 'string' ? txo.address : undefined,
				satoshis:
					typeof txo.satoshis === 'number'
						? txo.satoshis
						: typeof txo.satoshis === 'string'
							? Number(txo.satoshis)
							: undefined,
				vout: typeof txo.vout === 'number' ? txo.vout : undefined,
				spent: txo.spend !== undefined && txo.spend !== null && txo.spend !== '',
			}),
		)

		const timestamp =
			typeof first.timestamp === 'string' || typeof first.timestamp === 'number'
				? String(first.timestamp)
				: undefined

		return { txid, outputs, timestamp }
	}

	// Object shape
	const txid =
		typeof r.txid === 'string'
			? r.txid
			: typeof r.tx_hash === 'string'
				? r.tx_hash
				: ''

	if (!txid) return null

	return {
		txid,
		timestamp:
			typeof r.timestamp === 'string' || typeof r.timestamp === 'number'
				? String(r.timestamp)
				: undefined,
		blockHeight:
			typeof r.block_height === 'number'
				? r.block_height
				: typeof r.blockHeight === 'number'
					? r.blockHeight
					: undefined,
		confirmations:
			typeof r.confirmations === 'number' ? r.confirmations : undefined,
		fee: typeof r.fee === 'number' ? r.fee : undefined,
		satoshis:
			typeof r.satoshis === 'number'
				? r.satoshis
				: typeof r.value === 'number'
					? r.value
					: undefined,
		inputs: Array.isArray(r.inputs)
			? (r.inputs as Record<string, unknown>[]).map((inp) => ({
					address: typeof inp.address === 'string' ? inp.address : undefined,
					satoshis:
						typeof inp.satoshis === 'number'
							? inp.satoshis
							: typeof inp.value === 'number'
								? inp.value
								: undefined,
					outpoint: typeof inp.outpoint === 'string' ? inp.outpoint : undefined,
				}))
			: undefined,
		outputs: Array.isArray(r.outputs)
			? (r.outputs as Record<string, unknown>[]).map((out, i) => ({
					address: typeof out.address === 'string' ? out.address : undefined,
					satoshis:
						typeof out.satoshis === 'number'
							? out.satoshis
							: typeof out.value === 'number'
								? out.value
								: undefined,
					vout: typeof out.vout === 'number' ? out.vout : i,
					spent:
						out.spend !== undefined &&
						out.spend !== null &&
						out.spend !== '',
				}))
			: undefined,
		rawhex: typeof r.rawhex === 'string' ? r.rawhex : undefined,
	}
}

function normaliseProofData(raw: unknown): ProofData | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
	const r = raw as Record<string, unknown>
	return {
		blockHeight:
			typeof r.block_height === 'number'
				? r.block_height
				: typeof r.blockHeight === 'number'
					? r.blockHeight
					: undefined,
		confirmations:
			typeof r.confirmations === 'number' ? r.confirmations : undefined,
		fee: typeof r.fee === 'number' ? r.fee : undefined,
		merkleRoot:
			typeof r.merkleRoot === 'string'
				? r.merkleRoot
				: typeof r.merkle_root === 'string'
					? r.merkle_root
					: undefined,
		timestamp:
			typeof r.timestamp === 'string' || typeof r.timestamp === 'number'
				? String(r.timestamp)
				: undefined,
	}
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkeletonLine({ w = 'w-full', h = 'h-3' }: { w?: string; h?: string }) {
	return <div className={cn('bg-muted animate-pulse', w, h)} />
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mb-3 font-[family-name:var(--font-sans)]">
			{children}
		</p>
	)
}

interface MetaRowProps {
	icon: React.ReactNode
	label: string
	value: string | number | undefined
	mono?: boolean
	truncate?: boolean
}

function MetaRow({ icon, label, value, mono, truncate }: MetaRowProps) {
	if (value === undefined || value === null) return null
	return (
		<div className="flex items-center justify-between py-2.5 border-b border-border last:border-0 gap-3">
			<div className="flex items-center gap-2 shrink-0">
				<span className="text-muted-foreground/60">{icon}</span>
				<span className="text-[11px] text-muted-foreground font-[family-name:var(--font-sans)]">
					{label}
				</span>
			</div>
			<span
				className={cn(
					'text-[12px] text-foreground text-right',
					mono && 'font-mono font-[family-name:var(--font-mono)]',
					truncate && 'truncate max-w-[160px]',
				)}
			>
				{String(value)}
			</span>
		</div>
	)
}

interface IoRowProps {
	index: number
	address?: string
	label?: string
	satoshis?: number
	spent?: boolean
	isOutput?: boolean
}

function IoRow({ index, address, label, satoshis, spent, isOutput }: IoRowProps) {
	const display = address ? truncateAddress(address) : (label ?? `#${index}`)
	return (
		<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50 last:border-0">
			<div className="flex items-center gap-2 min-w-0">
				<span className="text-[9px] text-muted-foreground/40 font-mono font-[family-name:var(--font-mono)] w-4 shrink-0 text-right">
					{index}
				</span>
				<span className="text-[11px] font-mono text-muted-foreground truncate font-[family-name:var(--font-mono)]">
					{display}
				</span>
			</div>
			<div className="flex items-center gap-2 shrink-0">
				{satoshis !== undefined && (
					<span className="text-[11px] font-mono text-foreground font-[family-name:var(--font-mono)]">
						{(satoshis / 1e8).toFixed(8)}
					</span>
				)}
				{isOutput && (
					<span
						className={cn(
							'text-[9px] px-1.5 py-0.5 font-[family-name:var(--font-sans)]',
							spent
								? 'text-muted-foreground/50 bg-muted'
								: 'text-green-500 bg-green-500/10',
						)}
					>
						{spent ? 'spent' : 'unspent'}
					</span>
				)}
			</div>
		</div>
	)
}

function LoadingSkeleton() {
	return (
		<div className="flex flex-col gap-5">
			{/* Header skeleton */}
			<div className="bg-card border border-border p-6 flex flex-col items-center gap-4">
				<SkeletonLine w="w-24" h="h-5" />
				<SkeletonLine w="w-48" h="h-8" />
				<SkeletonLine w="w-32" h="h-3" />
			</div>
			{/* I/O skeleton */}
			<div className="grid grid-cols-2 gap-3">
				<div className="bg-card border border-border p-4 flex flex-col gap-3">
					<SkeletonLine w="w-16" h="h-2.5" />
					<SkeletonLine h="h-3" />
					<SkeletonLine w="w-3/4" h="h-3" />
					<SkeletonLine w="w-5/6" h="h-3" />
				</div>
				<div className="bg-card border border-border p-4 flex flex-col gap-3">
					<SkeletonLine w="w-16" h="h-2.5" />
					<SkeletonLine h="h-3" />
					<SkeletonLine w="w-3/4" h="h-3" />
				</div>
			</div>
			{/* Details skeleton */}
			<div className="bg-card border border-border p-4 flex flex-col gap-3">
				<SkeletonLine w="w-20" h="h-2.5" />
				<SkeletonLine h="h-3" />
				<SkeletonLine h="h-3" />
				<SkeletonLine h="h-3" />
			</div>
		</div>
	)
}

// ─── TxDetailView ─────────────────────────────────────────────────────────────

export function TxDetailView({ onNavigate, params }: TxDetailViewProps) {
	const txid = params?.txid ?? ''

	const [txData, setTxData] = useState<TxData | null>(null)
	const [proofData, setProofData] = useState<ProofData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [hexExpanded, setHexExpanded] = useState(false)
	const [copiedItem, setCopiedItem] = useState<'txid' | 'hex' | null>(null)
	const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

	useEffect(() => () => clearTimeout(copyTimeoutRef.current), [])

	useEffect(() => {
		if (!txid) {
			setError('No transaction ID provided.')
			setLoading(false)
			return
		}

		let cancelled = false

		const fetchTx = fetch(`${STACK_URL}/1sat/txo/tx/${txid}`)
			.then((r) => {
				if (!r.ok) throw new Error(`Stack API error: ${r.status}`)
				return r.json()
			})
			.then((raw) => {
				if (cancelled) return
				const normalised = normaliseTxData(raw)
				if (!normalised) throw new Error('Unexpected response format from Stack API')
				setTxData(normalised)
			})

		const fetchProof = fetch(`${STACK_URL}/1sat/beef/${txid}/proof`)
			.then((r) => {
				if (!r.ok) return null
				return r.json()
			})
			.then((raw) => {
				if (cancelled) return
				if (raw) setProofData(normaliseProofData(raw))
			})
			.catch(() => {
				// proof is best-effort; unconfirmed txs won't have one
			})

		Promise.all([fetchTx, fetchProof])
			.catch((err) => {
				if (!cancelled)
					setError(err instanceof Error ? err.message : 'Failed to load transaction')
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [txid])

	const handleBack = useCallback(() => {
		onNavigate?.('1sat://wallet/history')
	}, [onNavigate])

	const handleCopyHex = useCallback(() => {
		const hex = txData?.rawhex
		if (!hex) return
		navigator.clipboard.writeText(hex).then(() => {
			clearTimeout(copyTimeoutRef.current)
			setCopiedItem('hex')
			copyTimeoutRef.current = setTimeout(() => setCopiedItem(null), 1500)
		})
	}, [txData?.rawhex])

	const handleCopyTxid = useCallback(() => {
		if (!txid) return
		navigator.clipboard.writeText(txid).then(() => {
			clearTimeout(copyTimeoutRef.current)
			setCopiedItem('txid')
			copyTimeoutRef.current = setTimeout(() => setCopiedItem(null), 1500)
		})
	}, [txid])

	// Derived values
	const isConfirmed =
		(proofData?.blockHeight !== undefined && proofData.blockHeight > 0) ||
		(proofData?.confirmations !== undefined && proofData.confirmations > 0) ||
		(txData?.blockHeight !== undefined && txData.blockHeight > 0)

	const timestamp = proofData?.timestamp ?? txData?.timestamp
	const blockHeight = proofData?.blockHeight ?? txData?.blockHeight
	const confirmations = proofData?.confirmations ?? txData?.confirmations
	const fee = proofData?.fee ?? txData?.fee
	const merkleRoot = proofData?.merkleRoot

	const inputs: TxInput[] = txData?.inputs ?? []
	const outputs: TxOutput[] = txData?.outputs ?? []

	const totalOut = outputs.reduce((sum, o) => sum + (o.satoshis ?? 0), 0)

	const explorerUrl = `https://whatsonchain.com/tx/${txid}`

	return (
		<div className="w-full h-full overflow-y-auto">
			<div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-5">

				{/* ── Back navigation ───────────────────────────────────────── */}
				<button
					type="button"
					onClick={handleBack}
					className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-fit -ml-0.5 font-[family-name:var(--font-sans)]"
				>
					<ArrowLeft size={13} strokeWidth={1.75} />
					Transaction History
				</button>

				{/* ── Page header ───────────────────────────────────────────── */}
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h1 className="text-[20px] font-bold text-foreground leading-none mb-2 font-[family-name:var(--font-sans)]">
							Transaction Detail
						</h1>
						{txid && (
							<div className="flex items-center gap-2">
								<span className="text-[11px] font-mono text-muted-foreground font-[family-name:var(--font-mono)]">
									{truncateTxid(txid)}
								</span>
								<button
									type="button"
									onClick={handleCopyTxid}
									className="text-muted-foreground hover:text-foreground transition-colors"
									title="Copy txid"
								>
									{copiedItem === 'txid' ? (
										<Check size={11} className="text-green-500" />
									) : (
										<Copy size={11} />
									)}
								</button>
								<a
									href={explorerUrl}
									target="_blank"
									rel="noreferrer"
									className="text-muted-foreground hover:text-foreground transition-colors"
									title="View on WhatsOnChain"
								>
									<ExternalLink size={11} />
								</a>
							</div>
						)}
					</div>
				</div>

				{/* ── Loading ───────────────────────────────────────────────── */}
				{loading ? (
					<LoadingSkeleton />
				) : error ? (
					/* ── Error ─────────────────────────────────────────────── */
					<div className="bg-card border border-border p-8 text-center flex flex-col items-center gap-4">
						<div className="w-10 h-10 bg-muted flex items-center justify-center">
							<Hash size={18} className="text-muted-foreground" />
						</div>
						<div>
							<p className="text-[13px] text-foreground font-medium mb-1 font-[family-name:var(--font-sans)]">
								Could not load transaction
							</p>
							<p className="text-[12px] text-muted-foreground font-[family-name:var(--font-sans)]">
								{error}
							</p>
						</div>
						<a
							href={explorerUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors font-[family-name:var(--font-sans)]"
						>
							<ExternalLink size={12} />
							View on WhatsOnChain
						</a>
					</div>
				) : (
					<>
						{/* ── Summary card ────────────────────────────────────── */}
						<div className="bg-card border border-border p-6">
							<div className="flex items-center justify-between mb-5">
								{/* Status badge */}
								<div
									className={cn(
										'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium font-[family-name:var(--font-sans)]',
										isConfirmed
											? 'text-green-500 bg-green-500/10'
											: 'text-yellow-500 bg-yellow-500/10',
									)}
								>
									{isConfirmed ? (
										<CheckCircle2 size={12} strokeWidth={2} />
									) : (
										<Clock size={12} strokeWidth={2} />
									)}
									{isConfirmed ? 'Confirmed' : 'Pending'}
								</div>

								{/* Timestamp */}
								{timestamp && (
									<span className="text-[11px] text-muted-foreground font-[family-name:var(--font-sans)]">
										{formatTimestamp(timestamp)}
									</span>
								)}
							</div>

							{/* Amount — show total output if no single satoshi value */}
							<div className="flex flex-col gap-0.5">
								{txData?.satoshis !== undefined ? (
									<>
										<p className="text-[11px] text-muted-foreground uppercase tracking-widest font-[family-name:var(--font-sans)]">
											{txData.satoshis >= 0 ? 'Received' : 'Sent'}
										</p>
										<p className="text-[28px] font-bold text-foreground leading-none font-[family-name:var(--font-mono)]">
											{formatSatoshis(txData.satoshis)}
										</p>
										<p className="text-[11px] text-muted-foreground font-[family-name:var(--font-mono)]">
											{Math.abs(txData.satoshis).toLocaleString()} sats
										</p>
									</>
								) : totalOut > 0 ? (
									<>
										<p className="text-[11px] text-muted-foreground uppercase tracking-widest font-[family-name:var(--font-sans)]">
											Total Output
										</p>
										<p className="text-[28px] font-bold text-foreground leading-none font-[family-name:var(--font-mono)]">
											{formatSatoshis(totalOut)}
										</p>
										<p className="text-[11px] text-muted-foreground font-[family-name:var(--font-mono)]">
											{totalOut.toLocaleString()} sats
										</p>
									</>
								) : null}
							</div>

							{/* Fee inline */}
							{fee !== undefined && (
								<div className="mt-4 pt-4 border-t border-border flex items-center gap-2">
									<Zap size={11} className="text-muted-foreground/60" />
									<span className="text-[11px] text-muted-foreground font-[family-name:var(--font-sans)]">
										Fee:
									</span>
									<span className="text-[11px] font-mono text-foreground font-[family-name:var(--font-mono)]">
										{fee} sats
									</span>
								</div>
							)}
						</div>

						{/* ── Inputs / Outputs ────────────────────────────────── */}
						<div className="grid grid-cols-2 gap-3">
							{/* Inputs */}
							<div className="bg-card border border-border p-4">
								<div className="flex items-center justify-between mb-3">
									<SectionLabel>Inputs</SectionLabel>
									<span className="text-[10px] text-muted-foreground font-[family-name:var(--font-sans)]">
										{inputs.length}
									</span>
								</div>
								{inputs.length === 0 ? (
									<div className="flex flex-col gap-2">
										<p className="text-[11px] text-muted-foreground font-[family-name:var(--font-sans)]">
											No input data available
										</p>
										<a
											href={explorerUrl}
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors font-[family-name:var(--font-sans)]"
										>
											<ExternalLink size={10} />
											View on explorer
										</a>
									</div>
								) : (
									inputs.map((inp, i) => (
										<IoRow
											key={`inp-${inp.outpoint ?? i}`}
											index={i}
											address={inp.address}
											label={inp.outpoint ? truncateTxid(inp.outpoint) : undefined}
											satoshis={inp.satoshis}
										/>
									))
								)}
							</div>

							{/* Arrow divider — sits between cols visually via flex trick on mobile */}
							<div className="hidden" />

							{/* Outputs */}
							<div className="bg-card border border-border p-4 col-start-2">
								<div className="flex items-center justify-between mb-3">
									<SectionLabel>Outputs</SectionLabel>
									<span className="text-[10px] text-muted-foreground font-[family-name:var(--font-sans)]">
										{outputs.length}
									</span>
								</div>
								{outputs.length === 0 ? (
									<div className="flex flex-col gap-2">
										<p className="text-[11px] text-muted-foreground font-[family-name:var(--font-sans)]">
											No output data available
										</p>
										<a
											href={explorerUrl}
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors font-[family-name:var(--font-sans)]"
										>
											<ExternalLink size={10} />
											View on explorer
										</a>
									</div>
								) : (
									outputs.map((out, i) => (
										<IoRow
											key={`out-${out.vout ?? i}`}
											index={out.vout ?? i}
											address={out.address}
											label={out.isChange ? 'Change' : undefined}
											satoshis={out.satoshis}
											spent={out.spent}
											isOutput
										/>
									))
								)}
							</div>
						</div>

						{/* Flow arrow — spans full width between the two panels */}
						<div className="flex items-center justify-center -mt-2 -mb-1 gap-3">
							<div className="h-px flex-1 bg-border" />
							<ArrowRight size={14} className="text-muted-foreground/40 shrink-0" strokeWidth={1.5} />
							<div className="h-px flex-1 bg-border" />
						</div>

						{/* ── Chain details ───────────────────────────────────── */}
						{(blockHeight !== undefined ||
							confirmations !== undefined ||
							merkleRoot !== undefined) && (
							<div className="bg-card border border-border p-4">
								<SectionLabel>
									<span className="flex items-center gap-1.5">
										<ShieldCheck size={10} />
										Chain Proof
									</span>
								</SectionLabel>
								<MetaRow
									icon={<Layers size={11} />}
									label="Block Height"
									value={blockHeight}
								/>
								<MetaRow
									icon={<CheckCircle2 size={11} />}
									label="Confirmations"
									value={confirmations}
								/>
								<MetaRow
									icon={<Hash size={11} />}
									label="Merkle Root"
									value={merkleRoot}
									mono
									truncate
								/>
							</div>
						)}

						{/* ── Full txid ───────────────────────────────────────── */}
						<div className="bg-card border border-border p-4">
							<SectionLabel>Transaction ID</SectionLabel>
							<div className="flex items-center justify-between gap-3">
								<span className="text-[11px] font-mono text-muted-foreground break-all font-[family-name:var(--font-mono)] leading-relaxed">
									{txid}
								</span>
								<button
									type="button"
									onClick={handleCopyTxid}
									className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
									title="Copy full txid"
								>
									{copiedItem === 'txid' ? (
										<Check size={13} className="text-green-500" />
									) : (
										<Copy size={13} />
									)}
								</button>
							</div>
						</div>

						{/* ── Raw hex — collapsible ───────────────────────────── */}
						{txData?.rawhex && (
							<div className="bg-card border border-border overflow-hidden">
								<button
									type="button"
									onClick={() => setHexExpanded((v) => !v)}
									className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
								>
									<span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest font-[family-name:var(--font-sans)]">
										Raw Hex
									</span>
									<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-[family-name:var(--font-sans)]">
										<span>{hexExpanded ? 'Hide' : 'Show'}</span>
										{hexExpanded ? (
											<ChevronUp size={12} strokeWidth={1.75} />
										) : (
											<ChevronDown size={12} strokeWidth={1.75} />
										)}
									</div>
								</button>

								{hexExpanded && (
									<div className="border-t border-border px-4 pb-4 pt-3">
										<div className="flex items-center justify-end mb-2.5">
											<button
												type="button"
												onClick={handleCopyHex}
												className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors font-[family-name:var(--font-sans)]"
											>
												{copiedItem === 'hex' ? (
													<>
														<Check size={11} className="text-green-500" />
														<span className="text-green-500">Copied</span>
													</>
												) : (
													<>
														<Copy size={11} />
														Copy
													</>
												)}
											</button>
										</div>
										<pre className="text-[10px] font-mono text-muted-foreground break-all whitespace-pre-wrap font-[family-name:var(--font-mono)] bg-muted/40 p-3 max-h-52 overflow-y-auto leading-relaxed">
											{txData.rawhex}
										</pre>
									</div>
								)}
							</div>
						)}

						{/* ── Explorer link ───────────────────────────────────── */}
						<div className="flex justify-center pb-2">
							<a
								href={explorerUrl}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors font-[family-name:var(--font-sans)]"
							>
								<ExternalLink size={11} />
								View on WhatsOnChain
							</a>
						</div>
					</>
				)}
			</div>
		</div>
	)
}
