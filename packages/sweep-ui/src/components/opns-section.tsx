import { useEffect, useState } from 'react'
import type { EnrichedOrdinal } from '../lib/scanner'
import { getServices } from '../lib/services'
import { SWEEP_BATCH_SIZE } from '../lib/sweeper'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function OpnsSection({
	opnsNames,
	selectedOpns,
	onToggle,
	onSelectPage,
	onDeselectAll,
	onSweep,
	onSweepAll,
	onSend,
	onBurn,
	walletConnected,
}: {
	opnsNames: EnrichedOrdinal[]
	selectedOpns: Set<string>
	onToggle: (outpoint: string) => void
	onSelectPage: (outpoints: string[]) => void
	onDeselectAll: () => void
	onSweep: () => void
	onSweepAll: () => void
	onSend?: (destination: string) => void
	onBurn?: () => void
	walletConnected: boolean
}) {
	const [page, setPage] = useState(0)
	const [address, setAddress] = useState('')
	const [resolvedNames, setResolvedNames] = useState<Map<string, string>>(
		new Map(),
	)
	const [overlayValid, setOverlayValid] = useState<Map<string, boolean>>(
		new Map(),
	)
	const [validating, setValidating] = useState(false)

	useEffect(() => {
		if (opnsNames.length === 0) return
		const controller = new AbortController()
		const pending = new Map<string, string>()
		Promise.all(
			opnsNames.map(async (item) => {
				try {
					const res = await fetch(item.contentUrl, {
						signal: controller.signal,
					})
					if (res.ok) pending.set(item.outpoint, await res.text())
				} catch {
					/* fetch aborted or failed */
				}
			}),
		).then(() => {
			if (!controller.signal.aborted) setResolvedNames(new Map(pending))
		})
		return () => controller.abort()
	}, [opnsNames])

	useEffect(() => {
		if (opnsNames.length === 0) return
		let cancelled = false
		setValidating(true)
		const originToOutpoints = new Map<string, string[]>()
		for (const item of opnsNames) {
			const origin = item.origin ?? item.outpoint
			const list = originToOutpoints.get(origin) ?? []
			list.push(item.outpoint)
			originToOutpoints.set(origin, list)
		}
		getServices()
			.opns.validateOrigins([...originToOutpoints.keys()])
			.then((result) => {
				if (cancelled) return
				const map = new Map<string, boolean>()
				for (const [origin, valid] of Object.entries(result)) {
					for (const outpoint of originToOutpoints.get(origin) ?? [])
						map.set(outpoint, valid)
				}
				setOverlayValid(map)
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) setValidating(false)
			})
		return () => {
			cancelled = true
		}
	}, [opnsNames])

	if (opnsNames.length === 0) return null

	const totalPages = Math.ceil(opnsNames.length / SWEEP_BATCH_SIZE)
	const safePage = Math.min(page, totalPages - 1)
	const start = safePage * SWEEP_BATCH_SIZE
	const pageItems = opnsNames.slice(start, start + SWEEP_BATCH_SIZE)
	const pageOutpoints = pageItems.map((o) => o.outpoint)
	const selectedCount = selectedOpns.size
	const batchCount = Math.ceil(opnsNames.length / SWEEP_BATCH_SIZE)

	return (
		<div className="border border-orange-500/20 bg-orange-500/5 p-4 rounded-lg">
			<div className="flex items-start justify-between mb-3">
				<div>
					<div className="flex items-center gap-2 mb-1">
						<span className="h-2 w-2 rounded-full bg-orange-500" />
						<span className="text-sm font-semibold text-orange-500">
							OPNS Domains
						</span>
					</div>
					<div className="text-xs text-muted-foreground">
						{opnsNames.length} domain{opnsNames.length !== 1 ? 's' : ''}
						{selectedCount > 0 && (
							<span className="text-orange-400 ml-1">
								({selectedCount} selected)
							</span>
						)}
						<span className="ml-1 text-muted-foreground/80">
							· {SWEEP_BATCH_SIZE}/page
						</span>
					</div>
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-[11px]"
						onClick={() => onSelectPage(pageOutpoints)}
					>
						Select page
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-[11px]"
						onClick={onDeselectAll}
						disabled={selectedCount === 0}
					>
						Deselect
					</Button>
				</div>
			</div>
			<div className="space-y-1">
				{pageItems.map((item) => {
					const isSelected = selectedOpns.has(item.outpoint)
					const displayName =
						resolvedNames.get(item.outpoint) ??
						item.outpoint.substring(0, 8) + '...'
					return (
						<div
							key={item.outpoint}
							className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all ${isSelected ? 'border border-orange-500 bg-orange-500/10 ring-1 ring-orange-500/30' : 'border border-border/50 hover:border-border bg-muted/30'}`}
							onClick={() => onToggle(item.outpoint)}
						>
							<div
								className={`w-4 h-4 rounded border-2 flex items-center justify-center text-[10px] shrink-0 ${isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'border-muted-foreground/40'}`}
							>
								{isSelected && '\u2713'}
							</div>
							<span className="text-sm text-foreground truncate">
								{displayName}
							</span>
							{!validating &&
								overlayValid.has(item.outpoint) &&
								(overlayValid.get(item.outpoint) ? (
									<span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
										valid
									</span>
								) : (
									<span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
										invalid
									</span>
								))}
						</div>
					)
				})}
			</div>
			{totalPages > 1 && (
				<div className="flex items-center justify-center gap-4 mt-2">
					<Button
						variant="ghost"
						size="sm"
						className="text-xs"
						onClick={() => setPage(safePage - 1)}
						disabled={safePage === 0}
					>
						Prev
					</Button>
					<span className="text-xs text-muted-foreground">
						Page {safePage + 1} of {totalPages}
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="text-xs"
						onClick={() => setPage(safePage + 1)}
						disabled={safePage >= totalPages - 1}
					>
						Next
					</Button>
				</div>
			)}
			<div className="mt-3 space-y-2">
				{selectedCount > 0 && onSend && (
					<Input
						type="text"
						placeholder="Destination address..."
						value={address}
						onChange={(e) => setAddress(e.target.value)}
						className="font-mono text-xs"
					/>
				)}
				<div className="flex flex-wrap gap-2">
					{selectedCount > 0 && onSend && (
						<Button
							variant="outline"
							size="sm"
							className="flex-1 min-w-[6rem]"
							disabled={!address.trim()}
							onClick={() => onSend(address.trim())}
						>
							Send {selectedCount}
						</Button>
					)}
					{selectedCount > 0 && (
						<Button
							size="sm"
							className="flex-1 min-w-[6rem]"
							onClick={onSweep}
							disabled={!walletConnected}
							title={
								walletConnected ? undefined : 'Connect BRC-100 wallet to sweep'
							}
						>
							Sweep {selectedCount}
							{selectedCount > SWEEP_BATCH_SIZE
								? ` (${Math.ceil(selectedCount / SWEEP_BATCH_SIZE)} batches)`
								: ''}
						</Button>
					)}
					<Button
						variant={selectedCount > 0 ? 'outline' : 'default'}
						size="sm"
						className="flex-1 min-w-[6rem]"
						onClick={onSweepAll}
						disabled={!walletConnected}
						title={
							walletConnected ? undefined : 'Connect BRC-100 wallet to sweep'
						}
					>
						Sweep all
						{batchCount > 1 ? ` (${batchCount} batches)` : ''}
					</Button>
					{selectedCount > 0 && onBurn && (
						<Button
							size="sm"
							className="bg-red-600 hover:bg-red-700 text-white"
							onClick={() => {
								if (
									window.confirm(
										`Permanently burn ${selectedCount} domain${selectedCount !== 1 ? 's' : ''}? This cannot be undone.`,
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
		</div>
	)
}
