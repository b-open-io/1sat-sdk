import { PrivateKey } from "@bsv/sdk";
import type { IndexedOutput } from "@1sat/types";
import { parseOutpoint } from "@1sat/utils";
import { getServices } from "./services";

/** RUN protocol OP_RETURN prefix: OP_FALSE OP_RETURN OP_PUSH3 "run" */
const RUN_PREFIX = Uint8Array.from([0x00, 0x6a, 0x03, 0x72, 0x75, 0x6e]);

export interface EnrichedOrdinal extends IndexedOutput {
	origin?: string;
	contentType?: string;
	name?: string;
	contentUrl: string;
}

export interface TokenBalance {
	tokenId: string;
	symbol?: string;
	icon: string;
	decimals: number;
	totalAmount: bigint;
	outputs: IndexedOutput[];
	isActive: boolean;
}

export interface ScannedAssets {
	funding: IndexedOutput[];
	ordinals: EnrichedOrdinal[];
	opnsNames: EnrichedOrdinal[];
	bsv21Tokens: TokenBalance[];
	bsv20Tokens: IndexedOutput[];
	locked: IndexedOutput[];
	run: IndexedOutput[];
	totalBsv: number;
}

export interface ScanProgress {
	phase: string;
	detail?: string;
}

export function deriveAddress(wif: string): string {
	return PrivateKey.fromWif(wif.trim()).toPublicKey().toAddress();
}

function getEvent(events: string[], prefix: string): string | undefined {
	const e = events.find((e) => e.startsWith(prefix));
	return e ? e.slice(prefix.length) : undefined;
}

function getEvents(events: string[], prefix: string): string[] {
	return events.filter((e) => e.startsWith(prefix)).map((e) => e.slice(prefix.length));
}

function enrichOrdinal(out: IndexedOutput): EnrichedOrdinal {
	const events = out.events ?? [];
	const origin = getEvent(events, "origin:");
	const types = getEvents(events, "type:");
	const contentType = types.find((t) => t.includes("/")) ?? types[0];
	const name = getEvent(events, "name:");
	const contentUrl = getServices().ordfs.getContentUrl(origin ?? out.outpoint, { raw: true });

	return { ...out, origin, contentType, name, contentUrl };
}

function resolveIconOutpoint(tokenId: string, icon?: string): string | undefined {
	if (!icon) return undefined;
	if (icon.startsWith("_")) {
		const txid = tokenId.split("_")[0];
		return `${txid}${icon}`;
	}
	return icon;
}

async function groupBsv21Tokens(outputs: IndexedOutput[]): Promise<TokenBalance[]> {
	// Group outputs by token ID from general indexer events
	const groups = new Map<string, IndexedOutput[]>();

	for (const out of outputs) {
		const events = out.events ?? [];
		const tokenId = getEvent(events, "bsv21:");
		if (!tokenId) continue;

		let group = groups.get(tokenId);
		if (!group) {
			group = [];
			groups.set(tokenId, group);
		}
		group.push(out);
	}

	if (groups.size === 0) return [];

	const services = getServices();
	const tokenIds = [...groups.keys()];

	// Get token metadata and active status from overlay
	let details: Array<{ tokenId: string; token?: { sym?: string; dec?: string; icon?: string }; status?: { is_active?: boolean } }> = [];
	try {
		details = await services.bsv21.lookupTokens(tokenIds);
	} catch {
		// BSV21 service may not be available
	}

	const detailMap = new Map(details.map((d) => [d.tokenId, d]));

	const balances: TokenBalance[] = [];
	for (const [tokenId, outs] of groups) {
		const detail = detailMap.get(tokenId);
		const isActive = detail?.status?.is_active ?? false;
		const iconOutpoint = resolveIconOutpoint(tokenId, detail?.token?.icon);

		let totalAmount = 0n;
		let validatedOutputs = outs;

		// For active tokens, validate outputs against the overlay to get real amounts
		if (isActive) {
			try {
				const outpoints = outs.map((o) => o.outpoint);
				const validated = await services.bsv21.validateOutputs(tokenId, outpoints, { unspent: true });
				totalAmount = validated.reduce((sum, v) => {
					const bsv21 = v.data?.bsv21 as { amt?: string } | undefined;
					return sum + (bsv21?.amt ? BigInt(bsv21.amt) : 0n);
				}, 0n);
				validatedOutputs = validated;
			} catch {
				// Validation failed — show outputs without amounts
			}
		}

		balances.push({
			tokenId,
			symbol: detail?.token?.sym,
			icon: iconOutpoint ? services.ordfs.getContentUrl(iconOutpoint) : "",
			decimals: Number(detail?.token?.dec ?? 0),
			totalAmount,
			outputs: validatedOutputs,
			isActive,
		});
	}
	return balances;
}

