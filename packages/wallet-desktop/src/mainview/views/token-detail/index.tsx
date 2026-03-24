import {
	SendBsv21Ui,
	useSendBsv21,
} from '@/components/blocks/send-bsv21'
import type {
	SendBsv21Params,
	SendBsv21Result,
	TokenBalance as SendTokenBalance,
} from '@/components/blocks/send-bsv21'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
	ArrowDownLeft,
	ArrowLeft,
	ArrowUpRight,
	Copy,
	ExternalLink,
	Send,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORDFS_BASE = 'http://127.0.0.1:8080'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenInfo {
	sym?: string
	dec: number
	txid?: string
	// The API may return more fields — we only use what we render
}

interface TokenHistoryEntry {
	txid: string
	height?: number
	idx?: number
	// BSV21 script history response shape
	// direction inferred from sign of amt
	amt?: string
	ts?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateTxid(txid: string): string {
	if (txid.length <= 16) return txid
	return `${txid.slice(0, 8)}…${txid.slice(-8)}`
}

function formatAmount(raw: string | undefined, decimals: number): string {
	if (raw == null) return '—'
	const n = Number(raw)
	if (Number.isNaN(n)) return raw
	const abs = Math.abs(n) / 10 ** decimals
	return abs.toFixed(decimals)
}

function formatDate(ts: number | undefined): string {
	if (!ts) return '—'
	return new Date(ts * 1000).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	})
}

function isSend(amt: string | undefined): boolean {
	if (amt == null) return false
	return Number(amt) < 0
}

async function copyToClipboard(text: string): Promise<void> {
	await navigator.clipboard.writeText(text)
}

// ---------------------------------------------------------------------------
// TokenIcon
// ---------------------------------------------------------------------------

interface TokenIconProps {
	tokenId: string
	symbol: string
	size?: number
}

function TokenIcon({ tokenId, symbol, size = 48 }: TokenIconProps) {
	const [failed, setFailed] = useState(false)

	if (failed) {
		return (
			<span
				className="flex flex-shrink-0 items-center justify-center rounded-full bg-muted text-lg font-bold text-muted-foreground"
				style={{ width: size, height: size }}
			>
				{symbol.charAt(0).toUpperCase()}
			</span>
		)
	}

	return (
		<img
			src={`${ORDFS_BASE}/content/${tokenId}`}
			alt={symbol}
			className="flex-shrink-0 rounded-full object-cover"
			style={{ width: size, height: size }}
			onError={() => setFailed(true)}
		/>
	)
}

// ---------------------------------------------------------------------------
// SendDialog
// ---------------------------------------------------------------------------

interface SendDialogProps {
	tokenId: string
	symbol: string
	balance: string
	decimals: number
	open: boolean
	onOpenChange: (open: boolean) => void
	onSend: (params: SendBsv21Params) => Promise<SendBsv21Result>
}

function SendDialog({
	tokenId,
	symbol,
	balance,
	decimals,
	open,
	onOpenChange,
	onSend,
}: SendDialogProps) {
	const { isLoading, error, result, execute, reset } = useSendBsv21({ onSend })

	const handleOpenChange = useCallback(
		(next: boolean) => {
			if (!next) reset()
			onOpenChange(next)
		},
		[onOpenChange, reset],
	)

	const balances: SendTokenBalance[] = [
		{
			tokenId,
			symbol,
			balance,
			decimals,
			iconUrl: `${ORDFS_BASE}/content/${tokenId}`,
		},
	]

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Send {symbol}</DialogTitle>
				</DialogHeader>
				<SendBsv21Ui
					balances={balances}
					isLoading={isLoading}
					error={error}
					result={result}
					onSubmit={execute}
					onReset={reset}
					className="border-0 shadow-none p-0"
				/>
			</DialogContent>
		</Dialog>
	)
}

// ---------------------------------------------------------------------------
// HistoryTab
// ---------------------------------------------------------------------------

interface HistoryTabProps {
	tokenId: string
	decimals: number
}

