import { groupBsv20Tokens } from '@1sat/actions'
import { PrivateKey, type WalletInterface } from '@bsv/sdk'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Toaster, toast } from 'sonner'
import {
	legacyBurnOrdinals,
	legacySendBsv,
	legacySendOrdinals,
} from '../lib/legacy-send'
import {
	type EnrichedOrdinal,
	type ScannedAssets,
	deriveAddress,
	scanAddresses,
} from '../lib/scanner'
import {
	type SweepClass,
	executeSweep,
	isSweepAllDisabled,
	selectAllSweepClasses,
	showClassSkips,
	sweepAllClasses,
	sweepBsv20Token,
	sweepBsv21Token,
} from '../lib/sweeper'
import { getWallet } from '../lib/wallet'
import type { LegacyKeys } from '../types'
import {
	Bsv20Section,
	Bsv21Section,
	FundingSection,
	LockedSection,
	OrdinalsSection,
	RunSection,
} from './asset-preview'
import { ConnectWallet } from './connect-wallet'
import { OpnsSection } from './opns-section'
import { TxHistory, type TxRecord } from './tx-history'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { WifInput } from './wif-input'

type TabId = 'ordinals' | 'opns' | 'bsv20' | 'bsv21' | 'locks' | 'run'

export interface SweepAppProps {
	legacyKeys?: LegacyKeys
	wallet?: WalletInterface | null
	sweepOnly?: boolean
	/** Optional host-wallet identity shown above the assets being swept. */
	accountProfile?: {
		name?: string
		avatar?: string
	}
}