async function categorizeOutputs(outputs: IndexedOutput[]): Promise<ScannedAssets> {
	const funding: IndexedOutput[] = [];
	const rawOrdinals: IndexedOutput[] = [];
	const opnsRaw: IndexedOutput[] = [];
	const bsv21Raw: IndexedOutput[] = [];
	const bsv20Tokens: IndexedOutput[] = [];
	const locked: IndexedOutput[] = [];

	for (const out of outputs) {
		const events = out.events ?? [];
		const sats = out.satoshis ?? 0;

		if (events.some((e) => e.startsWith("bsv21:"))) {
			bsv21Raw.push(out);
			continue;
		}

		if (events.some((e) => e.startsWith("lock:"))) {
			locked.push(out);
			continue;
		}

		if (events.some((e) => e === "type:application/bsv-20" || e === "type:Token")) {
			bsv20Tokens.push(out);
			continue;
		}

		if (sats === 1) {
			if (events.some((e) => e === "type:application/op-ns")) {
				opnsRaw.push(out);
			} else {
				rawOrdinals.push(out);
			}
			continue;
		}

		if (sats > 1) {
			funding.push(out);
		}
	}

	// Check funding outputs for RUN token transactions
	const run: IndexedOutput[] = [];
	const cleanFunding: IndexedOutput[] = [];

	if (funding.length > 0) {
		const runTxids = await detectRunTransactions(funding);
		for (const f of funding) {
			const { txid } = parseOutpoint(f.outpoint);
			if (runTxids.has(txid)) {
				run.push(f);
			} else {
				cleanFunding.push(f);
			}
		}
	}

	return {
		funding: cleanFunding,
		ordinals: rawOrdinals.map(enrichOrdinal),
		opnsNames: opnsRaw.map(enrichOrdinal),
		bsv21Tokens: await groupBsv21Tokens(bsv21Raw),
		bsv20Tokens,
		locked,
		run,
		totalBsv: cleanFunding.reduce((sum, o) => sum + (o.satoshis ?? 0), 0),
	};
}

export async function scanAddress(
	address: string,
	onProgress?: (p: ScanProgress) => void,
): Promise<ScannedAssets> {
	const services = getServices();

	onProgress?.({ phase: "sync", detail: "Syncing address..." });
	for await (const event of services.owner.getTxos(address, { refresh: true, limit: 1 })) {
		if (event.type === "sync") {
			const p = event.data;
			onProgress?.({
				phase: "sync",
				detail: `${p.phase}: ${p.processed ?? 0}/${p.total ?? "?"}`,
			});
		} else if (event.type === "done" || event.type === "error") {
			break;
		}
	}

	onProgress?.({ phase: "search", detail: "Searching for assets..." });
	const allOutputs = await services.txo.search(`own:${address}`, {
		unspent: true,
		events: true,
		sats: true,
		limit: 0,
	});

	onProgress?.({ phase: "categorize", detail: "Loading token details..." });
	return await categorizeOutputs(allOutputs ?? []);
}

export async function scanAddresses(
	addresses: string[],
	onProgress?: (p: ScanProgress) => void,
): Promise<ScannedAssets> {
	const unique = [...new Set(addresses)];
	const allResults: ScannedAssets[] = [];

	for (const addr of unique) {
		onProgress?.({ phase: "sync", detail: `Scanning ${addr.slice(0, 8)}...` });
		allResults.push(await scanAddress(addr, onProgress));
	}

	return {
		funding: allResults.flatMap((r) => r.funding),
		ordinals: allResults.flatMap((r) => r.ordinals),
		opnsNames: allResults.flatMap((r) => r.opnsNames),
		bsv21Tokens: allResults.flatMap((r) => r.bsv21Tokens),
		bsv20Tokens: allResults.flatMap((r) => r.bsv20Tokens),
		locked: allResults.flatMap((r) => r.locked),
		run: allResults.flatMap((r) => r.run),
		totalBsv: allResults.reduce((sum, r) => sum + r.totalBsv, 0),
	};
}

/**
 * Check source transactions for the RUN protocol OP_RETURN pattern.
 * Returns the set of txids that contain a RUN OP_RETURN output.
 */
async function detectRunTransactions(funding: IndexedOutput[]): Promise<Set<string>> {
	const services = getServices();
	const txids = [...new Set(funding.map((f) => parseOutpoint(f.outpoint).txid))];
	const runTxids = new Set<string>();

	for (const txid of txids) {
		try {
			const beef = await services.getBeefForTxid(txid);
			const beefTx = beef.findTxid(txid);
			if (!beefTx?.tx) continue;

			for (const output of beefTx.tx.outputs) {
				const script = output.lockingScript?.toBinary();
				if (script && hasRunPrefix(script)) {
					runTxids.add(txid);
					break;
				}
			}
		} catch {
			// If we can't fetch the tx, leave the output in funding
		}
	}

	return runTxids;
}

function hasRunPrefix(script: number[]): boolean {
	if (script.length < RUN_PREFIX.length) return false;
	for (let i = 0; i < RUN_PREFIX.length; i++) {
		if (script[i] !== RUN_PREFIX[i]) return false;
	}
	return true;
}
