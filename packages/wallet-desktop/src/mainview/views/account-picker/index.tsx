import { Button } from '@/components/ui/button'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { useCallback, useEffect, useState } from 'react'
import type { AccountInfo } from '../../../shared/types'
import { useWallet } from '../../hooks/use-wallet'
import { rpc } from '../../rpc'
import { CreateWallet } from '../onboarding/create-wallet'
import { ImportWallet } from '../onboarding/import-wallet'
import { ImportBackup } from './import-backup'
import { ProfileSetup } from './profile-setup'

const ACCENT_COLORS: Record<string, string> = {
	blue: 'bg-blue-500',
	amber: 'bg-amber-500',
	rose: 'bg-rose-500',
	emerald: 'bg-emerald-500',
	violet: 'bg-violet-500',
	cyan: 'bg-cyan-500',
	orange: 'bg-orange-500',
	pink: 'bg-pink-500',
}

function getInitials(name: string): string {
	if (!name.trim()) return '?'
	return name
		.split(/\s+/)
		.map((w) => w[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)
}

function getColorClass(color: string): string {
	return ACCENT_COLORS[color] ?? 'bg-blue-500'
}

function formatLastUsed(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime()
	const mins = Math.floor(diff / 60_000)
	if (mins < 1) return 'Just now'
	if (mins < 60) return `${mins}m ago`
	const hrs = Math.floor(mins / 60)
	if (hrs < 24) return `${hrs}h ago`
	const days = Math.floor(hrs / 24)
	return `${days}d ago`
}

type PickerView =
	| { kind: 'grid' }
	| { kind: 'create' }
	| { kind: 'import' }
	| { kind: 'import-backup' }
	| { kind: 'profile-setup'; accountId: string }

export function AccountPicker() {
	const { accounts: pushedAccounts, selectAccount, status } = useWallet()
	const [fetchedAccounts, setFetchedAccounts] = useState<AccountInfo[]>([])
	const [loading, setLoading] = useState<string | null>(null)
	const [view, setView] = useState<PickerView>({ kind: 'grid' })
	const [showOnStartup, setShowOnStartup] = useState(true)
	const [setupComplete, setSetupComplete] = useState<Set<string>>(new Set())

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

	// Auto-show profile setup for accounts with placeholder names (e.g. migrated accounts)
	useEffect(() => {
		if (view.kind !== 'grid' || accounts.length === 0) return
		const needsSetup = accounts.find(
			(a) =>
				!setupComplete.has(a.id) &&
				(a.displayName === 'Account 1' ||
					a.displayName === a.identityKey.slice(0, 8)),
		)
		if (needsSetup) {
			setView({ kind: 'profile-setup', accountId: needsSetup.id })
		}
	}, [accounts, view.kind, setupComplete])

	// If a new account was just created (status changed to 'unlocked' during create/import),
	// lock it back and show profile setup. The wallet stays created but locked until the user
	// selects it from the picker after setting up their profile.
	useEffect(() => {
		if (
			status === 'unlocked' &&
			(view.kind === 'create' || view.kind === 'import')
		) {
			// Get the newly created account ID, lock wallet, show profile setup
			rpc.request.getActiveAccount().then((r) => {
				if (r.account) {
					rpc.request.lockWallet().then(() => {
						setView({ kind: 'profile-setup', accountId: r.account!.id })
					})
				}
			})
		}
	}, [status, view.kind])

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

	const handleProfileSetupComplete = () => {
		// Track this account as setup-complete so the auto-detect effect
		// doesn't re-trigger before refreshAccounts resolves
		if (view.kind === 'profile-setup') {
			setSetupComplete((prev) => new Set(prev).add(view.accountId))
		}
		refreshAccounts()
		setView({ kind: 'grid' })
	}

	if (view.kind === 'create') {
		return <CreateWallet onCancel={() => setView({ kind: 'grid' })} />
	}
	if (view.kind === 'import') {
		return <ImportWallet onCancel={() => setView({ kind: 'grid' })} />
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
	if (view.kind === 'profile-setup') {
		return (
			<ProfileSetup
				accountId={view.accountId}
				onComplete={handleProfileSetupComplete}
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

				{/* Import options */}
				<div className="flex justify-center gap-3 mb-6">
					<Button
						variant="ghost"
						size="sm"
						className="text-xs text-muted-foreground"
						onClick={() => setView({ kind: 'import' })}
						disabled={loading !== null}
					>
						Import mnemonic
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-xs text-muted-foreground"
						onClick={() => setView({ kind: 'import-backup' })}
						disabled={loading !== null}
					>
						Import backup
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

function AccountCard({
	account,
	loading,
	disabled,
	focused,
	onSelect,
}: {
	account: AccountInfo
	loading: boolean
	disabled: boolean
	focused: boolean
	onSelect: (id: string) => void
}) {
	return (
		<button
			type="button"
			className={`w-[120px] bg-card rounded-xl p-4 flex flex-col items-center gap-2 cursor-pointer border-2 transition-all ${
				loading
					? 'border-primary'
					: focused
						? 'border-primary/60'
						: 'border-transparent hover:border-muted-foreground/30'
			} ${disabled && !loading ? 'opacity-50' : ''}`}
			onClick={() => onSelect(account.id)}
			disabled={disabled}
		>
			<div
				className={`w-14 h-14 rounded-full ${getColorClass(account.color)} flex items-center justify-center text-lg font-bold text-white`}
			>
				{loading ? (
					<span className="animate-pulse">...</span>
				) : (
					getInitials(account.displayName)
				)}
			</div>
			<span className="text-sm font-medium text-foreground truncate w-full text-center">
				{account.displayName}
			</span>
			<span className="text-[10px] text-muted-foreground">
				{formatLastUsed(account.lastUsedAt)}
			</span>
		</button>
	)
}
