import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { HistoryEntry, ReceiveInfo } from '../../../shared/types'
import {
	ArrowDownLeft,
	ArrowUpRight,
	ChevronRight,
	Coins,
	Copy,
	Gem,
	Lock,
	Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '../../hooks/use-wallet'
import { rpc } from '../../rpc'
import { ReceiveDialog } from './receive-dialog'
import { SendDialog } from './send-dialog'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function satsToBsv(sats: number): string {
	return (sats / 1e8).toFixed(8).replace(/\.?0+$/, (m) =>
		m.startsWith('.') ? '.00000000'.slice(0, 9 - (8 - m.length + 1)) : '',
	)
}

function formatBsvAmount(sats: number): string {
	const bsv = sats / 1e8
	if (Math.abs(bsv) >= 1) return bsv.toFixed(5)
	return bsv.toFixed(8)
}

function truncateAddress(addr: string, chars = 8): string {
	if (addr.length <= chars * 2 + 3) return addr
	return `${addr.slice(0, chars)}…${addr.slice(-chars)}`
}

function relativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime()
	const mins = Math.floor(diff / 60_000)
	if (mins < 1) return 'just now'
	if (mins < 60) return `${mins}m ago`
	const hrs = Math.floor(mins / 60)
	if (hrs < 24) return `${hrs}h ago`
	return `${Math.floor(hrs / 24)}d ago`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BalanceDisplay({ sats }: { sats: number }) {
	const bsv = sats / 1e8
	const [whole, frac = ''] = bsv.toFixed(8).split('.')
	return (
		<div className="flex flex-col items-center py-3">
			<span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase mb-1">
				Balance
			</span>
			<div className="flex items-baseline gap-1">
				<span
					className="font-mono text-3xl font-semibold tracking-tight text-foreground"
					style={{ fontFamily: 'var(--font-mono)' }}
				>
					{whole}.{frac}
				</span>
				<span className="text-xs font-mono font-medium text-muted-foreground ml-1">
					BSV
				</span>
			</div>
		</div>
	)
}

function TxRow({ entry }: { entry: HistoryEntry }) {
	const positive = entry.satoshis >= 0
	return (
		<div className="flex items-center gap-2.5 py-1.5">
			<div
				className={cn(
					'flex items-center justify-center size-5 rounded-full shrink-0',
					positive
						? 'bg-emerald-500/15 text-emerald-400'
						: 'bg-red-500/15 text-red-400',
				)}
			>
				{positive ? (
					<ArrowDownLeft size={10} />
				) : (
					<ArrowUpRight size={10} />
				)}
			</div>
			<div className="flex-1 min-w-0">
				<p className="text-xs text-foreground truncate leading-tight">
					{entry.description}
				</p>
				<p className="text-[10px] text-muted-foreground leading-tight">
					{relativeTime(entry.dateCreated)}
				</p>
			</div>
			<span
				className={cn(
					'text-[11px] font-mono font-medium shrink-0',
					positive ? 'text-emerald-400' : 'text-red-400',
				)}
				style={{ fontFamily: 'var(--font-mono)' }}
			>
				{positive ? '+' : ''}
				{formatBsvAmount(entry.satoshis)}
			</span>
		</div>
	)
}

// ---------------------------------------------------------------------------
// WalletPopover
// ---------------------------------------------------------------------------

interface WalletPopoverProps {
	onNavigate: (url: string) => void
	onOpenChange?: (open: boolean) => void
}

export function WalletPopover({ onNavigate, onOpenChange }: WalletPopoverProps) {
	const { balance, status } = useWallet()
	const [receiveInfo, setReceiveInfo] = useState<ReceiveInfo | null>(null)
	const [history, setHistory] = useState<HistoryEntry[]>([])
	const [copied, setCopied] = useState(false)
	const [open, setOpenInternal] = useState(false)
	const setOpen = useCallback((v: boolean) => { setOpenInternal(v); onOpenChange?.(v) }, [onOpenChange])
	const [sendOpen, setSendOpen] = useState(false)
	const [receiveOpen, setReceiveOpen] = useState(false)
	const [ordinalCount, setOrdinalCount] = useState(0)
	const [tokenCount, setTokenCount] = useState(0)

	const totalSats = balance.confirmed + balance.unconfirmed

	// Fetch address + history when popover opens and wallet is unlocked
	useEffect(() => {
		if (!open || status !== 'unlocked') return
		rpc.request.getReceiveInfo().then(
			(info) => setReceiveInfo(info),
			(err) => console.error('getReceiveInfo failed:', err),
		)
		rpc.request.getTransactionHistory({ limit: 3 }).then(
			(res) => setHistory(res.entries),
			(err) => console.error('getTransactionHistory failed:', err),
		)
		rpc.request.getOrdinals({ limit: 100 }).then(
			(res) => setOrdinalCount(res.ordinals.length),
			() => {},
		)
		rpc.request.getTokenBalances().then(
			(res) => setTokenCount(res.balances.length),
			() => {},
		)
	}, [open, status])

	const copyAddress = useCallback(() => {
		if (!receiveInfo) return
		navigator.clipboard.writeText(receiveInfo.address).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [receiveInfo])

	const handleSend = () => {
		setOpen(false)
		setSendOpen(true)
	}

	const handleReceive = () => {
		setOpen(false)
		setReceiveOpen(true)
	}

	const handleOpenWallet = () => {
		setOpen(false)
		onNavigate('1sat://wallet/overview')
	}

	return (
		<>
		<SendDialog open={sendOpen} onOpenChange={setSendOpen} />
		<ReceiveDialog open={receiveOpen} onOpenChange={setReceiveOpen} />
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger>
				<Button
					variant="ghost"
					size="icon-xs"
					className="text-muted-foreground"
					style={{ borderRadius: 5 }}
					aria-label="Wallet"
				>
					<Wallet size={14} />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={6}
				className="p-0 border-border shadow-xl"
				style={{ width: 320, borderRadius: 0 }}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-border">
					<div className="flex items-center gap-2">
						<Wallet size={13} className="text-muted-foreground" />
						<span
							className="text-[12px] font-semibold tracking-wide text-foreground"
							style={{ fontFamily: 'var(--font-sans)' }}
						>
							Wallet
						</span>
					</div>
					{status === 'unlocked' ? (
						<span className="text-[10px] px-1.5 py-0.5 rounded-[3px] bg-emerald-500/15 text-emerald-400 font-medium">
							unlocked
						</span>
					) : (
						<Lock size={12} className="text-muted-foreground" />
					)}
				</div>

				{/* Balance */}
				<BalanceDisplay sats={totalSats} />

				{/* Action buttons */}
				<div className="flex gap-2 px-4 pb-3">
					<Button
						size="sm"
						className="flex-1 h-7 text-xs font-medium"
						onClick={handleSend}
						disabled={status !== 'unlocked'}
					>
						Send
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="flex-1 h-7 text-xs font-medium border-border"
						onClick={handleReceive}
					>
						Receive
					</Button>
				</div>

				{/* Assets summary */}
				{status === 'unlocked' && (
					<div className="flex items-center gap-3 px-4 py-2 border-b border-border">
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<Gem size={11} />
							<span className="font-mono">{ordinalCount}</span>
							<span>ordinals</span>
						</div>
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<Coins size={11} />
							<span className="font-mono">{tokenCount}</span>
							<span>tokens</span>
						</div>
					</div>
				)}

				{/* Receive address */}
				{receiveInfo && (
					<div className="px-4 pb-3">
						<p className="text-[10px] text-muted-foreground mb-1 tracking-wide uppercase font-medium">
							Receive Address
						</p>
						<div className="flex items-center gap-2 px-2 py-1.5 bg-muted/40 border border-border rounded-[3px]">
							<span
								className="flex-1 text-[10px] font-mono text-muted-foreground truncate"
								style={{ fontFamily: 'var(--font-mono)' }}
							>
								{receiveInfo.address}
							</span>
							<button
								type="button"
								onClick={copyAddress}
								className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
								aria-label="Copy address"
							>
								<Copy size={11} className={copied ? 'text-emerald-400' : ''} />
							</button>
						</div>
					</div>
				)}

				{/* Recent activity */}
				{history.length > 0 && (
					<div className="px-4 pb-3 border-t border-border pt-3">
						<p className="text-[10px] text-muted-foreground mb-1 tracking-wide uppercase font-medium">
							Recent Activity
						</p>
						<div className="divide-y divide-border/50">
							{history.map((entry) => (
								<TxRow key={entry.txid} entry={entry} />
							))}
						</div>
					</div>
				)}

				{/* Footer link */}
				<button
					type="button"
					onClick={handleOpenWallet}
					className="w-full flex items-center justify-between px-4 py-2.5 border-t border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
				>
					<span style={{ fontFamily: 'var(--font-sans)' }}>
						Open full wallet
					</span>
					<ChevronRight size={12} />
				</button>
			</PopoverContent>
		</Popover>
		</>
	)
}