export function SweepApp({
	legacyKeys: initialKeys,
	wallet: externalWallet,
	sweepOnly,
	accountProfile,
}: SweepAppProps) {
	const [walletConnected, setWalletConnected] = useState(!!externalWallet)
	const [scanning, setScanning] = useState(false)
	const [scanProgress, setScanProgress] = useState('')
	const [assets, setAssets] = useState<ScannedAssets | null>(null)
	const [legacyKeys, setLegacyKeys] = useState<LegacyKeys | null>(null)
	const [sweeping, setSweeping] = useState(false)
	const [sweepProgress, setSweepProgress] = useState('')
	const [txHistory, setTxHistory] = useState<TxRecord[]>([])
	const [cancelledListings, setCancelledListings] = useState(0)
	const [selectedOrdinals, setSelectedOrdinals] = useState<Set<string>>(
		new Set(),
	)
	const [selectedOpns, setSelectedOpns] = useState<Set<string>>(new Set())
	const [sweepAmount, setSweepAmount] = useState<number | null>(null)
	const [activeTab, setActiveTab] = useState<TabId>('ordinals')
	/** Classes excluded from Sweep-all (CLI `--skip` equivalent). Empty = all. */
	const [skippedClasses, setSkippedClasses] = useState<Set<SweepClass>>(
		new Set(),
	)

	useEffect(() => {
		setWalletConnected(!!externalWallet)
	}, [externalWallet])

	const resolveWallet = useCallback((): WalletInterface | null => {
		return externalWallet ?? getWallet()
	}, [externalWallet])

	const keyMap = useMemo(() => {
		if (!legacyKeys) return new Map<string, PrivateKey>()
		const map = new Map<string, PrivateKey>()
		map.set(
			deriveAddress(legacyKeys.payPk),
			PrivateKey.fromWif(legacyKeys.payPk),
		)
		map.set(
			deriveAddress(legacyKeys.ordPk),
			PrivateKey.fromWif(legacyKeys.ordPk),
		)
		if (legacyKeys.identityPk) {
			map.set(
				deriveAddress(legacyKeys.identityPk),
				PrivateKey.fromWif(legacyKeys.identityPk),
			)
		}
		return map
	}, [legacyKeys])

	const addTx = useCallback((label: string, txid: string, error?: string) => {
		setTxHistory((prev) => [
			...prev,
			{ label, txid, timestamp: new Date(), error },
		])
	}, [])

	const addCancelled = useCallback((count: number) => {
		if (count > 0) setCancelledListings((prev) => prev + count)
	}, [])

	const groupedBsv20 = useMemo(
		() => (assets ? groupBsv20Tokens(assets.bsv20Tokens) : []),
		[assets],
	)
	const unparsedBsv20 = assets
		? assets.bsv20Tokens.length -
			groupedBsv20.reduce((n, t) => n + t.outputs.length, 0)
		: 0

	const tabs = useMemo(() => {
		if (!assets) return []
		const t: { id: TabId; label: string; count: number }[] = []
		if (assets.ordinals.length > 0)
			t.push({
				id: 'ordinals',
				label: 'Ordinals',
				count: assets.ordinals.length,
			})
		if (assets.opnsNames.length > 0)
			t.push({ id: 'opns', label: 'OpNS', count: assets.opnsNames.length })
		if (groupedBsv20.length > 0 || unparsedBsv20 > 0)
			t.push({
				id: 'bsv20',
				label: 'BSV-20',
				count: groupedBsv20.reduce((n, tok) => n + tok.outputs.length, 0),
			})
		if (assets.bsv21Tokens.length > 0)
			t.push({
				id: 'bsv21',
				label: 'BSV-21',
				count: assets.bsv21Tokens.reduce((n, tok) => n + tok.outputs.length, 0),
			})
		if (assets.locked.length > 0)
			t.push({ id: 'locks', label: 'Locks', count: assets.locked.length })
		if (assets.run.length > 0)
			t.push({ id: 'run', label: 'RUN', count: assets.run.length })
		return t
	}, [assets, groupedBsv20, unparsedBsv20])

	const handleToggleOrdinal = useCallback((outpoint: string) => {
		setSelectedOrdinals((prev) => {
			const next = new Set(prev)
			if (next.has(outpoint)) next.delete(outpoint)
			else next.add(outpoint)
			return next
		})
	}, [])
	const handleSelectOrdinalPage = useCallback((outpoints: string[]) => {
		setSelectedOrdinals(new Set(outpoints))
	}, [])
	const handleDeselectAllOrdinals = useCallback(
		() => setSelectedOrdinals(new Set()),
		[],
	)

	const handleToggleOpns = useCallback((outpoint: string) => {
		setSelectedOpns((prev) => {
			const next = new Set(prev)
			if (next.has(outpoint)) next.delete(outpoint)
			else next.add(outpoint)
			return next
		})
	}, [])
	const handleSelectOpnsPage = useCallback((outpoints: string[]) => {
		setSelectedOpns(new Set(outpoints))
	}, [])
	const handleDeselectAllOpns = useCallback(
		() => setSelectedOpns(new Set()),
		[],
	)

	const refreshAssets = useCallback(async () => {
		if (!legacyKeys) return
		const addresses = [
			...new Set([
				deriveAddress(legacyKeys.payPk),
				deriveAddress(legacyKeys.ordPk),
				...(legacyKeys.identityPk
					? [deriveAddress(legacyKeys.identityPk)]
					: []),
			]),
		]
		const result = await scanAddresses(addresses)
		setAssets(result)
		setSelectedOrdinals(new Set())
		setSelectedOpns(new Set())
		setSweepAmount(null)
	}, [legacyKeys])

	const handleScan = useCallback(async (keys: LegacyKeys) => {
		setScanning(true)
		setAssets(null)
		setSelectedOrdinals(new Set())
		setSelectedOpns(new Set())
		setSkippedClasses(new Set())
		setSweepAmount(null)
		setLegacyKeys(keys)

		try {
			const addresses = [
				...new Set([
					deriveAddress(keys.payPk),
					deriveAddress(keys.ordPk),
					...(keys.identityPk ? [deriveAddress(keys.identityPk)] : []),
				]),
			]
			const result = await scanAddresses(addresses, (p) =>
				setScanProgress(p.detail ?? p.phase),
			)
			setAssets(result)

			const grouped = groupBsv20Tokens(result.bsv20Tokens)
			const total =
				result.funding.length +
				result.ordinals.length +
				result.opnsNames.length +
				result.bsv21Tokens.reduce((n, t) => n + t.outputs.length, 0) +
				grouped.reduce((n, t) => n + t.outputs.length, 0) +
				result.locked.length +
				result.run.length
			if (total === 0) toast.info('No assets found at legacy addresses')

			if (result.ordinals.length > 0) setActiveTab('ordinals')
			else if (result.opnsNames.length > 0) setActiveTab('opns')
			else if (grouped.length > 0) setActiveTab('bsv20')
			else if (result.bsv21Tokens.length > 0) setActiveTab('bsv21')
			else if (result.locked.length > 0) setActiveTab('locks')
		} catch (e) {
			console.error('Scan failed:', e)
			toast.error(e instanceof Error ? e.message : 'Scan failed')
		} finally {
			setScanning(false)
		}
	}, [])

	useEffect(() => {
		if (initialKeys) handleScan(initialKeys)
	}, [initialKeys, handleScan])

	const runOperation = useCallback(
		async (label: string, op: () => Promise<string>) => {
			setSweeping(true)
			setSweepProgress(`${label}...`)
			try {
				const txid = await op()
				if (txid) addTx(label, txid)
				toast.success(label)
				await refreshAssets()
			} catch (e) {
				const msg = e instanceof Error ? e.message : 'Operation failed'
				addTx(label, '', msg)
				toast.error(msg)
			} finally {
				setSweeping(false)
			}
		},
		[addTx, refreshAssets],
	)

	const getSelectedFunding = useCallback(() => {
		if (!assets) return []
		if (sweepAmount === null) return assets.funding
		const selected: typeof assets.funding = []
		let accumulated = 0
		for (const utxo of assets.funding) {
			selected.push(utxo)
			accumulated += utxo.satoshis ?? 0
			if (accumulated >= sweepAmount) break
		}
		return selected
	}, [assets, sweepAmount])

	const handleSweepBsv = useCallback(async () => {
		const wallet = resolveWallet()
		if (!wallet || !legacyKeys || !assets) return
		await runOperation('Sweep BSV', async () => {
			const result = await executeSweep({
				wallet,
				keys: keyMap,
				funding: getSelectedFunding(),
				ordinals: [],
				amount: sweepAmount ?? undefined,
				onProgress: setSweepProgress,
			})
			if (result.errors.length > 0) throw new Error(result.errors[0])
			addCancelled(result.cancelledListings.length)
			return result.bsvTxid ?? ''
		})
	}, [
		resolveWallet,
		legacyKeys,
		assets,
		sweepAmount,
		getSelectedFunding,
		runOperation,
		keyMap,
		addCancelled,
	])

	const handleSendBsv = useCallback(
		async (destination: string) => {
			if (!legacyKeys || !assets) return
			await runOperation('Send BSV', async () => {
				const result = await legacySendBsv({
					funding: getSelectedFunding(),
					keys: legacyKeys,
					destination,
					amount: sweepAmount ?? undefined,
				})
				return result.txid
			})
		},
		[legacyKeys, assets, sweepAmount, getSelectedFunding, runOperation],
	)

	const sweepOrdinalList = useCallback(
		async (list: EnrichedOrdinal[], label: string) => {
			const wallet = resolveWallet()
			if (!wallet || !legacyKeys || list.length === 0) return
			await runOperation(label, async () => {
				const result = await executeSweep({
					wallet,
					keys: keyMap,
					funding: [],
					ordinals: list,
					onProgress: setSweepProgress,
				})
				if (result.sweptOutpoints.length > 0) {
					setSelectedOrdinals((prev) => {
						const next = new Set(prev)
						for (const op of result.sweptOutpoints) next.delete(op)
						return next
					})
				}
				if (result.errors.length > 0) {
					for (const txid of result.ordinalTxids) addTx(label, txid)
					if (result.sweptOutpoints.length > 0) await refreshAssets()
					throw new Error(result.errors[0])
				}
				addCancelled(result.cancelledListings.length)
				for (let i = 0; i < result.ordinalTxids.length - 1; i++) {
					addTx(label, result.ordinalTxids[i])
				}
				return result.ordinalTxids[result.ordinalTxids.length - 1] ?? ''
			})
		},
		[
			resolveWallet,
			legacyKeys,
			keyMap,
			runOperation,
			addTx,
			addCancelled,
			refreshAssets,
		],
	)

	const handleSweepOrdinals = useCallback(async () => {
		if (!assets) return
		const selected = assets.ordinals.filter((o) =>
			selectedOrdinals.has(o.outpoint),
		)
		if (selected.length === 0) return
		await sweepOrdinalList(
			selected,
			`Sweep ${selected.length} ordinal${selected.length !== 1 ? 's' : ''}`,
		)
	}, [assets, selectedOrdinals, sweepOrdinalList])

	const handleSweepAllOrdinals = useCallback(async () => {
		if (!assets || assets.ordinals.length === 0) return
		await sweepOrdinalList(
			assets.ordinals,
			`Sweep all ${assets.ordinals.length} ordinal${assets.ordinals.length !== 1 ? 's' : ''}`,
		)
	}, [assets, sweepOrdinalList])

	const handleSendOrdinals = useCallback(
		async (destination: string) => {
			if (!legacyKeys || !assets) return
			const selected = assets.ordinals.filter((o) =>
				selectedOrdinals.has(o.outpoint),
			)
			if (selected.length === 0) return
			await runOperation(
				`Send ${selected.length} ordinal${selected.length !== 1 ? 's' : ''}`,
				async () => {
					const result = await legacySendOrdinals({
						ordinals: selected,
						funding: assets.funding,
						keys: legacyKeys,
						destination,
					})
					return result.txid
				},
			)
		},
		[legacyKeys, assets, selectedOrdinals, runOperation],
	)

	const handleBurnOrdinals = useCallback(async () => {
		if (!legacyKeys || !assets) return
		const selected = assets.ordinals.filter((o) =>
			selectedOrdinals.has(o.outpoint),
		)
		if (selected.length === 0) return
		await runOperation(
			`Burn ${selected.length} ordinal${selected.length !== 1 ? 's' : ''}`,
			async () => {
				const result = await legacyBurnOrdinals({
					ordinals: selected,
					funding: assets.funding,
					keys: legacyKeys,
				})
				return result.txid
			},
		)
	}, [legacyKeys, assets, selectedOrdinals, runOperation])

	const sweepOpnsList = useCallback(
		async (list: EnrichedOrdinal[], label: string) => {
			const wallet = resolveWallet()
			if (!wallet || !legacyKeys || list.length === 0) return
			await runOperation(label, async () => {
				const result = await executeSweep({
					wallet,
					keys: keyMap,
					funding: [],
					ordinals: list,
					onProgress: setSweepProgress,
				})
				if (result.sweptOutpoints.length > 0) {
					setSelectedOpns((prev) => {
						const next = new Set(prev)
						for (const op of result.sweptOutpoints) next.delete(op)
						return next
					})
				}
				if (result.errors.length > 0) {
					for (const txid of result.ordinalTxids) addTx(label, txid)
					if (result.sweptOutpoints.length > 0) await refreshAssets()
					throw new Error(result.errors[0])
				}
				addCancelled(result.cancelledListings.length)
				for (let i = 0; i < result.ordinalTxids.length - 1; i++) {
					addTx(label, result.ordinalTxids[i])
				}
				return result.ordinalTxids[result.ordinalTxids.length - 1] ?? ''
			})
		},
		[
			resolveWallet,
			legacyKeys,
			keyMap,
			runOperation,
			addTx,
			addCancelled,
			refreshAssets,
		],
	)

	const handleSweepOpns = useCallback(async () => {
		if (!assets) return
		const selected = assets.opnsNames.filter((o) =>
			selectedOpns.has(o.outpoint),
		)
		if (selected.length === 0) return
		await sweepOpnsList(
			selected,
			`Sweep ${selected.length} domain${selected.length !== 1 ? 's' : ''}`,
		)
	}, [assets, selectedOpns, sweepOpnsList])

	const handleSweepAllOpns = useCallback(async () => {
		if (!assets || assets.opnsNames.length === 0) return
		await sweepOpnsList(
			assets.opnsNames,
			`Sweep all ${assets.opnsNames.length} domain${assets.opnsNames.length !== 1 ? 's' : ''}`,
		)
	}, [assets, sweepOpnsList])

	const handleSendOpns = useCallback(
		async (destination: string) => {
			if (!legacyKeys || !assets) return
			const selected = assets.opnsNames.filter((o) =>
				selectedOpns.has(o.outpoint),
			)
			if (selected.length === 0) return
			await runOperation(
				`Send ${selected.length} domain${selected.length !== 1 ? 's' : ''}`,
				async () => {
					const result = await legacySendOrdinals({
						ordinals: selected,
						funding: assets.funding,
						keys: legacyKeys,
						destination,
					})
					return result.txid
				},
			)
		},
		[legacyKeys, assets, selectedOpns, runOperation],
	)

	const handleBurnOpns = useCallback(async () => {
		if (!legacyKeys || !assets) return
		const selected = assets.opnsNames.filter((o) =>
			selectedOpns.has(o.outpoint),
		)
		if (selected.length === 0) return
		await runOperation(
			`Burn ${selected.length} domain${selected.length !== 1 ? 's' : ''}`,
			async () => {
				const result = await legacyBurnOrdinals({
					ordinals: selected,
					funding: assets.funding,
					keys: legacyKeys,
				})
				return result.txid
			},
		)
	}, [legacyKeys, assets, selectedOpns, runOperation])

	const handleSweepBsv21Token = useCallback(
		async (tokenId: string) => {
			const wallet = resolveWallet()
			if (!wallet || !assets) return
			const token = assets.bsv21Tokens.find((t) => t.tokenId === tokenId)
			if (!token) return
			await runOperation(
				`Sweep ${token.symbol ?? tokenId.slice(0, 8)}`,
				async () => {
					const result = await sweepBsv21Token({
						wallet,
						keys: keyMap,
						token,
						onProgress: setSweepProgress,
					})
					for (const txid of result.txids.slice(0, -1)) addTx('BSV-21', txid)
					if (result.error) throw new Error(result.error)
					addCancelled(result.cancelledListings.length)
					return result.txid ?? ''
				},
			)
		},
		[resolveWallet, assets, keyMap, runOperation, addTx, addCancelled],
	)

	const handleSweepBsv20Token = useCallback(
		async (tick: string) => {
			const wallet = resolveWallet()
			if (!wallet || !assets) return
			const token = groupedBsv20.find((t) => t.tick === tick)
			if (!token) return
			await runOperation(`Sweep ${token.tick}`, async () => {
				const result = await sweepBsv20Token({
					wallet,
					keys: keyMap,
					token,
					onProgress: setSweepProgress,
				})
				if (result.error) throw new Error(result.error)
				addCancelled(result.cancelledListings.length)
				return result.txid ?? ''
			})
		},
		[resolveWallet, assets, groupedBsv20, keyMap, runOperation, addCancelled],
	)

	const toggleSweepClass = useCallback((sweepClass: SweepClass) => {
		setSkippedClasses((prev) => {
			const next = new Set(prev)
			if (next.has(sweepClass)) next.delete(sweepClass)
			else next.add(sweepClass)
			return next
		})
	}, [])

	const sweepClasses = useMemo(() => {
		if (!assets) return []
		const classes: { id: SweepClass; label: string; count: number }[] = []
		if (assets.funding.length > 0)
			classes.push({ id: 'bsv', label: 'BSV', count: assets.funding.length })
		if (assets.ordinals.length > 0)
			classes.push({
				id: 'ordinals',
				label: 'Ordinals',
				count: assets.ordinals.length,
			})
		if (assets.opnsNames.length > 0)
			classes.push({
				id: 'opns',
				label: 'OpNS',
				count: assets.opnsNames.length,
			})
		if (groupedBsv20.length > 0)
			classes.push({
				id: 'bsv20',
				label: 'BSV-20',
				count: groupedBsv20.reduce((n, t) => n + t.outputs.length, 0),
			})
		if (assets.bsv21Tokens.some((t) => t.outputs.length > 0))
			classes.push({
				id: 'bsv21',
				label: 'BSV-21',
				count: assets.bsv21Tokens.reduce((n, t) => n + t.outputs.length, 0),
			})
		return classes
	}, [assets, groupedBsv20])

	const handleSweepAll = useCallback(async () => {
		const wallet = resolveWallet()
		if (!wallet || !legacyKeys || !assets) return
		await runOperation('Sweep selected', async () => {
			const all = selectAllSweepClasses(assets)
			const result = await sweepAllClasses({
				wallet,
				keys: keyMap,
				assets,
				amount: sweepAmount ?? undefined,
				onProgress: setSweepProgress,
				selection: {
					sweepBsv: !skippedClasses.has('bsv') && all.sweepBsv,
					ordinalOutpoints: skippedClasses.has('ordinals')
						? new Set<string>()
						: selectedOrdinals.size > 0
							? selectedOrdinals
							: all.ordinalOutpoints,
					opnsOutpoints: skippedClasses.has('opns')
						? new Set<string>()
						: selectedOpns.size > 0
							? selectedOpns
							: all.opnsOutpoints,
					bsv20Ticks: skippedClasses.has('bsv20')
						? new Set<string>()
						: all.bsv20Ticks,
					bsv21TokenIds: skippedClasses.has('bsv21')
						? new Set<string>()
						: all.bsv21TokenIds,
				},
			})
			if (result.bsvTxid) addTx('BSV', result.bsvTxid)
			for (const txid of result.ordinalTxids) addTx('Ordinals', txid)
			for (const txid of result.bsv20Txids) addTx('BSV-20', txid)
			for (const txid of result.bsv21Txids) addTx('BSV-21', txid)
			addCancelled(result.cancelledListings.length)
			if (result.errors.length > 0) throw new Error(result.errors[0])
			return (
				result.bsvTxid ??
				result.ordinalTxids.at(-1) ??
				result.bsv20Txids.at(-1) ??
				result.bsv21Txids.at(-1) ??
				''
			)
		})
	}, [
		resolveWallet,
		legacyKeys,
		assets,
		keyMap,
		sweepAmount,
		runOperation,
		addTx,
		addCancelled,
		skippedClasses,
		selectedOrdinals,
		selectedOpns,
	])

	return (
		<div className="min-h-screen bg-background text-foreground">
			<Toaster position="top-right" />
			<div className="mx-auto max-w-lg p-4 space-y-4 py-12">
				<div className="text-center space-y-2 mb-4">
					<h1 className="text-3xl font-bold tracking-tight">1Sat Sweep</h1>
					<p className="text-sm text-muted-foreground">
						Transfer or sweep legacy assets
					</p>
				</div>

				{accountProfile && (accountProfile.name || accountProfile.avatar) && (
					<div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
						{accountProfile.avatar ? (
							<img
								src={accountProfile.avatar}
								alt=""
								className="h-9 w-9 rounded-full object-cover"
								onError={(e) => {
									;(e.target as HTMLImageElement).style.display = 'none'
								}}
							/>
						) : (
							<div className="h-9 w-9 rounded-full bg-muted" />
						)}
						<div className="min-w-0">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Sweeping account
							</div>
							<div className="truncate text-sm font-medium">
								{accountProfile.name || 'Current account'}
							</div>
						</div>
					</div>
				)}

				{!externalWallet && (
					<ConnectWallet
						onConnected={() => setWalletConnected(true)}
						onDisconnected={() => setWalletConnected(false)}
						connected={walletConnected}
					/>
				)}

				{!initialKeys && (
					<WifInput
						onScan={handleScan}
						scanning={scanning}
						disabled={sweeping}
					/>
				)}

				{scanning && (
					<p className="text-sm text-center text-muted-foreground animate-pulse">
						{scanProgress}
					</p>
				)}

				{assets && !sweeping && (
					<div className="space-y-3">
						{showClassSkips(
							sweepClasses.map((c) => c.id),
							skippedClasses,
						) && (
							<div className="flex flex-wrap gap-1.5">
								{sweepClasses.map((sweepClass) => {
									const skipped = skippedClasses.has(sweepClass.id)
									return (
										<Button
											key={sweepClass.id}
											variant={skipped ? 'outline' : 'secondary'}
											size="sm"
											className="gap-1.5"
											onClick={() => toggleSweepClass(sweepClass.id)}
											title={
												skipped
													? `Include ${sweepClass.label} in Sweep-selected`
													: `Skip ${sweepClass.label} in Sweep-selected`
											}
										>
											{sweepClass.label}
											<Badge
												variant="secondary"
												className="text-[10px] px-1.5 py-0"
											>
												{sweepClass.count}
											</Badge>
										</Button>
									)
								})}
							</div>
						)}
						<Button
							className="w-full"
							disabled={
								!walletConnected ||
								isSweepAllDisabled(
									sweepClasses.map((c) => c.id),
									skippedClasses,
								)
							}
							onClick={handleSweepAll}
							title={
								walletConnected ? undefined : 'Connect BRC-100 wallet to sweep'
							}
						>
							{skippedClasses.size > 0
								? 'Sweep selected to wallet'
								: 'Sweep all to wallet'}
						</Button>
						<FundingSection
							funding={assets.funding}
							totalBsv={assets.totalBsv}
							sweepAmount={sweepAmount}
							onSweepAmountChange={setSweepAmount}
							onSweep={handleSweepBsv}
							onSend={sweepOnly ? undefined : handleSendBsv}
							walletConnected={walletConnected}
						/>

						{tabs.length > 0 && (
							<Tabs
								value={activeTab}
								onValueChange={(v) => setActiveTab(v as TabId)}
							>
								<TabsList className="w-full">
									{tabs.map((tab) => (
										<TabsTrigger
											key={tab.id}
											value={tab.id}
											className="flex-1 gap-1.5"
										>
											{tab.label}
											<Badge
												variant="secondary"
												className="text-[10px] px-1.5 py-0"
											>
												{tab.count}
											</Badge>
										</TabsTrigger>
									))}
								</TabsList>
								<TabsContent value="ordinals">
									<OrdinalsSection
										ordinals={assets.ordinals}
										selectedOrdinals={selectedOrdinals}
										onToggle={handleToggleOrdinal}
										onSelectPage={handleSelectOrdinalPage}
										onDeselectAll={handleDeselectAllOrdinals}
										onSweep={handleSweepOrdinals}
										onSweepAll={handleSweepAllOrdinals}
										onSend={sweepOnly ? undefined : handleSendOrdinals}
										onBurn={sweepOnly ? undefined : handleBurnOrdinals}
										walletConnected={walletConnected}
									/>
								</TabsContent>
								<TabsContent value="opns">
									<OpnsSection
										opnsNames={assets.opnsNames}
										selectedOpns={selectedOpns}
										onToggle={handleToggleOpns}
										onSelectPage={handleSelectOpnsPage}
										onDeselectAll={handleDeselectAllOpns}
										onSweep={handleSweepOpns}
										onSweepAll={handleSweepAllOpns}
										onSend={sweepOnly ? undefined : handleSendOpns}
										onBurn={sweepOnly ? undefined : handleBurnOpns}
										walletConnected={walletConnected}
									/>
								</TabsContent>
								<TabsContent value="bsv20">
									<Bsv20Section
										tokens={groupedBsv20}
										unparsedCount={unparsedBsv20}
										onSweep={handleSweepBsv20Token}
										walletConnected={walletConnected}
									/>
								</TabsContent>
								<TabsContent value="bsv21">
									<Bsv21Section
										tokens={assets.bsv21Tokens}
										onSweep={handleSweepBsv21Token}
										walletConnected={walletConnected}
									/>
								</TabsContent>
								<TabsContent value="locks">
									<LockedSection locked={assets.locked} />
								</TabsContent>
								<TabsContent value="run">
									<RunSection run={assets.run} />
								</TabsContent>
							</Tabs>
						)}
					</div>
				)}

				<TxHistory
					sweeping={sweeping}
					progress={sweepProgress}
					history={txHistory}
					cancelledListings={cancelledListings}
				/>
			</div>
		</div>
	)
}
