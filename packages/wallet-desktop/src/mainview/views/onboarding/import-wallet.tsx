import { useCallback, useState } from "react";
import { MnemonicGrid } from "../../components/mnemonic-grid";
import { useWallet } from "../../hooks/use-wallet";

export function ImportWallet() {
	const { importWallet } = useWallet();
	const [words, setWords] = useState<string[]>(Array(12).fill(""));
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const allWordsFilled = words.every((w) => w.length > 0);

	const handleSubmit = useCallback(async () => {
		setError("");

		if (!allWordsFilled) {
			setError("All 12 words are required");
			return;
		}

		setLoading(true);
		try {
			const result = await importWallet(words.join(" "), "");
			if (!result.success) {
				setError(result.error ?? "Failed to import wallet");
			}
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	}, [words, allWordsFilled, importWallet]);

	return (
		<div className="max-w-lg mx-auto p-6">
			<h1 className="text-2xl font-bold text-foreground mb-1">
				Import Wallet
			</h1>
			<p className="text-sm text-muted-foreground mb-6">
				Enter your 12-word recovery phrase to restore your wallet.
			</p>

			<MnemonicGrid words={words} editable onChange={setWords} />

			{error && (
				<div className="mt-4 p-3 border border-destructive text-destructive text-sm font-mono">
					{error}
				</div>
			)}

			<button
				type="button"
				disabled={loading || !allWordsFilled}
				onClick={handleSubmit}
				className="mt-6 w-full py-3 bg-primary text-primary-foreground font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
			>
				{loading ? "Importing..." : "Import Wallet"}
			</button>
		</div>
	);
}
