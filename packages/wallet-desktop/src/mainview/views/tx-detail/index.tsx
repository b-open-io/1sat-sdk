import {
	ArrowLeft,
	ArrowRight,
	CheckCircle,
	Clock,
	Copy,
	ExternalLink,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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
	// Stack API may return varied field names
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
// The Stack API for /1sat/txo/tx/:txid returns TXO records; we extract
// what we can and leave the rest undefined.
function normaliseTxData(raw: unknown): TxData | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>

	// The endpoint returns an array of TXO records for the tx
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

interface DetailRowProps {
	label: string
	value: string | number | undefined
	mono?: boolean
}

function DetailRow({ label, value, mono }: DetailRowProps) {
	if (value === undefined || value === null) return null
	return (
		<div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
			<span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
				{label}
			</span>
			<span
				className={[
					'text-[12px] text-foreground',
					mono ? 'font-mono font-[family-name:var(--font-mono)]' : '',
				].join(' ')}
			>
				{String(value)}
			</span>
		</div>
	)
}

interface IoCardProps {
	title: string
	items: Array<{ address?: string; satoshis?: number; label?: string }>
	txid: string
}

function IoCard({ title, items, txid }: IoCardProps) {
	const explorerUrl = `https://whatsonchain.com/tx/${txid}`

	if (items.length === 0) {
		return (
			<div className="flex-1 bg-card rounded-lg p-4 border border-border">
				<p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
					{title}
				</p>
				<div className="flex flex-col gap-1">
					<p className="text-[11px] text-muted-foreground">No data available</p>
					<a
						href={explorerUrl}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-400 transition-colors mt-1"
					>
						<ExternalLink size={10} />
						View on Explorer
					</a>
				</div>
			</div>
		)
	}

	return (
		<div className="flex-1 bg-card rounded-lg p-4 border border-border min-w-0">
			<p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
				{title}
			</p>
			<div className="flex flex-col gap-2">
				{items.map((item, i) => (
					<div
						key={`${item.address ?? item.label ?? ''}-${i}`}
						className="flex items-center justify-between gap-2 min-w-0"
					>
						<span className="text-[10px] font-mono text-muted-foreground truncate font-[family-name:var(--font-mono)]">
							{item.address
								? truncateAddress(item.address)
								: (item.label ?? 'Unknown')}
						</span>
						{item.satoshis !== undefined && (
							<span className="text-[10px] font-mono text-foreground shrink-0 font-[family-name:var(--font-mono)]">
								{(item.satoshis / 1e8).toFixed(8)}
							</span>
						)}
					</div>
				))}
			</div>
		</div>
	)
}

function SkeletonBlock({ h = 'h-24' }: { h?: string }) {
	return <div className={`${h} bg-muted animate-pulse rounded-lg`} />
}

// ─── TxDetailView ─────────────────────────────────────────────────────────────

export function TxDetailView({ onNavigate, params }: TxDetailViewProps) {
	const txid = params?.txid ?? ''

	const [txData, setTxData] = useState<TxData | null>(null)
	const [proofData, setProofData] = useState<ProofData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [hexExpanded, setHexExpanded] = useState(false)
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (!txid) {
			setError('No transaction ID provided.')
			setLoading(false)
			return
		}

		let cancelled = false

		const fetchTx = fetch(`http://127.0.0.1:8080/1sat/txo/tx/${txid}`)
			.then((r) => {
				if (!r.ok) throw new Error(`Stack API error: ${r.status}`)
				return r.json()
			})
			.then((raw) => {
				if (cancelled) return
				const normalised = normaliseTxData(raw)
				if (!normalised)
					throw new Error('Unexpected response format from Stack API')
				setTxData(normalised)
			})

		const fetchProof = fetch(`http://127.0.0.1:8080/1sat/beef/${txid}/proof`)
			.then((r) => {
				if (!r.ok) return null // proof may not exist for unconfirmed tx
				return r.json()
			})
			.then((raw) => {
				if (cancelled) return
				if (raw) setProofData(normaliseProofData(raw))
			})
			.catch(() => {
				// proof fetch is best-effort
			})

		Promise.all([fetchTx, fetchProof])
			.catch((err) => {
				if (!cancelled)
					setError(
						err instanceof Error ? err.message : 'Failed to load transaction',
					)
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
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [txData?.rawhex])

	const handleCopyTxid = useCallback(() => {
		if (!txid) return
		navigator.clipboard.writeText(txid).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [txid])

	// Derive confirmed status
	const isConfirmed =
		(proofData?.blockHeight !== undefined && proofData.blockHeight > 0) ||
		(proofData?.confirmations !== undefined && proofData.confirmations > 0) ||
		(txData?.blockHeight !== undefined && txData.blockHeight > 0)

	// Derive timestamp (prefer proof, fall back to tx)
	const timestamp = proofData?.timestamp ?? txData?.timestamp

	// Derive block height + confirmations
	const blockHeight = proofData?.blockHeight ?? txData?.blockHeight
	const confirmations = proofData?.confirmations ?? txData?.confirmations
	const fee = proofData?.fee ?? txData?.fee

	// Inputs and outputs for display
	const inputs: IoCardProps['items'] = txData?.inputs?.length
		? txData.inputs.map((inp) => ({
				address: inp.address,
				satoshis: inp.satoshis,
				label: inp.outpoint ? truncateTxid(inp.outpoint) : undefined,
			}))
		: []

	const outputs: IoCardProps['items'] = txData?.outputs?.length
		? txData.outputs.map((out) => ({
				address: out.address,
				satoshis: out.satoshis,
				label: out.isChange ? 'Change' : undefined,
			}))
		: []

	const explorerUrl = `https://whatsonchain.com/tx/${txid}`

	return (
		<div className="w-full h-full overflow-y-auto">
			<div className="max-w-3xl mx-auto p-6 flex flex-col gap-5">
				{/* Back button */}
				<button
					type="button"
					onClick={handleBack}
					className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors w-fit -ml-1"
				>
					<ArrowLeft size={14} strokeWidth={1.75} />
					Transaction History
				</button>

				{/* Page title */}
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h1 className="text-[18px] font-bold text-foreground leading-none mb-1.5">
							Transaction Detail
						</h1>
						<div className="flex items-center gap-2">
							<span className="text-[10px] font-mono text-muted-foreground truncate font-[family-name:var(--font-mono)]">
								{txid ? truncateTxid(txid) : '—'}
							</span>
							{txid && (
								<>
									<button
										type="button"
										onClick={handleCopyTxid}
										className="text-muted-foreground hover:text-foreground transition-colors"
										title="Copy txid"
									>
										<Copy size={10} />
									</button>
									<a
										href={explorerUrl}
										target="_blank"
										rel="noreferrer"
										className="text-muted-foreground hover:text-blue-400 transition-colors"
										title="View on WhatsOnChain"
									>
										<ExternalLink size={10} />
									</a>
								</>
							)}
						</div>
					</div>
				</div>

				{loading ? (
					<div className="flex flex-col gap-4">
						<SkeletonBlock h="h-32" />
						<SkeletonBlock h="h-40" />
						<SkeletonBlock h="h-28" />
					</div>
				) : error ? (
					<div className="bg-card rounded-lg border border-border p-6 text-center">
						<p className="text-[13px] text-muted-foreground">{error}</p>
						<a
							href={explorerUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1.5 text-[12px] text-blue-500 hover:text-blue-400 transition-colors mt-3"
						>
							<ExternalLink size={12} />
							View on WhatsOnChain
						</a>
					</div>
				) : (
					<>
						{/* Summary card */}
						<div className="bg-card rounded-lg border border-border p-6 text-center flex flex-col items-center gap-3">
							<div className="flex items-center gap-2">
								{isConfirmed ? (
									<CheckCircle
										size={16}
										className="text-green-500"
										strokeWidth={1.75}
									/>
								) : (
									<Clock
										size={16}
										className="text-yellow-500"
										strokeWidth={1.75}
									/>
								)}
								<span
									className={[
										'text-[12px] font-medium',
										isConfirmed ? 'text-green-500' : 'text-yellow-500',
									].join(' ')}
								>
									{isConfirmed ? 'Confirmed' : 'Pending'}
								</span>
							</div>

							{txData?.satoshis !== undefined && (
								<p className="text-2xl font-bold text-foreground">
									{formatSatoshis(txData.satoshis)}
								</p>
							)}

							{timestamp && (
								<p className="text-[12px] text-muted-foreground">
									{formatTimestamp(timestamp)}
								</p>
							)}
						</div>

						{/* Inputs / Outputs */}
						<div className="flex items-start gap-3">
							<IoCard title="Inputs" items={inputs} txid={txid} />

							<div className="flex items-center justify-center pt-8 shrink-0">
								<ArrowRight
									size={16}
									className="text-muted-foreground"
									strokeWidth={1.75}
								/>
							</div>

							<IoCard title="Outputs" items={outputs} txid={txid} />
						</div>

						{/* Proof / metadata card */}
						{(blockHeight !== undefined ||
							confirmations !== undefined ||
							fee !== undefined) && (
							<div className="bg-card rounded-lg border border-border p-4">
								<p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
									Chain Details
								</p>
								<DetailRow label="Block Height" value={blockHeight} />
								<DetailRow label="Confirmations" value={confirmations} />
								<DetailRow
									label="Fee"
									value={fee !== undefined ? `${fee} sats` : undefined}
								/>
							</div>
						)}

						{/* Raw Hex — collapsible */}
						{txData?.rawhex && (
							<div className="bg-card rounded-lg border border-border overflow-hidden">
								<button
									type="button"
									onClick={() => setHexExpanded((v) => !v)}
									className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
								>
									<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
										Raw Hex
									</span>
									<span className="text-[11px] text-muted-foreground">
										{hexExpanded ? 'Hide' : 'Show'}
									</span>
								</button>

								{hexExpanded && (
									<div className="border-t border-border px-4 pb-4 pt-3">
										<div className="flex items-center justify-end mb-2">
											<button
												type="button"
												onClick={handleCopyHex}
												className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
											>
												<Copy size={11} />
												{copied ? 'Copied!' : 'Copy'}
											</button>
										</div>
										<pre className="text-[10px] font-mono text-muted-foreground break-all whitespace-pre-wrap font-[family-name:var(--font-mono)] bg-muted/40 rounded p-3 max-h-48 overflow-y-auto">
											{txData.rawhex}
										</pre>
									</div>
								)}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	)
}
