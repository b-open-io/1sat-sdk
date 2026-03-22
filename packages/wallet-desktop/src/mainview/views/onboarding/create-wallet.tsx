import { useCallback, useEffect, useState } from "react";
import { MnemonicGrid } from "../../components/mnemonic-grid";
import { useWallet } from "../../hooks/use-wallet";

export function CreateWallet() {
	const { createWallet, generateMnemonic } = useWallet();
	const [mnemonic, setMnemonic] = useState<string[]>([]);
	const [passphrase, setPassphrase] = useState("");
	const [confirmPassphrase, setConfirmPassphrase] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [step, setStep] = useState<"generate" | "passphrase">("generate");

	useEffect(() => {
		generateMnemonic().then(
			(m) => setMnemonic(m.split(" ")),
			(err) => setError(`Failed to generate mnemonic: ${err}`),
		);
	}, [generateMnemonic]);

	const handleSubmit = useCallback(async () => {
		setError("");

		if (!passphrase) {
			setError("Passphrase is required");
			return;
		}

		if (passphrase !== confirmPassphrase) {
			setError("Passphrases do not match");
			return;
		}

		if (passphrase.length < 8) {
			setError("Passphrase must be at least 8 characters");
			return;
		}

		setLoading(true);
		try {
			const result = await createWallet(mnemonic.join(" "), passphrase);
			if (!result.success) {
				setError(result.error ?? "Failed to create wallet");
			}
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	}, [mnemonic, passphrase, confirmPassphrase, createWallet]);

	return (
		<div className="max-w-lg mx-auto p-6">
			<h1 className="text-2xl font-bold text-foreground mb-1">
				Create Wallet
			</h1>
			<p className="text-sm text-muted-foreground mb-6">
				{step === "generate"
					? "Write down your recovery phrase and store it safely."
					: "Set a passphrase to protect your wallet."}
			</p>

			{step === "generate" && (
				<>
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

					<button
						type="button"
						disabled={!confirmed || mnemonic.length === 0}
						onClick={() => setStep("passphrase")}
						className="mt-4 w-full py-3 bg-primary text-primary-foreground font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
					>
						Continue
					</button>
				</>
			)}

			{step === "passphrase" && (
				<>
					<div className="space-y-4">
						<div>
							<label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
								Passphrase
							</label>
							<input
								type="password"
								value={passphrase}
								onChange={(e) => setPassphrase(e.target.value)}
								className="w-full p-3 bg-muted border border-border text-foreground font-mono text-sm outline-none focus:border-primary"
								placeholder="Enter passphrase (min 8 characters)"
								autoFocus
							/>
						</div>
						<div>
							<label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
								Confirm Passphrase
							</label>
							<input
								type="password"
								value={confirmPassphrase}
								onChange={(e) => setConfirmPassphrase(e.target.value)}
								className="w-full p-3 bg-muted border border-border text-foreground font-mono text-sm outline-none focus:border-primary"
								placeholder="Confirm passphrase"
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSubmit();
								}}
							/>
						</div>
					</div>

					{error && (
						<div className="mt-4 p-3 border border-destructive text-destructive text-sm font-mono">
							{error}
						</div>
					)}

					<div className="flex gap-2 mt-6">
						<button
							type="button"
							onClick={() => setStep("generate")}
							className="flex-1 py-3 bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
						>
							Back
						</button>
						<button
							type="button"
							disabled={loading}
							onClick={handleSubmit}
							className="flex-1 py-3 bg-primary text-primary-foreground font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
						>
							{loading ? "Creating..." : "Create Wallet"}
						</button>
					</div>
				</>
			)}
		</div>
	);
}
