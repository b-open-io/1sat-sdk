import { Button } from '@/components/ui/button'
import { useCallback, useState } from 'react'
import { useWallet } from '../../hooks/use-wallet'

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

	return (
		<div className="p-6 space-y-6">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
				Settings
			</div>

			<div className="space-y-3">
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
		</div>
	)
}
