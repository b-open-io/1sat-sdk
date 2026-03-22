import { useCallback, useState } from "react";
import { useWallet } from "../../hooks/use-wallet";

export function UnlockWallet() {
	const { unlockWallet } = useWallet();
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const handleUnlock = useCallback(async () => {
		setError("");
		setLoading(true);
		try {
			const result = await unlockWallet("");
			if (!result.success) {
				setError(result.error ?? "Failed to unlock wallet");
			}
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	}, [unlockWallet]);

	return (
		<div className="max-w-sm mx-auto p-6 flex flex-col items-center justify-center min-h-screen">
			<h1 className="text-2xl font-bold text-foreground mb-1 text-center">
				1Sat Wallet
			</h1>
			<p className="text-sm text-muted-foreground mb-8 text-center">
				Authenticate to unlock your wallet
			</p>

			{error && (
				<div className="mb-4 w-full p-3 border border-destructive text-destructive text-sm font-mono">
					{error}
				</div>
			)}

			<button
				type="button"
				disabled={loading}
				onClick={handleUnlock}
				className="w-full py-3 bg-primary text-primary-foreground font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
			>
				{loading ? "Unlocking..." : "Unlock with Touch ID"}
			</button>
		</div>
	);
}
