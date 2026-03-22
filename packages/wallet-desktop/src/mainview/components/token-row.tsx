import type { TokenBalance } from "../../shared/types";

interface TokenRowProps {
	balance: TokenBalance;
}

function formatTokenAmount(amt: string, dec: number): string {
	if (dec === 0) return amt;
	if (amt.length <= dec) {
		return `0.${amt.padStart(dec, "0")}`;
	}
	const intPart = amt.slice(0, amt.length - dec);
	const fracPart = amt.slice(amt.length - dec);
	return `${intPart}.${fracPart}`;
}

function truncateMiddle(str: string, startLen = 8, endLen = 8): string {
	if (str.length <= startLen + endLen + 3) return str;
	return `${str.slice(0, startLen)}...${str.slice(-endLen)}`;
}

export function TokenRow({ balance }: TokenRowProps) {
	const iconUrl = balance.icon
		? `https://ordfs.network/content/${balance.icon.replace(".", "_")}`
		: undefined;

	const symbol = balance.sym ?? "???";

	return (
		<div className="flex items-center gap-3 p-3 border-b border-border">
			{/* Icon */}
			<div className="w-10 h-10 flex-shrink-0 rounded-full overflow-hidden bg-muted flex items-center justify-center">
				{iconUrl ? (
					<img
						src={iconUrl}
						alt={symbol}
						className="w-full h-full object-cover"
						loading="lazy"
					/>
				) : (
					<span className="text-sm font-bold text-muted-foreground">
						{symbol.charAt(0).toUpperCase()}
					</span>
				)}
			</div>

			{/* Symbol + ID */}
			<div className="flex-1 min-w-0">
				<div className="text-sm font-bold text-foreground">{symbol}</div>
				<div className="text-xs font-mono text-muted-foreground truncate">
					{truncateMiddle(balance.id)}
				</div>
			</div>

			{/* Amount */}
			<div className="text-sm font-mono text-foreground text-right">
				{formatTokenAmount(balance.amt, balance.dec)}
			</div>
		</div>
	);
}
