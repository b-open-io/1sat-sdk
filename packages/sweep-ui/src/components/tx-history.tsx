import { Loader2, ExternalLink } from "lucide-react";

const EXPLORER_BASE = "https://bananablocks.com/tx/";

export interface TxRecord {
	label: string;
	txid: string;
	timestamp: Date;
	error?: string;
}

interface Props {
	sweeping: boolean;
	progress: string;
	history: TxRecord[];
}

export function TxHistory({ sweeping, progress, history }: Props) {
	return (
		<>
			{sweeping && (
				<div className="text-center space-y-4 py-8">
					<Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
					<p className="text-sm text-muted-foreground animate-pulse">{progress}</p>
					<p className="text-xs text-destructive/80">Do not close this page.</p>
				</div>
			)}

			{history.length > 0 && !sweeping && (
				<div className="border border-border/50 rounded-lg p-3 space-y-2">
					<div className="text-xs font-medium text-muted-foreground">
						Transactions ({history.length})
					</div>
					<div className="space-y-2 max-h-48 overflow-y-auto">
						{[...history].reverse().map((tx, i) => (
							<div key={`${tx.txid}-${i}`} className="flex items-center justify-between gap-2 text-xs">
								<div className="flex items-center gap-2 min-w-0">
									<span className={tx.error ? "text-red-500" : "text-green-500"}>
										{tx.error ? "\u2717" : "\u2713"}
									</span>
									<span className="text-muted-foreground truncate">{tx.label}</span>
								</div>
								{tx.error ? (
									<span className="text-red-500 text-[10px] truncate max-w-[200px]">{tx.error}</span>
								) : (
									<a
										href={`${EXPLORER_BASE}${tx.txid}`}
										target="_blank"
										rel="noopener noreferrer"
										className="text-blue-400 hover:text-blue-300 flex items-center gap-1 shrink-0"
									>
										<code className="text-[10px] font-mono">{tx.txid.substring(0, 12)}...</code>
										<ExternalLink className="h-3 w-3" />
									</a>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</>
	);
}
