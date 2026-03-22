import { useEffect, useState } from "react";
import type { TokenBalance } from "../../../shared/types";
import { TokenRow } from "../../components/token-row";
import { rpc } from "../../rpc";

export function TokensView() {
	const [balances, setBalances] = useState<TokenBalance[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		rpc.request
			.getTokenBalances()
			.then((result) => {
				setBalances(result.balances);
			})
			.catch((err) => {
				console.error("Failed to load token balances:", err);
			})
			.finally(() => {
				setLoading(false);
			});
	}, []);

	if (loading) {
		return (
			<div className="p-6">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
					Tokens
				</div>
				<p className="text-sm text-muted-foreground">Loading tokens...</p>
			</div>
		);
	}

	if (balances.length === 0) {
		return (
			<div className="p-6">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
					Tokens
				</div>
				<p className="text-sm text-muted-foreground">No tokens found</p>
			</div>
		);
	}

	return (
		<div className="p-6">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
				Tokens
			</div>
			<div className="border border-border bg-card">
				{balances.map((balance) => (
					<TokenRow key={balance.id} balance={balance} />
				))}
			</div>
		</div>
	);
}
