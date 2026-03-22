import { useCallback, useState } from "react";
import { useWallet } from "../../hooks/use-wallet";

export function UnlockWallet() {
	const { unlockWallet } = useWallet();
	const [passphrase, setPassphrase] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const handleSubmit = useCallback(async () => {
		setError("");

		if (!passphrase) {
			setError("Passphrase is required");
			return;
		}

		setLoading(true);
		try {
			const result = await unlockWallet(passphrase);
			if (!result.success) {
				setError(result.error ?? "Wrong passphrase");
			}
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	}, [passphrase, unlockWallet]);

	return (
		<div className="max-w-sm mx-auto p-6 flex flex-col items-center justify-center min-h-screen">
			<h1 className="text-2xl font-bold text-foreground mb-1 text-center">
				1Sat Wallet
			</h1>
			<p className="text-sm text-muted-foreground mb-8 text-center">
				Enter your passphrase to unlock
			</p>

			<div className="w-full">
				<input
					type="password"
					value={passphrase}
					onChange={(e) => setPassphrase(e.target.value)}
					className="w-full p-3 bg-muted border border-border text-foreground font-mono text-sm outline-none focus:border-primary"
					placeholder="Passphrase"
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSubmit();
					}}
				/>
			</div>

			{error && (
				<div className="mt-4 w-full p-3 border border-destructive text-destructive text-sm font-mono">
					{error}
				</div>
			)}

			<button
				type="button"
				disabled={loading || !passphrase}
				onClick={handleSubmit}
				className="mt-4 w-full py-3 bg-primary text-primary-foreground font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
			>
				{loading ? "Unlocking..." : "Unlock"}
			</button>
		</div>
	);
}
