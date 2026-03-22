interface BalanceCardProps {
	confirmed: number;
	unconfirmed: number;
}

function formatBsv(satoshis: number): string {
	return (satoshis / 1e8).toFixed(8);
}

export function BalanceCard({ confirmed, unconfirmed }: BalanceCardProps) {
	return (
		<div className="border border-border bg-card p-6">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
				Balance
			</div>
			<div className="text-3xl font-mono text-foreground tracking-tight">
				{formatBsv(confirmed)}{" "}
				<span className="text-sm text-muted-foreground">BSV</span>
			</div>
			{unconfirmed !== 0 && (
				<div className="mt-2 text-sm font-mono text-muted-foreground">
					{unconfirmed > 0 ? "+" : ""}
					{formatBsv(unconfirmed)} unconfirmed
				</div>
			)}
		</div>
	);
}
