import { useEffect, useState } from "react";
import type { HistoryEntry } from "../../../shared/types";
import { HistoryRow } from "../../components/history-row";
import { rpc } from "../../rpc";

export function HistoryView() {
	const [entries, setEntries] = useState<HistoryEntry[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		rpc.request
			.getTransactionHistory({ limit: 50 })
			.then((result) => {
				setEntries(result.entries);
			})
			.catch((err) => {
				console.error("Failed to load transaction history:", err);
			})
			.finally(() => {
				setLoading(false);
			});
	}, []);

	if (loading) {
		return (
			<div className="p-6">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
					History
				</div>
				<p className="text-sm text-muted-foreground">Loading history...</p>
			</div>
		);
	}

	if (entries.length === 0) {
		return (
			<div className="p-6">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
					History
				</div>
				<p className="text-sm text-muted-foreground">No transactions yet</p>
			</div>
		);
	}

	return (
		<div className="p-6">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
				History
			</div>
			<div className="border border-border bg-card">
				{entries.map((entry) => (
					<HistoryRow key={entry.txid} entry={entry} />
				))}
			</div>
		</div>
	);
}
