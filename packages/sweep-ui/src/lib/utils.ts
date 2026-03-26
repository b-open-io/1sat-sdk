import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatSats(sats: number): string {
	return sats.toLocaleString();
}

export function formatTokenAmount(rawAmount: string, decimals: number): string {
	if (decimals === 0) return rawAmount;
	const padded = rawAmount.padStart(decimals + 1, "0");
	const intPart = padded.slice(0, -decimals) || "0";
	const decPart = padded.slice(-decimals).replace(/0+$/, "");
	return decPart ? `${intPart}.${decPart}` : intPart;
}

export function truncate(s: string, len = 8): string {
	if (s.length <= len * 2 + 3) return s;
	return `${s.slice(0, len)}...${s.slice(-len)}`;
}