function HistoryTab({ tokenId, decimals }: HistoryTabProps) {
	const [entries, setEntries] = useState<TokenHistoryEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		let cancelled = false

		async function load() {
			try {
				const receiveInfo = await rpc.request.getReceiveInfo()
				const { address } = receiveInfo
				const res = await fetch(
					`${ORDFS_BASE}/1sat/bsv21/${tokenId}/script/${address}/history`,
				)
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}: ${res.statusText}`)
				}
				const data = await res.json()
				if (cancelled) return
				// Accept array directly or wrapped in a key
				const list: TokenHistoryEntry[] = Array.isArray(data)
					? data
					: (data.history ?? data.txns ?? data.results ?? [])
				setEntries(list)
			} catch (err) {
				if (cancelled) return
				setError(
					err instanceof Error ? err : new Error('Failed to load history'),
				)
			} finally {
				if (!cancelled) setLoading(false)
			}
		}

		load()
		return () => {
			cancelled = true
		}
	}, [tokenId])

	if (loading) {
		return (
			<div className="flex flex-col divide-y divide-border">
				{[0, 1, 2, 3, 4].map((i) => (
					<div key={i} className="flex items-center gap-3 px-6 py-3">
						<Skeleton className="size-8 rounded-full flex-shrink-0" />
						<div className="flex flex-1 flex-col gap-1.5">
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-2 w-36" />
						</div>
						<Skeleton className="h-3 w-16" />
						<Skeleton className="h-2 w-20" />
					</div>
				))}
			</div>
		)
	}

	if (error) {
		return (
			<div className="flex items-center justify-center px-6 py-12 text-sm text-destructive">
				{error.message}
			</div>
		)
	}

	if (entries.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-muted-foreground">
				<p className="text-sm">No transaction history</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col divide-y divide-border">
			{entries.map((entry) => {
				const send = isSend(entry.amt)
				return (
					<div
						key={entry.txid}
						className="flex items-center gap-3 px-6 py-3 hover:bg-accent/30 transition-colors"
					>
						{/* Direction icon */}
						{send ? (
							<ArrowUpRight
								className="size-5 flex-shrink-0 text-muted-foreground"
								aria-label="Sent"
							/>
						) : (
							<ArrowDownLeft
								className="size-5 flex-shrink-0 text-green-500"
								aria-label="Received"
							/>
						)}

						{/* Amount + txid */}
						<div className="flex flex-1 min-w-0 flex-col gap-0.5">
							<span
								className={[
									'text-sm font-mono font-medium tabular-nums',
									send ? 'text-foreground' : 'text-green-500',
								].join(' ')}
							>
								{send ? '-' : '+'}
								{formatAmount(entry.amt, decimals)}
							</span>
							<span
								className="font-mono text-muted-foreground truncate"
								style={{ fontSize: '9px', letterSpacing: '0.02em' }}
								title={entry.txid}
							>
								{truncateTxid(entry.txid)}
							</span>
						</div>

						{/* Date */}
						<span className="text-[10px] text-muted-foreground flex-shrink-0">
							{formatDate(entry.ts)}
						</span>

						{/* Copy txid button */}
						<button
							type="button"
							className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
							onClick={() => copyToClipboard(entry.txid)}
							title="Copy txid"
							aria-label="Copy transaction ID"
						>
							<Copy className="size-3.5" aria-hidden="true" />
						</button>
					</div>
				)
			})}
		</div>
	)
}

// ---------------------------------------------------------------------------
// InfoTab
// ---------------------------------------------------------------------------

interface InfoTabProps {
	tokenId: string
}

interface InfoRow {
	label: string
	value: string
	canCopy?: boolean
	canOpen?: boolean
}

function InfoTab({ tokenId }: InfoTabProps) {
	const [info, setInfo] = useState<TokenInfo | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		let cancelled = false

		fetch(`${ORDFS_BASE}/1sat/bsv21/${tokenId}`)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
				return res.json() as Promise<TokenInfo>
			})
			.then((data) => {
				if (!cancelled) setInfo(data)
			})
			.catch((err) => {
				if (!cancelled)
					setError(
						err instanceof Error ? err : new Error('Failed to load token info'),
					)
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [tokenId])

	if (loading) {
		return (
			<div className="grid grid-cols-3 gap-px bg-border p-px">
				{[0, 1, 2].map((i) => (
					<div key={i} className="flex flex-col gap-2 bg-card px-5 py-4">
						<Skeleton className="h-2 w-12" />
						<Skeleton className="h-4 w-20" />
					</div>
				))}
			</div>
		)
	}

	if (error) {
		return (
			<div className="flex items-center justify-center px-6 py-12 text-sm text-destructive">
				{error.message}
			</div>
		)
	}

	if (!info) return null

	const rows: InfoRow[] = [
		{
			label: 'Symbol',
			value: info.sym ?? '—',
		},
		{
			label: 'Decimals',
			value: String(info.dec),
		},
		{
			label: 'Deploy txid',
			value: info.txid
				? truncateTxid(info.txid)
				: tokenId
					? truncateTxid(tokenId.split('_')[0])
					: '—',
			canCopy: true,
			canOpen: true,
		},
	]

	const deployTxid = info.txid ?? tokenId.split('_')[0]

	return (
		<div className="grid grid-cols-3 gap-px bg-border p-px">
			{rows.map((row) => (
				<div
					key={row.label}
					className="flex flex-col gap-1.5 bg-card px-5 py-4"
				>
					<span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
						{row.label}
					</span>
					<div className="flex items-center gap-1.5">
						<span
							className="text-sm font-mono text-foreground truncate"
							title={row.canCopy ? deployTxid : row.value}
						>
							{row.value}
						</span>
						{row.canCopy && (
							<button
								type="button"
								className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
								onClick={() => copyToClipboard(deployTxid)}
								title="Copy"
								aria-label="Copy deploy txid"
							>
								<Copy className="size-3" aria-hidden="true" />
							</button>
						)}
						{row.canOpen && (
							<a
								href={`https://whatsonchain.com/tx/${deployTxid}`}
								target="_blank"
								rel="noopener noreferrer"
								className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
								title="View on chain"
								aria-label="View deploy transaction on chain"
							>
								<ExternalLink className="size-3" aria-hidden="true" />
							</a>
						)}
					</div>
				</div>
			))}
		</div>
	)
}

