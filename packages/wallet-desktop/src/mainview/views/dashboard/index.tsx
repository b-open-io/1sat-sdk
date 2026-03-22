import { useCallback, useEffect, useState } from "react";
import { BalanceCard } from "../../components/balance-card";
import { QrCode } from "../../components/qr-code";
import { SyncTerminal } from "../../components/sync-terminal";
import { type Tab, TabBar } from "../../components/tab-bar";
import { useSyncEvents } from "../../hooks/use-sync-events";
import { useWallet } from "../../hooks/use-wallet";
import { HistoryView } from "../history/index";
import { InscribeView } from "../inscribe/index";
import { OrdinalsView } from "../ordinals/index";
import { SettingsView } from "../settings/index";
import { TokensView } from "../tokens/index";

function OverviewTab() {
	const { balance, sendBsv, getReceiveInfo } = useWallet();
	const { events } = useSyncEvents();

	const [receiveAddress, setReceiveAddress] = useState("");
	const [sendAddress, setSendAddress] = useState("");
	const [sendAmount, setSendAmount] = useState("");
	const [sendError, setSendError] = useState("");
	const [sendSuccess, setSendSuccess] = useState("");
	const [sending, setSending] = useState(false);

	useEffect(() => {
		getReceiveInfo().then(
			(info) => setReceiveAddress(info.address),
			(err) => console.error("Failed to get receive info:", err),
		);
	}, [getReceiveInfo]);

	const handleSend = useCallback(async () => {
		setSendError("");
		setSendSuccess("");

		if (!sendAddress) {
			setSendError("Address is required");
			return;
		}

		const amount = Number.parseFloat(sendAmount);
		if (Number.isNaN(amount) || amount <= 0) {
			setSendError("Invalid amount");
			return;
		}

		// Convert BSV to satoshis
		const satoshis = Math.round(amount * 1e8);

		setSending(true);
		try {
			const result = await sendBsv(sendAddress, satoshis);
			setSendSuccess(`Sent! txid: ${result.txid}`);
			setSendAddress("");
			setSendAmount("");
		} catch (err) {
			setSendError(String(err));
		} finally {
			setSending(false);
		}
	}, [sendAddress, sendAmount, sendBsv]);

	return (
		<div className="p-6 space-y-6">
			{/* Balance */}
			<BalanceCard
				confirmed={balance.confirmed}
				unconfirmed={balance.unconfirmed}
			/>

			{/* Receive */}
			<div className="border border-border bg-card p-6">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
					Receive
				</div>
				{receiveAddress ? (
					<div className="flex flex-col items-center gap-4">
						<QrCode value={receiveAddress} size={180} />
						<div className="w-full">
							<input
								type="text"
								readOnly
								value={receiveAddress}
								className="w-full p-3 bg-muted border border-border text-foreground font-mono text-xs outline-none select-all"
								onClick={(e) =>
									(e.target as HTMLInputElement).select()
								}
							/>
						</div>
					</div>
				) : (
					<div className="text-sm text-muted-foreground">
						Loading address...
					</div>
				)}
			</div>

			{/* Send */}
			<div className="border border-border bg-card p-6">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
					Send
				</div>
				<div className="space-y-3">
					<input
						type="text"
						value={sendAddress}
						onChange={(e) => setSendAddress(e.target.value)}
						className="w-full p-3 bg-muted border border-border text-foreground font-mono text-sm outline-none focus:border-primary"
						placeholder="Recipient address"
						spellCheck={false}
					/>
					<input
						type="text"
						value={sendAmount}
						onChange={(e) => setSendAmount(e.target.value)}
						className="w-full p-3 bg-muted border border-border text-foreground font-mono text-sm outline-none focus:border-primary"
						placeholder="Amount (BSV)"
						onKeyDown={(e) => {
							if (e.key === "Enter") handleSend();
						}}
					/>

					{sendError && (
						<div className="p-3 border border-destructive text-destructive text-sm font-mono">
							{sendError}
						</div>
					)}

					{sendSuccess && (
						<div className="p-3 border border-primary/50 text-primary text-sm font-mono break-all">
							{sendSuccess}
						</div>
					)}

					<button
						type="button"
						disabled={sending}
						onClick={handleSend}
						className="w-full py-3 bg-primary text-primary-foreground font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
					>
						{sending ? "Sending..." : "Send BSV"}
					</button>
				</div>
			</div>

			{/* Sync Terminal */}
			<SyncTerminal events={events} />
		</div>
	);
}

function TabContent({ tab }: { tab: Tab }) {
	switch (tab) {
		case "overview":
			return <OverviewTab />;
		case "ordinals":
			return <OrdinalsView />;
		case "tokens":
			return <TokensView />;
		case "history":
			return <HistoryView />;
		case "inscribe":
			return <InscribeView />;
		case "settings":
			return <SettingsView />;
	}
}

export function Dashboard() {
	const { lockWallet } = useWallet();
	const [activeTab, setActiveTab] = useState<Tab>("overview");

	const handleLock = useCallback(async () => {
		await lockWallet();
	}, [lockWallet]);

	return (
		<div className="min-h-screen flex flex-col">
			{/* Header */}
			<div className="flex items-center justify-between px-6 py-4 border-b border-border">
				<h1 className="text-lg font-bold text-foreground">1Sat Wallet</h1>
				<button
					type="button"
					onClick={handleLock}
					className="px-3 py-1 text-xs font-mono uppercase tracking-wider text-muted-foreground border border-border hover:text-foreground hover:border-foreground transition-colors"
				>
					Lock
				</button>
			</div>

			{/* Tab Bar */}
			<TabBar activeTab={activeTab} onTabChange={setActiveTab} />

			{/* Tab Content */}
			<div className="flex-1 overflow-y-auto">
				<TabContent tab={activeTab} />
			</div>
		</div>
	);
}
