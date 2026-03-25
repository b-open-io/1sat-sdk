import { Button } from '@/components/ui/button'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { useCallback, useEffect, useState } from 'react'
import type { AccountInfo } from '../../../shared/types'
import { useWallet } from '../../hooks/use-wallet'
import { rpc } from '../../rpc'
import { CreateWallet } from '../onboarding/create-wallet'
import { AccountCard } from './account-card'
import { ImportBackup } from './import-backup'

type PickerView =
	| { kind: 'grid' }
	| { kind: 'create' }
	| { kind: 'import-backup' }

export function AccountPicker() {
	const { accounts: pushedAccounts, selectAccount } = useWallet()
	const [fetchedAccounts, setFetchedAccounts] = useState<AccountInfo[]>([])
	const [loading, setLoading] = useState<string | null>(null)
	const [view, setView] = useState<PickerView>({ kind: 'grid' })
	const [showOnStartup, setShowOnStartup] = useState(true)

	// Fetch accounts on mount
	const refreshAccounts = useCallback(() => {
		rpc.request.listAccounts().then((r) => {
			setFetchedAccounts(r.accounts)
			setShowOnStartup(r.showPickerOnStartup)
		})
	}, [])

	useEffect(() => {
		refreshAccounts()
	}, [refreshAccounts])

	const accounts = pushedAccounts.length > 0 ? pushedAccounts : fetchedAccounts
	const [focusedIndex, setFocusedIndex] = useState(0)

	// Keyboard navigation for the grid
	useHotkeys([
		{
			hotkey: 'ArrowLeft',
			callback: () => {
				setFocusedIndex((i) => Math.max(0, i - 1))
			},
		},
		{
			hotkey: 'ArrowRight',
			callback: () => {
				// +1 for the Add card
				setFocusedIndex((i) => Math.min(accounts.length, i + 1))
			},
		},
		{
			hotkey: 'Enter',
			callback: () => {
				if (loading) return
				if (focusedIndex < accounts.length) {
					handleSelect(accounts[focusedIndex].id)
				} else {
					setView({ kind: 'create' })
				}
			},
		},
	])

	const handleSelect = async (accountId: string) => {
		setLoading(accountId)
		try {
			const result = await selectAccount(accountId)
			if (!result.success) {
				console.error('Failed to select account:', result.error)
				setLoading(null)
			}
		} catch (err) {
			console.error('Account selection failed:', err)
			setLoading(null)
		}
	}

	const handleTogglePicker = (checked: boolean) => {
		setShowOnStartup(checked)
		rpc.request.setShowPickerOnStartup({ show: checked })
	}

	if (view.kind === 'create') {
		return <CreateWallet onCancel={() => setView({ kind: 'grid' })} />
	}
	if (view.kind === 'import-backup') {
		return (
			<ImportBackup
				onComplete={() => {
					refreshAccounts()
					setView({ kind: 'grid' })
				}}
				onCancel={() => setView({ kind: 'grid' })}
			/>
		)
	}
	return (
		<div className="min-h-screen flex flex-col items-center justify-center select-none">
			<div className="max-w-lg w-full px-6">
				{/* Branding */}
				<div className="flex flex-col items-center mb-8">
					<div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-lg font-bold text-background mb-3">
						1S
					</div>
					<h1 className="text-xl font-semibold text-foreground">
						Who's using 1Sat?
					</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Choose a profile to get started
					</p>
				</div>

				{/* Account grid */}
				<div className="flex flex-wrap justify-center gap-3 mb-8">
					{accounts.map((account, idx) => (
						<AccountCard
							key={account.id}
							account={account}
							loading={loading === account.id}
							disabled={loading !== null}
							focused={focusedIndex === idx}
							onSelect={handleSelect}
							onDeleted={refreshAccounts}
						/>
					))}

					{/* Add card */}
					<button
						type="button"
						className={`w-[120px] border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
							focusedIndex === accounts.length
								? 'border-primary'
								: 'border-border hover:border-muted-foreground/50'
						}`}
						onClick={() => setView({ kind: 'create' })}
						disabled={loading !== null}
					>
						<div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-2xl text-muted-foreground">
							+
						</div>
						<span className="text-sm text-muted-foreground">Add</span>
					</button>
				</div>

				{/* Import option */}
				<div className="flex justify-center mb-6">
					<Button
						variant="ghost"
						size="sm"
						className="text-xs text-muted-foreground"
						onClick={() => setView({ kind: 'import-backup' })}
						disabled={loading !== null}
					>
						Use backup
					</Button>
				</div>

				{/* Footer */}
				<div className="flex justify-between items-center pt-3 border-t border-border">
					<p className="text-[10px] text-muted-foreground/60">
						<kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">
							&larr;
						</kbd>{' '}
						<kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">
							&rarr;
						</kbd>{' '}
						navigate,{' '}
						<kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">
							Enter
						</kbd>{' '}
						select
					</p>
					<label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
						<input
							type="checkbox"
							checked={showOnStartup}
							onChange={(e) => handleTogglePicker(e.target.checked)}
							className="accent-amber-500"
						/>
						Show on startup
					</label>
				</div>
			</div>
		</div>
	)
}

