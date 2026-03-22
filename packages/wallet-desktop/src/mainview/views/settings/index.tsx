import { useCallback, useState } from "react";
import { useWallet } from "../../hooks/use-wallet";

export function SettingsView() {
	const { lockWallet, deleteWallet } = useWallet();
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [error, setError] = useState("");

	const handleLock = useCallback(async () => {
		await lockWallet();
	}, [lockWallet]);

	const handleDelete = useCallback(async () => {
		if (!confirmDelete) {
			setConfirmDelete(true);
			return;
		}
		setError("");
		try {
			const result = await deleteWallet();
			if (!result.success) {
				setError(result.error ?? "Failed to delete wallet");
			}
		} catch (err) {
			setError(String(err));
		}
	}, [confirmDelete, deleteWallet]);

	return (
		<div className="p-6 space-y-6">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
				Settings
			</div>

			<div className="space-y-3">
				<button
					type="button"
					onClick={handleLock}
					className="w-full py-3 bg-secondary text-secondary-foreground font-medium text-sm border border-border hover:opacity-90 transition-opacity"
				>
					Lock Wallet
				</button>

				<button
					type="button"
					onClick={handleDelete}
					className="w-full py-3 bg-destructive text-destructive-foreground font-medium text-sm hover:opacity-90 transition-opacity"
				>
					{confirmDelete
						? "Confirm Delete -- This Cannot Be Undone"
						: "Delete Wallet"}
				</button>

				{confirmDelete && (
					<button
						type="button"
						onClick={() => setConfirmDelete(false)}
						className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
					>
						Cancel
					</button>
				)}
			</div>

			{error && (
				<div className="p-3 border border-destructive text-destructive text-sm font-mono">
					{error}
				</div>
			)}
		</div>
	);
}
