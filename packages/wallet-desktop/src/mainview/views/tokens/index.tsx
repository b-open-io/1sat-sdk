import { SendBsv21Ui } from '@/components/blocks/send-bsv21'
import { STACK_URL } from '../../../shared/constants'
import { useSendBsv21 } from '@/components/blocks/send-bsv21'
import type {
	SendBsv21Params,
	SendBsv21Result,
	TokenBalance as SendTokenBalance,
} from '@/components/blocks/send-bsv21'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Coins, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { TokenBalance } from '../../../shared/types'
import { rpc } from '../../rpc'
import { Empty } from '@/components/ui/empty'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORDFS_BASE = `${STACK_URL}/content`

function formatBalance(raw: string, decimals: number): string {
	const n = Number(raw) / 10 ** decimals
	return n.toFixed(decimals)
}

function truncateId(id: string): string {
	if (id.length <= 20) return id
	return `${id.slice(0, 8)}…${id.slice(-8)}`
}

function toSendTokenBalance(b: TokenBalance): SendTokenBalance {
	return {
		tokenId: b.id,
		symbol: b.sym ?? b.id.slice(0, 8),
		balance: b.amt,
		decimals: b.dec,
		iconUrl: b.icon ? `${ORDFS_BASE}/${b.icon}` : undefined,
	}
}

// ---------------------------------------------------------------------------
// TokenIcon
// ---------------------------------------------------------------------------

interface TokenIconProps {
	iconOutpoint: string | undefined
	symbol: string
}

function TokenIcon({ iconOutpoint, symbol }: TokenIconProps) {
	const [failed, setFailed] = useState(false)

	if (!iconOutpoint || failed) {
		return (
			<span className="flex size-8 flex-shrink-0 items-center justify-center bg-muted">
				<Coins className="size-4 text-muted-foreground" aria-hidden="true" />
			</span>
		)
	}

	return (
		<img
			src={`${ORDFS_BASE}/${iconOutpoint}`}
			alt={symbol}
			className="size-8 flex-shrink-0 object-cover"
			style={{ borderRadius: 0 }}
			onError={() => setFailed(true)}
		/>
	)
}

// ---------------------------------------------------------------------------
// SendDialog
// ---------------------------------------------------------------------------

interface SendDialogProps {
	token: TokenBalance | null
	open: boolean
	onOpenChange: (open: boolean) => void
	onSend: (params: SendBsv21Params) => Promise<SendBsv21Result>
}

