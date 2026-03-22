import { useCallback, useState } from "react";
import type { OrdinalInfo } from "../../shared/types";

interface OrdinalDetailModalProps {
	ordinal: OrdinalInfo;
	onClose: () => void;
}

function extractTag(tags: string[], prefix: string): string | undefined {
	const tag = tags.find((t) => t.startsWith(`${prefix}:`));
	return tag ? tag.slice(prefix.length + 1) : undefined;
}

function truncateMiddle(str: string, startLen = 10, endLen = 10): string {
	if (str.length <= startLen + endLen + 3) return str;
	return `${str.slice(0, startLen)}...${str.slice(-endLen)}`;
}

export function OrdinalDetailModal({
	ordinal,
	onClose,
}: OrdinalDetailModalProps) {
	const [copied, setCopied] = useState(false);

	const origin = extractTag(ordinal.tags, "origin");
	const name = extractTag(ordinal.tags, "name");
	const type = extractTag(ordinal.tags, "type");

	const originForUrl = origin?.replace(".", "_");
	const imageUrl = originForUrl
		? `https://ordfs.network/content/${originForUrl}`
		: undefined;

	const isImage = type?.startsWith("image/") ?? false;

	const copyOutpoint = useCallback(async () => {
		await navigator.clipboard.writeText(ordinal.outpoint);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [ordinal.outpoint]);

	return (
		<div
			className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="bg-card border border-border max-w-md w-full max-h-[90vh] overflow-y-auto relative">
				{/* Close button */}
				<button
					type="button"
					onClick={onClose}
					className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
				>
					X
				</button>

				{/* Image preview */}
				{isImage && imageUrl ? (
					<div className="w-full aspect-square bg-muted">
						<img
							src={imageUrl}
							alt={name ?? "Ordinal"}
							className="w-full h-full object-contain"
						/>
					</div>
				) : (
					<div className="w-full aspect-square bg-muted flex items-center justify-center">
						<span className="text-sm font-mono text-muted-foreground">
							{type ?? "unknown"}
						</span>
					</div>
				)}

				{/* Details */}
				<div className="p-4 space-y-3">
					{name && (
						<div>
							<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
								Name
							</div>
							<div className="text-sm text-foreground">{name}</div>
						</div>
					)}

					{type && (
						<div>
							<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
								Content Type
							</div>
							<div className="text-sm font-mono text-foreground">{type}</div>
						</div>
					)}

					<div>
						<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
							Outpoint
						</div>
						<button
							type="button"
							onClick={copyOutpoint}
							className="text-sm font-mono text-foreground hover:text-primary transition-colors"
							title="Click to copy"
						>
							{truncateMiddle(ordinal.outpoint)}{" "}
							{copied && (
								<span className="text-xs text-primary ml-1">copied</span>
							)}
						</button>
					</div>

					{origin && (
						<div>
							<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
								Origin
							</div>
							<div className="text-sm font-mono text-foreground break-all">
								{origin}
							</div>
						</div>
					)}

					<div>
						<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
							Satoshis
						</div>
						<div className="text-sm font-mono text-foreground">
							{ordinal.satoshis.toLocaleString()}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
