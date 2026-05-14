import type { IndexedOutput } from '@1sat/types'
import { useState } from 'react'
import type { EnrichedOrdinal, TokenBalance } from '../lib/scanner'
import { formatSats, formatTokenAmount } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'

const ORDINALS_PER_PAGE = 20

function isImageType(ct: string): boolean {
	return ct.startsWith('image/') && ct !== 'image/svg+xml'
}

function OrdinalCard({
	ordinal,
	isSelected,
	onToggle,
}: { ordinal: EnrichedOrdinal; isSelected: boolean; onToggle: () => void }) {
	const ct = ordinal.contentType ?? ''
	const isImage = isImageType(ct)
	const subtype = ct.includes('/') ? ct.split('/')[1] : ct

	return (
		<div
			className={`relative p-2 rounded-lg border cursor-pointer transition-all overflow-hidden ${isSelected ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30' : 'border-border/50 hover:border-border bg-muted/30'}`}
			onClick={onToggle}
		>
			<div className="absolute top-1.5 right-1.5 z-10">
				<div
					className={`w-4 h-4 rounded border-2 flex items-center justify-center text-[10px] ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'border-muted-foreground/40'}`}
				>
					{isSelected && '\u2713'}
				</div>
			</div>
			<div className="w-full aspect-square mb-1.5 rounded overflow-hidden bg-muted/40 flex items-center justify-center">
				{!ordinal.contentUrl ? (
					<span className="text-muted-foreground text-lg">{'\u25C6'}</span>
				) : isImage ? (
					<img
						src={ordinal.contentUrl}
						alt={ordinal.name || 'Ordinal'}
						className="w-full h-full object-cover"
						loading="lazy"
					/>
				) : (
					<iframe
						src={ordinal.contentUrl}
						title={ordinal.name || 'Ordinal'}
						className="w-full h-full border-0 pointer-events-none"
						sandbox=""
						loading="lazy"
					/>
				)}
			</div>
			<div className="min-h-[2rem] flex flex-col justify-end">
				{subtype && (
					<div className="mb-1">
						<span className="inline-block max-w-full px-1 py-0.5 text-[9px] rounded bg-blue-500/20 text-blue-400 truncate">
							{subtype}
						</span>
					</div>
				)}
				{ordinal.name ? (
					<a
						href={ordinal.contentUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="block text-[10px] text-foreground truncate font-medium hover:text-blue-400"
						title={ordinal.name}
						onClick={(e) => e.stopPropagation()}
					>
						{ordinal.name}
					</a>
				) : (
					<a
						href={ordinal.contentUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="block text-[9px] text-muted-foreground truncate font-mono hover:text-blue-400"
						onClick={(e) => e.stopPropagation()}
					>
						{ordinal.outpoint.substring(0, 8)}...
					</a>
				)}
			</div>
		</div>
	)
}

export function FundingSection({
	funding,
	totalBsv,
	sweepAmount,
	onSweepAmountChange,
	onSweep,
	onSend,
	walletConnected,
}: {
	funding: IndexedOutput[]
	totalBsv: number
	sweepAmount: number | null
	onSweepAmountChange: (amount: number | null) => void
	onSweep: () => void
	onSend?: (destination: string) => void
	walletConnected: boolean
}) {
	const [address, setAddress] = useState('')
	if (funding.length === 0) return null
	const isMax = sweepAmount === null
	const displayAmount = isMax ? formatSats(totalBsv) : formatSats(sweepAmount!)

	return (
		<div className="border border-green-500/20 bg-green-500/5 p-4 rounded-lg">
			<div className="flex items-center gap-2 mb-2">
				<span className="h-2 w-2 rounded-full bg-green-500" />
				<span className="text-sm font-semibold text-green-500">
					BSV Funding
				</span>
			</div>
			<div className="flex items-baseline justify-between mb-3">
				<div>
					<div className="text-2xl font-bold text-green-500">
						{formatSats(totalBsv)} sats
					</div>
					<div className="text-xs text-muted-foreground">
						{(totalBsv / 100_000_000).toFixed(8)} BSV
					</div>
				</div>
				<Badge variant="secondary">
					{funding.length} UTXO{funding.length !== 1 ? 's' : ''}
				</Badge>
			</div>
			<div className="flex items-center gap-2">
				<Input
					type="number"
					min={0}
					max={totalBsv}
					placeholder="Max"
					value={isMax ? '' : sweepAmount}
					onChange={(e) => {
						const val = e.target.value
						onSweepAmountChange(
							val === '' ? null : Math.max(0, Math.min(totalBsv, Number(val))),
						)
					}}
					className="flex-1 font-mono"
				/>
				<span className="text-xs text-muted-foreground">sats</span>
				<Button
					variant="outline"
					size="sm"
					className="h-9 text-xs"
					onClick={() => onSweepAmountChange(null)}
					disabled={isMax}
				>
					Max
				</Button>
			</div>
			<div className="mt-3 space-y-2">
				{onSend && (
					<Input
						type="text"
						placeholder="Destination address..."
						value={address}
						onChange={(e) => setAddress(e.target.value)}
						className="font-mono text-xs"
					/>
				)}
				<div className="flex gap-2">
					{onSend && (
						<Button
							variant="outline"
							size="sm"
							className="flex-1"
							disabled={!address.trim()}
							onClick={() => onSend(address.trim())}
						>
							Send {displayAmount} sats
						</Button>
					)}
					<Button
						size="sm"
						className="flex-1"
						onClick={onSweep}
						disabled={!walletConnected}
						title={
							walletConnected ? undefined : 'Connect BRC-100 wallet to sweep'
						}
					>
						Sweep to Wallet
					</Button>
				</div>
			</div>
		</div>
	)
}

export function OrdinalsSection({
	ordinals,
	selectedOrdinals,
	onToggle,
	onSelectAll,
	onDeselectAll,
	onSweep,
	onSend,
	onBurn,
	walletConnected,
}: {
	ordinals: EnrichedOrdinal[]
	selectedOrdinals: Set<string>
	onToggle: (outpoint: string) => void
	onSelectAll: () => void
	onDeselectAll: () => void
	onSweep: () => void
	onSend?: (destination: string) => void
	onBurn?: () => void
	walletConnected: boolean
}) {
	const [page, setPage] = useState(0)
	const [address, setAddress] = useState('')
	if (ordinals.length === 0) return null
	const totalPages = Math.ceil(ordinals.length / ORDINALS_PER_PAGE)
	const start = page * ORDINALS_PER_PAGE
	const pageItems = ordinals.slice(start, start + ORDINALS_PER_PAGE)

	return (
		<div className="border border-blue-500/20 bg-blue-500/5 p-4 rounded-lg">
			<div className="flex items-start justify-between mb-3">
				<div>
					<div className="flex items-center gap-2 mb-1">
						<span className="h-2 w-2 rounded-full bg-blue-500" />
						<span className="text-sm font-semibold text-blue-500">
							Ordinals
						</span>
					</div>
					<div className="text-xs text-muted-foreground">
						{ordinals.length} inscription{ordinals.length !== 1 ? 's' : ''}
						{selectedOrdinals.size > 0 && (
							<span className="text-blue-400 ml-1">
								({selectedOrdinals.size} selected)
							</span>
						)}
					</div>
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-[11px]"
						onClick={onSelectAll}
					>
						Select All
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-[11px]"
						onClick={onDeselectAll}
						disabled={selectedOrdinals.size === 0}
					>
						Deselect
					</Button>
				</div>
			</div>
			<div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
				{pageItems.map((ord) => (
					<OrdinalCard
						key={ord.outpoint}
						ordinal={ord}
						isSelected={selectedOrdinals.has(ord.outpoint)}
						onToggle={() => onToggle(ord.outpoint)}
					/>
				))}
			</div>
			{totalPages > 1 && (
				<div className="flex items-center justify-center gap-4">
					<Button
						variant="ghost"
						size="sm"
						className="text-xs"
						onClick={() => setPage(page - 1)}
						disabled={page === 0}
					>
						Prev
					</Button>
					<span className="text-xs text-muted-foreground">
						Page {page + 1} of {totalPages}
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="text-xs"
						onClick={() => setPage(page + 1)}
						disabled={page >= totalPages - 1}
					>
						Next
					</Button>
				</div>
			)}
			{selectedOrdinals.size > 0 && (
				<div className="mt-3 space-y-2">
					{onSend && (
						<Input
							type="text"
							placeholder="Destination address..."
							value={address}
							onChange={(e) => setAddress(e.target.value)}
							className="font-mono text-xs"
						/>
					)}
					<div className="flex gap-2">
						{onSend && (
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								disabled={!address.trim()}
								onClick={() => onSend(address.trim())}
							>
								Send {selectedOrdinals.size} Ordinal
								{selectedOrdinals.size !== 1 ? 's' : ''}
							</Button>
						)}
						<Button
							size="sm"
							className="flex-1"
							onClick={onSweep}
							disabled={!walletConnected}
							title={
								walletConnected ? undefined : 'Connect BRC-100 wallet to sweep'
							}
						>
							Sweep to Wallet
						</Button>
						{onBurn && (
							<Button
								size="sm"
								className="bg-red-600 hover:bg-red-700 text-white"
								onClick={() => {
									if (
										window.confirm(
											`Permanently burn ${selectedOrdinals.size} ordinal${selectedOrdinals.size !== 1 ? 's' : ''}? This cannot be undone.`,
										)
									)
										onBurn()
								}}
							>
								Burn
							</Button>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

function TokenRow({
	tb,
	onSweep,
	walletConnected,
}: {
	tb: TokenBalance
	onSweep?: (tokenId: string) => void
	walletConnected: boolean
}) {
	return (
		<div
			className={`flex items-center justify-between p-3 rounded-lg border ${tb.isActive ? 'bg-muted/30 border-purple-500/10' : 'bg-muted/20 border-muted/20 opacity-60'}`}
		>
			<div className="flex items-center gap-3">
				<img
					src={tb.icon}
					alt={tb.symbol || 'Token'}
					className="w-8 h-8 rounded-full object-cover"
					onError={(e) => {
						;(e.target as HTMLImageElement).style.display = 'none'
					}}
				/>
				<div>
					<div className="flex items-center gap-2">
						<span className="font-medium text-foreground">
							{tb.symbol || tb.tokenId.slice(0, 8) + '...'}
						</span>
						{tb.isActive ? (
							<span className="px-1.5 py-0.5 text-[9px] rounded bg-green-600/20 text-green-700 dark:text-green-400">
								active
							</span>
						) : (
							<span className="px-1.5 py-0.5 text-[9px] rounded bg-muted text-muted-foreground">
								inactive
							</span>
						)}
					</div>
					<div className="text-xs text-muted-foreground">
						{formatTokenAmount(tb.totalAmount.toString(), tb.decimals)}{' '}
						{tb.symbol || ''}
						<span className="ml-2">
							({tb.outputs.length} output{tb.outputs.length !== 1 ? 's' : ''})
						</span>
					</div>
				</div>
			</div>
			{tb.isActive && onSweep && (
				<Button
					size="sm"
					onClick={() => onSweep(tb.tokenId)}
					disabled={!walletConnected}
					title={
						walletConnected ? undefined : 'Connect BRC-100 wallet to sweep'
					}
				>
					Sweep to Wallet
				</Button>
			)}
		</div>
	)
}

export function Bsv21Section({
	tokens,
	onSweep,
	walletConnected,
}: {
	tokens: TokenBalance[]
	onSweep?: (tokenId: string) => void
	walletConnected: boolean
}) {
	if (tokens.length === 0) return null
	const active = tokens.filter((t) => t.isActive)
	const inactive = tokens.filter((t) => !t.isActive)

	return (
		<div className="border border-purple-500/20 bg-purple-500/5 p-4 rounded-lg">
			<div className="flex items-center gap-2 mb-3">
				<span className="h-2 w-2 rounded-full bg-purple-500" />
				<span className="text-sm font-semibold text-purple-500">
					BSV-21 Tokens
				</span>
			</div>
			<div className="space-y-3">
				{active.map((tb) => (
					<TokenRow
						key={tb.tokenId}
						tb={tb}
						onSweep={onSweep}
						walletConnected={walletConnected}
					/>
				))}
				{inactive.length > 0 && active.length > 0 && (
					<div className="border-t border-purple-500/10 pt-3 mt-3">
						<div className="text-xs text-muted-foreground mb-2">
							Inactive overlays ({inactive.length}) — cannot be swept
						</div>
					</div>
				)}
				{inactive.map((tb) => (
					<TokenRow
						key={tb.tokenId}
						tb={tb}
						walletConnected={walletConnected}
					/>
				))}
			</div>
		</div>
	)
}

export function Bsv20Section({ tokens }: { tokens: IndexedOutput[] }) {
	if (tokens.length === 0) return null
	return (
		<div className="border border-muted/30 bg-muted/10 p-4 rounded-lg">
			<div className="flex items-center gap-2 mb-2">
				<span className="h-2 w-2 rounded-full bg-muted-foreground" />
				<span className="text-sm font-semibold text-muted-foreground">
					BSV-20 Tokens
				</span>
			</div>
			<p className="text-xs text-muted-foreground mb-2">
				Cannot be swept automatically.
			</p>
			<div className="flex flex-wrap gap-2">
				{tokens.slice(0, 10).map((o) => {
					const tickEvent = o.events?.find((e) => e.startsWith('tick:'))
					const tick = tickEvent ? tickEvent.slice(5) : 'Token'
					return (
						<span
							key={o.outpoint}
							className="px-2 py-1 text-xs rounded bg-muted/30 text-muted-foreground"
						>
							{tick}
						</span>
					)
				})}
				{tokens.length > 10 && (
					<span className="text-xs text-muted-foreground">
						+{tokens.length - 10} more
					</span>
				)}
			</div>
		</div>
	)
}

export function LockedSection({ locked }: { locked: IndexedOutput[] }) {
	if (locked.length === 0) return null
	return (
		<div className="border border-yellow-500/20 bg-yellow-500/5 p-4 rounded-lg">
			<div className="flex items-center gap-2 mb-2">
				<span className="h-2 w-2 rounded-full bg-yellow-500" />
				<span className="text-sm font-semibold text-yellow-500">
					Locked Outputs
				</span>
			</div>
			<p className="text-xs text-muted-foreground">
				{locked.length} locked output{locked.length !== 1 ? 's' : ''}. These are
				in contracts and cannot be swept directly.
			</p>
		</div>
	)
}

export function RunSection({ run }: { run: IndexedOutput[] }) {
	if (run.length === 0) return null
	const totalSats = run.reduce((sum, o) => sum + (o.satoshis ?? 0), 0)
	return (
		<div className="border border-orange-500/20 bg-orange-500/5 p-4 rounded-lg">
			<div className="flex items-center gap-2 mb-2">
				<span className="h-2 w-2 rounded-full bg-orange-500" />
				<span className="text-sm font-semibold text-orange-500">
					RUN Protocol Tokens
				</span>
			</div>
			<p className="text-xs text-muted-foreground">
				{run.length} output{run.length !== 1 ? 's' : ''} (
				{totalSats.toLocaleString()} sats). These are RUN protocol token outputs
				and cannot be swept as BSV.
			</p>
		</div>
	)
}