function SendDialog({ token, open, onOpenChange, onSend }: SendDialogProps) {
	const { isLoading, error, result, execute, reset } = useSendBsv21({ onSend })

	const handleOpenChange = useCallback(
		(next: boolean) => {
			if (!next) reset()
			onOpenChange(next)
		},
		[onOpenChange, reset],
	)

	const balances: SendTokenBalance[] = token ? [toSendTokenBalance(token)] : []

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						Send {token?.sym ?? token?.id.slice(0, 8) ?? 'Token'}
					</DialogTitle>
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
// TokenRow
// ---------------------------------------------------------------------------

interface TokenRowProps {
	token: TokenBalance
	onSendClick: (token: TokenBalance) => void
	onRowClick: (token: TokenBalance) => void
}

function TokenRow({ token, onSendClick, onRowClick }: TokenRowProps) {
	const symbol = token.sym ?? token.id.slice(0, 8)
	const balance = formatBalance(token.amt, token.dec)

	return (
		<button
			type="button"
			className="flex items-center gap-4 px-6 py-3 hover:bg-accent/30 transition-colors cursor-pointer w-full text-left bg-transparent border-none p-0"
			onClick={() => onRowClick(token)}
		>
			<TokenIcon iconOutpoint={token.icon} symbol={symbol} />

			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-xs font-bold text-foreground">{symbol}</span>
				<span
					className="font-mono text-muted-foreground"
					style={{ fontSize: '9px', letterSpacing: '0.02em' }}
					title={token.id}
				>
					{truncateId(token.id)}
				</span>
			</div>

			<span
				className="font-mono text-sm text-foreground tabular-nums"
				style={{ fontFamily: 'var(--font-mono)' }}
			>
				{balance}
			</span>

			<Button
				variant="outline"
				size="xs"
				onClick={(e) => {
					e.stopPropagation()
					onSendClick(token)
				}}
				aria-label={`Send ${symbol}`}
			>
				<Send aria-hidden="true" />
				Send
			</Button>
		</button>
	)
}

// ---------------------------------------------------------------------------
// SkeletonRows
// ---------------------------------------------------------------------------

function SkeletonRows() {
	return (
		<>
			{[0, 1, 2].map((i) => (
				<div
					key={i}
					className="flex items-center gap-4 px-6 py-3 border-b border-border last:border-b-0"
				>
					<Skeleton className="size-8 flex-shrink-0 rounded-none" />
					<div className="flex flex-1 flex-col gap-1">
						<Skeleton className="h-3 w-16" />
						<Skeleton className="h-2 w-32" />
					</div>
					<Skeleton className="h-4 w-20" />
					<Skeleton className="h-6 w-16" />
				</div>
			))}
		</>
	)
}

// ---------------------------------------------------------------------------
// TokensView
// ---------------------------------------------------------------------------

interface TokensViewProps {
	params?: Record<string, string>
	onNavigate?: (url: string) => void
}

export function TokensView({ onNavigate }: TokensViewProps = {}) {
	const [balances, setBalances] = useState<TokenBalance[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)
	const [sendTarget, setSendTarget] = useState<TokenBalance | null>(null)
	const [dialogOpen, setDialogOpen] = useState(false)

	useEffect(() => {
		rpc.request
			.getTokenBalances()
			.then((result) => {
				setBalances(result.balances)
			})
			.catch((err) => {
				setError(
					err instanceof Error ? err : new Error('Failed to load tokens'),
				)
			})
			.finally(() => {
				setLoading(false)
			})
	}, [])

	const handleSendClick = useCallback((token: TokenBalance) => {
		setSendTarget(token)
		setDialogOpen(true)
	}, [])

	const handleRowClick = useCallback(
		(token: TokenBalance) => {
			const symbol = token.sym ?? token.id.slice(0, 8)
			onNavigate?.(
				`1sat://tokens/detail?tokenId=${token.id}&symbol=${symbol}&balance=${token.amt}&decimals=${token.dec}`,
			)
		},
		[onNavigate],
	)

	const handleSend = useCallback(
		async (params: SendBsv21Params): Promise<SendBsv21Result> => {
			return rpc.request.sendBsv21({
				tokenId: params.tokenId,
				amount: params.amount,
				address: params.address,
			})
		},
		[],
	)

	return (
		<div className="mx-auto w-full max-w-[800px]">
			{/* Header */}
			<div className="flex items-center gap-3 px-6 py-5">
				<h2 className="text-xl font-bold text-foreground">Tokens</h2>
				{!loading && (
					<Badge variant="secondary" className="tabular-nums">
						{balances.length}
					</Badge>
				)}
			</div>

			{/* List container */}
			<div className="border-t border-border">
				{loading && <SkeletonRows />}

				{!loading && error && (
					<div className="flex items-center justify-center px-6 py-12 text-sm text-destructive">
						{error.message}
					</div>
				)}

				{!loading && !error && balances.length === 0 && (
					<Empty
						icon={Coins}
						title="No tokens yet"
						description="BSV-21 tokens you own will appear here."
					/>
				)}

				{!loading &&
					!error &&
					balances.map((token, index) => (
						<div
							key={token.id}
							className={
								index < balances.length - 1 ? 'border-b border-border' : ''
							}
						>
							<TokenRow
								token={token}
								onSendClick={handleSendClick}
								onRowClick={handleRowClick}
							/>
						</div>
					))}
			</div>

			{/* Send dialog */}
			<SendDialog
				token={sendTarget}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSend={handleSend}
			/>
		</div>
	)
}
