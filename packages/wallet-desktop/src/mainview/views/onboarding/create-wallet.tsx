import { useCallback, useEffect, useState } from "react";
import { MnemonicGrid } from "../../components/mnemonic-grid";
import { useWallet } from "../../hooks/use-wallet";

export function CreateWallet() {
	const { createWallet, generateMnemonic } = useWallet();
	const [mnemonic, setMnemonic] = useState<string[]>([]);
	const [confirmed, setConfirmed] = useState(false);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		generateMnemonic().then(
			(m) => setMnemonic(m.split(" ")),
			(err) => setError(`Failed to generate mnemonic: ${err}`),
		);
	}, [generateMnemonic]);

	const handleSubmit = useCallback(async () => {
		setError("");
		setLoading(true);
		try {
			const result = await createWallet(mnemonic.join(" "), "");
			if (!result.success) {
				setError(result.error ?? "Failed to create wallet");
			}
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	}, [mnemonic, createWallet]);

	return (
		<div className="max-w-lg mx-auto p-6">
			<h1 className="text-2xl font-bold text-foreground mb-1">
				Create Wallet
			</h1>
			<p className="text-sm text-muted-foreground mb-6">
				Write down your recovery phrase and store it safely.
			</p>

			{mnemonic.length > 0 ? (
				<MnemonicGrid words={mnemonic} />
			) : (
				<div className="text-muted-foreground text-sm">
					Generating mnemonic...
				</div>
			)}

			<label className="flex items-center gap-2 mt-6 text-sm text-foreground cursor-pointer select-none">
				<input
					type="checkbox"
					checked={confirmed}
					onChange={(e) => setConfirmed(e.target.checked)}
					className="accent-primary"
				/>
				I have saved my recovery phrase
			</label>

			{error && (
				<div className="mt-4 p-3 border border-destructive text-destructive text-sm font-mono">
					{error}
				</div>
			)}

			<button
				type="button"
				disabled={!confirmed || mnemonic.length === 0 || loading}
				onClick={handleSubmit}
				className="mt-4 w-full py-3 bg-primary text-primary-foreground font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
			>
				{loading ? "Creating..." : "Create Wallet"}
			</button>
		</div>
	);
}
