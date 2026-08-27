import { Download, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import Avatar from 'sigma-avatars'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { AccountInfo } from '../../../shared/types'
import { rpc } from '../../rpc'

const THEME_COLORS = [
	'var(--chart-1)',
	'var(--chart-2)',
	'var(--chart-3)',
	'var(--chart-4)',
	'var(--chart-5)',
]

function truncateId(id: string, len = 12): string {
	if (id.length <= len) return id
	return `${id.slice(0, len)}...`
}

interface AccountCardProps {
	account: AccountInfo
	loading: boolean
	disabled: boolean
	focused: boolean
	onSelect: (id: string) => void
	onDeleted?: () => void
}

export function AccountCard({
	account,
	loading,
	disabled,
	focused,
	onSelect,
	onDeleted,
}: AccountCardProps) {
	const [deleteOpen, setDeleteOpen] = useState(false)
	const [deleting, setDeleting] = useState(false)

	const handleDelete = useCallback(async () => {
		setDeleting(true)
		try {
			const result = await rpc.request.deleteAccount({ accountId: account.id })
			if (result.success) {
				onDeleted?.()
			}
		} catch (err) {
			console.error('Delete failed:', err)
		} finally {
			setDeleting(false)
			setDeleteOpen(false)
		}
	}, [account.id, onDeleted])

	const handleDownloadBackup = useCallback(() => {
		// TODO: implement backup export for single account
		console.log('Download backup for', account.id)
	}, [account.id])

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						className={`w-[130px] bg-card rounded-xl p-4 flex flex-col items-center gap-2 cursor-pointer border-2 transition-all ${
							loading
								? 'border-primary'
								: focused
									? 'border-primary/60'
									: 'border-transparent hover:border-muted-foreground/30'
						} ${disabled && !loading ? 'opacity-50' : ''}`}
						onClick={() => onSelect(account.id)}
						disabled={disabled}
					>
						<div className="size-14 rounded-full overflow-hidden">
							{loading ? (
								<div className="size-full bg-muted animate-pulse rounded-full" />
							) : (
								<Avatar
									colors={THEME_COLORS}
									name={account.identityKey}
									size={56}
									variant="pixel"
								/>
							)}
						</div>
						<span className="text-sm font-medium text-foreground truncate w-full text-center">
							{account.displayName}
						</span>
						<span className="text-[10px] text-muted-foreground font-mono truncate w-full text-center">
							{account.bapId
								? truncateId(account.bapId, 16)
								: truncateId(account.identityKey)}
						</span>
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onClick={handleDownloadBackup}>
						<Download data-icon="inline-start" />
						Download Backup
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						className="text-destructive focus:text-destructive"
						onClick={() => setDeleteOpen(true)}
					>
						<Trash2 data-icon="inline-start" />
						Delete Account
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete account?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently remove{' '}
							<span className="font-semibold text-foreground">
								{account.displayName}
							</span>{' '}
							and its wallet data from this device. This action cannot be
							undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex items-center gap-2 px-1 py-2">
						<Button variant="outline" size="sm" onClick={handleDownloadBackup}>
							<Download data-icon="inline-start" />
							Download backup first
						</Button>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							disabled={deleting}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							{deleting ? 'Deleting...' : 'Delete'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
