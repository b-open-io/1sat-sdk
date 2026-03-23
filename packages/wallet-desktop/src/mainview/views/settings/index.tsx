import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCallback, useState } from 'react'
import {
	SweepWallet,
	type ScanResult,
	type SweepResult,
} from '@/components/blocks/sweep-wallet'
import {
	ThemeTokenProvider,
	ThemeTokenSettings,
} from '@/components/blocks/theme-token-provider'
import { rpc } from '../../rpc'
import { useWallet } from '../../hooks/use-wallet'
import { Lock, Server, ExternalLink } from 'lucide-react'

export function SettingsView() {
	const { lockWallet, deleteWallet } = useWallet()
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [error, setError] = useState('')

	const handleLock = useCallback(async () => {
		await lockWallet()
	}, [lockWallet])

	const handleDelete = useCallback(async () => {
		if (!confirmDelete) {
			setConfirmDelete(true)
			return
		}
		setError('')
		try {
			const result = await deleteWallet()
			if (!result.success) {
				setError(result.error ?? 'Failed to delete wallet')
			}
		} catch (err) {
			setError(String(err))
		}
	}, [confirmDelete, deleteWallet])

	// Store the full RPC scan results keyed by WIF so we can pass lockingScript data back
	const [lastScanRaw, setLastScanRaw] = useState<{
		wif: string
		data: Awaited<ReturnType<typeof rpc.request.sweepScan>>
	} | null>(null)

	const handleSweepScan = useCallback(async (wif: string): Promise<ScanResult> => {
		const result = await rpc.request.sweepScan({ wif })
		setLastScanRaw({ wif, data: result })
		return {
			funding: result.funding.map((f) => ({
				outpoint: f.outpoint,
				satoshis: f.satoshis,
			})),
			ordinals: result.ordinals.map((o) => ({
				outpoint: o.outpoint,
			})),
			tokens: result.tokens.map((t) => ({
				tokenId: t.tokenId,
				symbol: t.symbol,
				amount: t.utxos.reduce(
					(sum, u) => (BigInt(sum) + BigInt(u.amount)).toString(),
					'0',
				),
			})),
			totalSats: result.totalSats,
		}
	}, [])

	const handleSweepExecute = useCallback(
		async (wif: string, _assets: ScanResult): Promise<SweepResult> => {
			if (!lastScanRaw || lastScanRaw.wif !== wif) {
				return { error: 'Scan data expired, please re-scan' }
			}
			const result = await rpc.request.sweepBsv({
				wif,
				assets: lastScanRaw.data,
			})
			return result
		},
		[lastScanRaw],
	)

	return (
		<div className="mx-auto max-w-[800px] w-full py-8 px-6">
			<h1 className="text-2xl font-bold mb-6">Settings</h1>

			<Tabs defaultValue="general">
				<TabsList variant="line" className="w-full justify-start border-b border-border rounded-none pb-0 mb-6 h-auto">
					<TabsTrigger value="general" className="rounded-none pb-3">General</TabsTrigger>
					<TabsTrigger value="security" className="rounded-none pb-3">Security</TabsTrigger>
					<TabsTrigger value="network" className="rounded-none pb-3">Network</TabsTrigger>
					<TabsTrigger value="about" className="rounded-none pb-3">About</TabsTrigger>
				</TabsList>

				{/* General Tab */}
				<TabsContent value="general" className="space-y-8">
					{/* Wallet section */}
					<div>
						<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
							Wallet
						</p>
						<div className="flex items-center justify-between py-3">
							<div>
								<p className="text-sm font-medium">Lock Wallet</p>
								<p className="text-xs text-muted-foreground">
									Lock your wallet and require a password to unlock
								</p>
							</div>
							<Button variant="secondary" size="sm" onClick={handleLock}>
								Lock
							</Button>
						</div>
						<Separator />
						<div className="flex items-center justify-between py-3">
							<div>
								<p className="text-sm font-medium">Delete Wallet</p>
								<p className="text-xs text-muted-foreground">
									Permanently remove this wallet from this device
								</p>
							</div>
							<div className="flex items-center gap-2">
								{confirmDelete && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setConfirmDelete(false)}
									>
										Cancel
									</Button>
								)}
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive hover:text-destructive hover:bg-destructive/10"
									onClick={handleDelete}
								>
									{confirmDelete ? 'Confirm Delete' : 'Delete'}
								</Button>
							</div>
						</div>
						{error && (
							<div className="mt-2 p-3 border border-destructive text-destructive text-sm font-mono">
								{error}
							</div>
						)}
					</div>

					{/* Theme section */}
					<div>
						<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
							Theme
						</p>
						<div className="flex items-center justify-between py-3">
							<div>
								<p className="text-sm font-medium">Theme Token</p>
								<p className="text-xs text-muted-foreground">
									Apply an on-chain theme token to customize the wallet appearance
								</p>
							</div>
							<ThemeTokenProvider>
								<ThemeTokenSettings />
							</ThemeTokenProvider>
						</div>
					</div>

					{/* Sweep section */}
					<div>
						<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
							Sweep
						</p>
						<Separator className="mb-4" />
						<SweepWallet
							onScan={handleSweepScan}
							onSweep={handleSweepExecute}
							onSuccess={(result) => {
								if (result.txid) {
									console.log('Sweep complete:', result.txid)
								}
							}}
						/>
					</div>
				</TabsContent>

				{/* Security Tab */}
				<TabsContent value="security">
					<div className="flex flex-col items-center justify-center py-20 text-center gap-3">
						<Lock className="size-10 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">Coming soon</p>
					</div>
				</TabsContent>

				{/* Network Tab */}
				<TabsContent value="network">
					<div className="flex flex-col items-center justify-center py-20 text-center gap-3">
						<Server className="size-10 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">Coming soon</p>
						<p className="text-xs text-muted-foreground">
							Will show 1sat-stack status
						</p>
					</div>
				</TabsContent>

				{/* About Tab */}
				<TabsContent value="about">
					<div className="space-y-6 py-4">
						<div>
							<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
								Application
							</p>
							<div className="flex items-center justify-between py-3">
								<p className="text-sm font-medium">App</p>
								<p className="text-sm text-muted-foreground">1Sat Wallet</p>
							</div>
							<Separator />
							<div className="flex items-center justify-between py-3">
								<p className="text-sm font-medium">Version</p>
								<p className="text-sm text-muted-foreground">0.0.1</p>
							</div>
							<Separator />
							<div className="flex items-center justify-between py-3">
								<p className="text-sm font-medium">Framework</p>
								<p className="text-sm text-muted-foreground">Electrobun</p>
							</div>
						</div>

						<div>
							<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
								Links
							</p>
							<div className="flex items-center justify-between py-3">
								<p className="text-sm font-medium">GitHub</p>
								<a
									href="https://github.com/bitcoin-sv/1sat-sdk"
									target="_blank"
									rel="noreferrer"
									className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
								>
									View on GitHub
									<ExternalLink className="size-3.5" />
								</a>
							</div>
						</div>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	)
}
