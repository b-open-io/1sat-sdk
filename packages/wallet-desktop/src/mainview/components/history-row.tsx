import type { HistoryEntry } from "../../shared/types";

interface HistoryRowProps {
	entry: HistoryEntry;
}

function formatBsv(satoshis: number): string {
	const prefix = satoshis > 0 ? "+" : "";
	return `${prefix}${(satoshis / 1e8).toFixed(8)}`;
}

function formatDate(dateStr: string): string {
	const d = new Date(dateStr);
	return d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function truncateDescription(desc: string, maxLen = 40): string {
	if (desc.length <= maxLen) return desc;
	return `${desc.slice(0, maxLen)}...`;
}

function truncateTxid(txid: string): string {
	if (txid.length <= 19) return txid;
	return `${txid.slice(0, 8)}...${txid.slice(-8)}`;
}

function StatusDot({ status }: { status: string }) {
	if (status === "completed") {
		return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />;
	}
	if (status === "unproven") {
		return (
			<span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
		);
	}
	if (status === "sending") {
		return (
			<span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse inline-block" />
		);
	}
	return <span className="w-2 h-2 rounded-full bg-muted inline-block" />;
}

export function HistoryRow({ entry }: HistoryRowProps) {
	return (
		<div className="flex items-center justify-between p-3 border-b border-border">
			{/* Left: description, date, txid */}
			<div className="min-w-0 flex-1">
				<div className="text-sm text-foreground">
					{truncateDescription(entry.description)}
				</div>
				<div className="text-xs text-muted-foreground mt-0.5">
					{formatDate(entry.dateCreated)}
				</div>
				<div className="font-mono text-xs text-muted-foreground mt-0.5">
					{truncateTxid(entry.txid)}
				</div>
			</div>

			{/* Right: amount + status */}
			<div className="flex items-center gap-2 flex-shrink-0 ml-3">
				<span
					className={`text-sm font-mono ${entry.satoshis > 0 ? "text-green-500" : "text-foreground"}`}
				>
					{formatBsv(entry.satoshis)} BSV
				</span>
				<StatusDot status={entry.status} />
			</div>
		</div>
	);
}
