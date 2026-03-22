import { Button } from '@/components/ui/button'
import { useCallback, useState } from 'react'
import { useWallet } from '../../hooks/use-wallet'
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
		<div className="p-6 space-y-8 max-w-2xl">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
				Settings
			</div>

			{/* Wallet Actions */}
			<div className="space-y-3">
				<h3 className="text-sm font-medium text-foreground">
					Wallet
				</h3>
				<Button
					variant="secondary"
					className="w-full"
					size="lg"
					onClick={handleLock}
				>
					Lock Wallet
				</Button>

				<Button
					variant="destructive"
					className="w-full"
					size="lg"
					onClick={handleDelete}
				>
					{confirmDelete
						? 'Confirm Delete -- This Cannot Be Undone'
						: 'Delete Wallet'}
				</Button>

				{confirmDelete && (
					<Button
						variant="ghost"
						className="w-full"
						onClick={() => setConfirmDelete(false)}
					>
						Cancel
					</Button>
				)}
			</div>

			{error && (
				<div className="p-3 border border-destructive text-destructive text-sm font-mono">
					{error}
				</div>
			)}

			{/* Sweep Private Key */}
			<div className="space-y-3">
				<h3 className="text-sm font-medium text-foreground">
					Sweep Private Key
				</h3>
				<p className="text-xs text-muted-foreground">
					Import funds from an external private key (WIF) into this
					wallet.
				</p>
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

			{/* Theme */}
			<div className="space-y-3">
				<h3 className="text-sm font-medium text-foreground">
					Theme
				</h3>
				<p className="text-xs text-muted-foreground">
					Apply an on-chain theme token to customize the wallet
					appearance.
				</p>
				<ThemeTokenProvider>
					<ThemeTokenSettings />
				</ThemeTokenProvider>
			</div>
		</div>
	)
}
