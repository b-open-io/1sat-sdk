import { CheckCircle2, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import type { SweepResult } from "../lib/sweeper";

const EXPLORER_BASE = "https://bananablocks.com/tx/";

function TxLink({ label, txid }: { label: string; txid: string }) {
	return (
		<div className="border-b border-border/30 pb-2 space-y-1">
			<div className="flex items-center justify-between text-sm">
				<span className="text-muted-foreground">{label}</span>
				<a href={`${EXPLORER_BASE}${txid}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 flex items-center gap-1">
					<ExternalLink className="h-3 w-3" />
					<span className="text-xs">View</span>
				</a>
			</div>
			<code className="text-xs font-mono text-muted-foreground break-all">{txid}</code>
		</div>
	);
}

interface Props {
	sweeping: boolean;
	progress: string;
	result: SweepResult | null;
}

export function SweepProgress({ sweeping, progress, result }: Props) {
	if (sweeping) {
		return (
			<div className="text-center space-y-4 py-8">
				<Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
				<p className="text-sm text-muted-foreground animate-pulse">{progress}</p>
				<p className="text-xs text-destructive/80">Do not close this page.</p>
			</div>
		);
	}

	if (!result) return null;

	const hasErrors = result.errors.length > 0;
	const hasTxids = result.bsvTxid || result.ordinalTxids.length > 0 || result.bsv21Txids.length > 0;

	return (
		<div className="space-y-4 py-4">
			<div className="flex items-center gap-2">
				{hasErrors ? (
					<AlertTriangle className="h-5 w-5 text-yellow-500" />
				) : (
					<CheckCircle2 className="h-5 w-5 text-green-500" />
				)}
				<span className="font-semibold">
					{hasErrors && !hasTxids ? "Failed" : hasErrors ? "Completed with Errors" : "Complete"}
				</span>
			</div>

			{result.bsvTxid && <TxLink label="BSV" txid={result.bsvTxid} />}
			{result.ordinalTxids.map((txid) => (
				<TxLink key={txid} label="Ordinals" txid={txid} />
			))}
			{result.bsv21Txids.map((txid) => (
				<TxLink key={txid} label="Tokens" txid={txid} />
			))}

			{result.errors.map((err) => (
				<p key={err} className="text-xs text-destructive">{err}</p>
			))}
		</div>
	);
}
