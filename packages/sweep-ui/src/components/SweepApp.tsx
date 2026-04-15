import { PrivateKey, type WalletInterface } from '@bsv/sdk'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Toaster, toast } from 'sonner'
import {
	legacyBurnOrdinals,
	legacySendBsv,
	legacySendOrdinals,
} from '../lib/legacy-send'
import {
	type ScannedAssets,
	deriveAddress,
	scanAddresses,
} from '../lib/scanner'
import { executeSweep, sweepBsv21Token } from '../lib/sweeper'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { WifInput } from './wif-input'

type TabId = 'ordinals' | 'opns' | 'bsv21' | 'bsv20' | 'locks' | 'run'

export interface SweepAppProps {
	legacyKeys?: LegacyKeys
	wallet?: WalletInterface | null
	sweepOnly?: boolean
}

export function SweepApp({
	legacyKeys: initialKeys,
	wallet: externalWallet,
	sweepOnly,
}: SweepAppProps) {
	const [walletConnected, setWalletConnected] = useState(!!externalWallet)
	const [scanning, setScanning] = useState(false)
	const [scanProgress, setScanProgress] = useState('')
	const [assets, setAssets] = useState<ScannedAssets | null>(null)
	const [legacyKeys, setLegacyKeys] = useState<LegacyKeys | null>(null)
	const [sweeping, setSweeping] = useState(false)
	const [sweepProgress, setSweepProgress] = useState('')
	const [txHistory, setTxHistory] = useState<TxRecord[]>([])
	const [selectedOrdinals, setSelectedOrdinals] = useState<Set<string>>(
		new Set(),
	)
	const [selectedOpns, setSelectedOpns] = useState<Set<string>>(new Set())
	const [sweepAmount, setSweepAmount] = useState<number | null>(null)
	const [activeTab, setActiveTab] = useState<TabId>('ordinals')

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
		if (assets.bsv21Tokens.length > 0)
			t.push({ id: 'bsv21', label: 'BSV-21', count: assets.bsv21Tokens.length })
		if (assets.bsv20Tokens.length > 0)
			t.push({ id: 'bsv20', label: 'BSV-20', count: assets.bsv20Tokens.length })
		if (assets.locked.length > 0)
			t.push({ id: 'locks', label: 'Locks', count: assets.locked.length })
		if (assets.run.length > 0)
			t.push({ id: 'run', label: 'RUN', count: assets.run.length })
		return t
	}, [assets])

	const handleToggleOrdinal = useCallback((outpoint: string) => {
		setSelectedOrdinals((prev) => {
			const next = new Set(prev)
			if (next.has(outpoint)) next.delete(outpoint)
			else next.add(outpoint)
			return next
		})
	}, [])
	const handleSelectAllOrdinals = useCallback(() => {
		if (assets)
			setSelectedOrdinals(new Set(assets.ordinals.map((o) => o.outpoint)))
	}, [assets])
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
	const handleSelectAllOpns = useCallback(() => {
		if (assets)
			setSelectedOpns(new Set(assets.opnsNames.map((o) => o.outpoint)))
	}, [assets])
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

			const total =
				result.funding.length +
				result.ordinals.length +
				result.opnsNames.length +
				result.bsv21Tokens.reduce((n, t) => n + t.outputs.length, 0) +
				result.bsv20Tokens.length +
				result.locked.length +
				result.run.length
			if (total === 0) toast.info('No assets found at legacy addresses')

			if (result.ordinals.length > 0) setActiveTab('ordinals')
			else if (result.opnsNames.length > 0) setActiveTab('opns')
			else if (result.bsv21Tokens.length > 0) setActiveTab('bsv21')
			else if (result.bsv20Tokens.length > 0) setActiveTab('bsv20')
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
			setSweepProgress(label + '...')
			try {
				const txid = await op()
				addTx(label, txid)
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
			return result.bsvTxid ?? ''
		})
	}, [
		resolveWallet,
		legacyKeys,
		assets,
		sweepAmount,
		getSelectedFunding,
		runOperation,
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

	const handleSweepOrdinals = useCallback(async () => {
		const wallet = resolveWallet()
		if (!wallet || !legacyKeys || !assets) return
		const selected = assets.ordinals.filter((o) =>
			selectedOrdinals.has(o.outpoint),
		)
		if (selected.length === 0) return
		await runOperation(
			`Sweep ${selected.length} ordinal${selected.length !== 1 ? 's' : ''}`,
			async () => {
				const result = await executeSweep({
					wallet,
					keys: keyMap,
					funding: [],
					ordinals: selected,
					onProgress: setSweepProgress,
				})
				if (result.errors.length > 0) throw new Error(result.errors[0])
				return result.ordinalTxids[0] ?? ''
			},
		)
	}, [resolveWallet, legacyKeys, assets, selectedOrdinals, runOperation])

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

	const handleSweepOpns = useCallback(async () => {
		const wallet = resolveWallet()
		if (!wallet || !legacyKeys || !assets) return
		const selected = assets.opnsNames.filter((o) =>
			selectedOpns.has(o.outpoint),
		)
		if (selected.length === 0) return
		await runOperation(
			`Sweep ${selected.length} domain${selected.length !== 1 ? 's' : ''}`,
			async () => {
				const result = await executeSweep({
					wallet,
					keys: keyMap,
					funding: [],
					ordinals: selected,
					onProgress: setSweepProgress,
				})
				if (result.errors.length > 0) throw new Error(result.errors[0])
				return result.ordinalTxids[0] ?? ''
			},
		)
	}, [resolveWallet, legacyKeys, assets, selectedOpns, runOperation])

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
					if (result.error) throw new Error(result.error)
					return result.txid ?? ''
				},
			)
		},
		[resolveWallet, assets, keyMap, runOperation],
	)

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
										onSelectAll={handleSelectAllOrdinals}
										onDeselectAll={handleDeselectAllOrdinals}
										onSweep={handleSweepOrdinals}
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
										onSelectAll={handleSelectAllOpns}
										onDeselectAll={handleDeselectAllOpns}
										onSweep={handleSweepOpns}
										onSend={sweepOnly ? undefined : handleSendOpns}
										onBurn={sweepOnly ? undefined : handleBurnOpns}
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
								<TabsContent value="bsv20">
									<Bsv20Section tokens={assets.bsv20Tokens} />
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
				/>
			</div>
		</div>
	)
}