// ---------------------------------------------------------------------------
// TokenDetailView
// ---------------------------------------------------------------------------

export interface TokenDetailViewProps {
	params: Record<string, string>
	onNavigate?: (url: string) => void
}

type ActiveTab = 'history' | 'info'

const TOKEN_TABS: { id: ActiveTab; label: string }[] = [
	{ id: 'history', label: 'History' },
	{ id: 'info', label: 'Info' },
]

export function TokenDetailView({ params, onNavigate }: TokenDetailViewProps) {
	const tokenId = params.tokenId ?? ''
	const symbol = params.symbol ?? tokenId.slice(0, 8)
	const name = params.name ?? ''
	const rawBalance = params.balance ?? '0'
	const decimals = params.decimals ? Number(params.decimals) : 0

	const [activeTab, setActiveTab] = useState<ActiveTab>('history')
	const [dialogOpen, setDialogOpen] = useState(false)

	const handleBack = useCallback(() => {
		onNavigate?.('1sat://tokens/all')
	}, [onNavigate])

	const handleSend = useCallback(
		async (sendParams: SendBsv21Params): Promise<SendBsv21Result> => {
			return rpc.request.sendBsv21({
				tokenId: sendParams.tokenId,
				amount: sendParams.amount,
				address: sendParams.address,
			})
		},
		[],
	)

	const formattedBalance = (() => {
		const n = Number(rawBalance) / 10 ** decimals
		return n.toFixed(decimals)
	})()

	if (!tokenId) {
		return (
			<div className="flex items-center justify-center px-6 py-12 text-sm text-destructive">
				Missing token ID
			</div>
		)
	}

	return (
		<div className="mx-auto w-full max-w-[800px]">
			{/* Back button */}
			<div className="px-4 pt-4 pb-0">
				<button
					type="button"
					onClick={handleBack}
					className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
					aria-label="Back to tokens"
				>
					<ArrowLeft className="size-3.5" aria-hidden="true" />
					Tokens
				</button>
			</div>

			{/* Hero header */}
			<div className="flex flex-row items-center gap-4 bg-card p-6 w-full">
				<TokenIcon tokenId={tokenId} symbol={symbol} size={48} />

				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="text-2xl font-bold text-foreground leading-none">
						{symbol}
					</span>
					{/* Copy token ID — shows name when present, falls back to truncated ID */}
					<button
						type="button"
						className="group flex w-fit items-center gap-1 text-left text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => copyToClipboard(tokenId)}
						title={tokenId}
						aria-label="Copy token ID"
					>
						<span
							className="max-w-[160px] truncate font-mono"
							style={{ fontSize: '10px', letterSpacing: '0.02em' }}
						>
							{name || truncateTxid(tokenId)}
						</span>
						<Copy
							className="size-3 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
							aria-hidden="true"
						/>
					</button>
				</div>

				<Button
					size="sm"
					onClick={() => setDialogOpen(true)}
					aria-label={`Send ${symbol}`}
					className="flex-shrink-0"
				>
					<Send className="size-3.5" aria-hidden="true" />
					Send
				</Button>
			</div>

			{/* Balance band */}
			<div className="bg-card border-y border-border px-6 py-5">
				<p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
					Your Balance
				</p>
				<p className="text-2xl font-bold font-mono tabular-nums text-foreground">
					{formattedBalance}
					<span className="ml-2 text-sm font-normal text-muted-foreground">
						{symbol}
					</span>
				</p>
			</div>

			{/* Tab bar */}
			<div className="flex border-b border-border px-6">
				{TOKEN_TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={[
							'px-4 py-3 text-sm font-medium transition-colors',
							activeTab === tab.id
								? 'border-b-2 border-primary text-foreground'
								: 'text-muted-foreground hover:text-foreground',
						].join(' ')}
					>
						{tab.label}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div className="mt-0">
				{activeTab === 'history' && (
					<HistoryTab tokenId={tokenId} decimals={decimals} />
				)}
				{activeTab === 'info' && <InfoTab tokenId={tokenId} />}
			</div>

			{/* Send dialog */}
			<SendDialog
				tokenId={tokenId}
				symbol={symbol}
				balance={rawBalance}
				decimals={decimals}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSend={handleSend}
			/>
		</div>
	)
}
